#!/usr/bin/env python3
"""
Orbi UPnP Prometheus Exporter & Telemetry Daemon
Polls Netgear Orbi (MiniUPnPd) via standard UPnP/IGD on port 5000.
Exposes:
  - GET /metrics (Prometheus exposition format)
  - GET /status  (JSON telemetry format)
"""

import json
import logging
import os
import sys
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, HTTPServer

ROUTER_IP = os.getenv("ORBI_IP", "10.0.0.1")
ROUTER_PORT = int(os.getenv("ORBI_PORT", "5000"))
LISTEN_PORT = int(os.getenv("EXPORTER_PORT", "9120"))
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "10"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# Global state protected by a lock
state_lock = threading.Lock()
state = {
    "up": 0,
    "last_scrape_ts": 0,
    "model": "RBR750",
    "uptime_seconds": 0,
    "external_ip": "unknown",
    "link_status": 0,
    "max_down_bps": 0,
    "max_up_bps": 0,
    "bytes_recv_total": 0,
    "bytes_sent_total": 0,
    "pkts_recv_total": 0,
    "pkts_sent_total": 0,
    "port_mappings_count": 0,
    "calc_down_mbps": 0.0,
    "calc_up_mbps": 0.0,
}

# Cumulative 64-bit rollover trackers
cum_state = {
    "prev_raw_recv": None,
    "recv_base": 0,
    "prev_raw_sent": None,
    "sent_base": 0,
    "last_poll_ts": None,
    "last_calc_recv": 0,
    "last_calc_sent": 0,
}

UI4_MAX = 4294967296  # 2^32


def soap_call(path, service, action, args=""):
    url = f"http://{ROUTER_IP}:{ROUTER_PORT}{path}"
    body = (
        f'<?xml version="1.0"?>'
        f'<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
        f's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
        f'<s:Body><u:{action} xmlns:u="{service}">{args}</u:{action}></s:Body>'
        f'</s:Envelope>'
    )
    headers = {
        "SOAPAction": f'"{service}#{action}"',
        "Content-Type": "text/xml; charset=utf-8",
    }
    req = urllib.request.Request(url, data=body.encode("utf-8"), headers=headers)
    resp = urllib.request.urlopen(req, timeout=4).read().decode("utf-8")
    return ET.fromstring(resp)


def count_port_mappings():
    count = 0
    service = "urn:schemas-upnp-org:service:WANIPConnection:1"
    for idx in range(64):
        body = f"<NewPortMappingIndex>{idx}</NewPortMappingIndex>"
        try:
            soap_call("/ctl/IPConn", service, "GetGenericPortMappingEntry", body)
            count += 1
        except Exception:
            break
    return count


def poll_orbi():
    global cum_state
    now = time.time()
    try:
        # 1. WAN Common Config (traffic counters & line properties)
        cmn_srv = "urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1"
        xml_recv = soap_call("/ctl/CmnIfCfg", cmn_srv, "GetTotalBytesReceived")
        raw_recv = int(xml_recv.findtext(".//NewTotalBytesReceived", "0"))

        xml_sent = soap_call("/ctl/CmnIfCfg", cmn_srv, "GetTotalBytesSent")
        raw_sent = int(xml_sent.findtext(".//NewTotalBytesSent", "0"))

        xml_pkts_recv = soap_call("/ctl/CmnIfCfg", cmn_srv, "GetTotalPacketsReceived")
        pkts_recv = int(xml_pkts_recv.findtext(".//NewTotalPacketsReceived", "0"))

        xml_pkts_sent = soap_call("/ctl/CmnIfCfg", cmn_srv, "GetTotalPacketsSent")
        pkts_sent = int(xml_pkts_sent.findtext(".//NewTotalPacketsSent", "0"))

        xml_link = soap_call("/ctl/CmnIfCfg", cmn_srv, "GetCommonLinkProperties")
        link_up = 1 if xml_link.findtext(".//NewPhysicalLinkStatus") == "Up" else 0
        max_down = int(xml_link.findtext(".//NewLayer1DownstreamMaxBitRate", "0"))
        max_up = int(xml_link.findtext(".//NewLayer1UpstreamMaxBitRate", "0"))

        # 2. WAN IP Connection (status, uptime, external IP)
        ip_srv = "urn:schemas-upnp-org:service:WANIPConnection:1"
        xml_status = soap_call("/ctl/IPConn", ip_srv, "GetStatusInfo")
        uptime = int(xml_status.findtext(".//NewUptime", "0"))

        xml_ip = soap_call("/ctl/IPConn", ip_srv, "GetExternalIPAddress")
        ext_ip = xml_ip.findtext(".//NewExternalIPAddress", "unknown")

        # 3. Handle 32-bit counter rollover
        if cum_state["prev_raw_recv"] is not None and raw_recv < cum_state["prev_raw_recv"]:
            cum_state["recv_base"] += UI4_MAX
        cum_state["prev_raw_recv"] = raw_recv
        total_recv = cum_state["recv_base"] + raw_recv

        if cum_state["prev_raw_sent"] is not None and raw_sent < cum_state["prev_raw_sent"]:
            cum_state["sent_base"] += UI4_MAX
        cum_state["prev_raw_sent"] = raw_sent
        total_sent = cum_state["sent_base"] + raw_sent

        # 4. Instantaneous rate calculation
        down_mbps = 0.0
        up_mbps = 0.0
        if cum_state["last_poll_ts"] is not None:
            dt = now - cum_state["last_poll_ts"]
            if dt > 0:
                d_recv = total_recv - cum_state["last_calc_recv"]
                d_sent = total_sent - cum_state["last_calc_sent"]
                if d_recv >= 0:
                    down_mbps = round((d_recv * 8) / (dt * 1_000_000), 2)
                if d_sent >= 0:
                    up_mbps = round((d_sent * 8) / (dt * 1_000_000), 2)

        cum_state["last_poll_ts"] = now
        cum_state["last_calc_recv"] = total_recv
        cum_state["last_calc_sent"] = total_sent

        # 5. Port mappings count (every 30s)
        port_count = state.get("port_mappings_count", 0)
        if int(now) % 30 < POLL_INTERVAL:
            try:
                port_count = count_port_mappings()
            except Exception:
                pass

        with state_lock:
            state.update({
                "up": 1,
                "last_scrape_ts": now,
                "uptime_seconds": uptime,
                "external_ip": ext_ip,
                "link_status": link_up,
                "max_down_bps": max_down,
                "max_up_bps": max_up,
                "bytes_recv_total": total_recv,
                "bytes_sent_total": total_sent,
                "pkts_recv_total": pkts_recv,
                "pkts_sent_total": pkts_sent,
                "port_mappings_count": port_count,
                "calc_down_mbps": down_mbps,
                "calc_up_mbps": up_mbps,
            })
    except Exception as e:
        logging.warning("Failed to poll Orbi UPnP: %s", e)
        with state_lock:
            state["up"] = 0


def poller_loop():
    while True:
        poll_orbi()
        time.sleep(POLL_INTERVAL)


class MetricsHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/metrics":
            with state_lock:
                s = dict(state)
            model = s["model"]
            ext_ip = s["external_ip"]
            lines = [
                "# HELP orbi_up UPnP service responsive status (1=up, 0=down)",
                "# TYPE orbi_up gauge",
                f"orbi_up {s['up']}",
                "# HELP orbi_uptime_seconds Router uptime in seconds",
                "# TYPE orbi_uptime_seconds gauge",
                f"orbi_uptime_seconds {s['uptime_seconds']}",
                "# HELP orbi_wan_bytes_received_total Total WAN bytes received counter (64-bit continuous)",
                "# TYPE orbi_wan_bytes_received_total counter",
                f"orbi_wan_bytes_received_total {s['bytes_recv_total']}",
                "# HELP orbi_wan_bytes_sent_total Total WAN bytes sent counter (64-bit continuous)",
                "# TYPE orbi_wan_bytes_sent_total counter",
                f"orbi_wan_bytes_sent_total {s['bytes_sent_total']}",
                "# HELP orbi_wan_packets_received_total Total WAN packets received",
                "# TYPE orbi_wan_packets_received_total counter",
                f"orbi_wan_packets_received_total {s['pkts_recv_total']}",
                "# HELP orbi_wan_packets_sent_total Total WAN packets sent",
                "# TYPE orbi_wan_packets_sent_total counter",
                f"orbi_wan_packets_sent_total {s['pkts_sent_total']}",
                "# HELP orbi_wan_link_status Physical link status (1=Up, 0=Down)",
                "# TYPE orbi_wan_link_status gauge",
                f"orbi_wan_link_status {s['link_status']}",
                "# HELP orbi_wan_downstream_bitrate_bps Layer 1 max downstream line rate",
                "# TYPE orbi_wan_downstream_bitrate_bps gauge",
                f"orbi_wan_downstream_bitrate_bps {s['max_down_bps']}",
                "# HELP orbi_wan_upstream_bitrate_bps Layer 1 max upstream line rate",
                "# TYPE orbi_wan_upstream_bitrate_bps gauge",
                f"orbi_wan_upstream_bitrate_bps {s['max_up_bps']}",
                "# HELP orbi_port_mappings_count Active UPnP port mappings count",
                "# TYPE orbi_port_mappings_count gauge",
                f"orbi_port_mappings_count {s['port_mappings_count']}",
                "# HELP orbi_router_info Static info metadata for the router",
                "# TYPE orbi_router_info gauge",
                f'orbi_router_info{{model="{model}",external_ip="{ext_ip}"}} 1',
            ]
            body = "\n".join(lines) + "\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
            self.end_headers()
            self.wfile.write(body.encode("utf-8"))

        elif self.path in ("/status", "/api/status"):
            with state_lock:
                s = dict(state)
            days = s["uptime_seconds"] // 86400
            hours = (s["uptime_seconds"] % 86400) // 3600
            mins = (s["uptime_seconds"] % 3600) // 60
            s["uptime_human"] = f"{days}d {hours}h {mins}m"
            payload = json.dumps(s, indent=2)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(payload.encode("utf-8"))

        elif self.path == "/healthz":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok": true}')

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Silence standard HTTP access logging to prevent noisy logs
        return


def main():
    logging.info("Starting Orbi UPnP Exporter for %s:%d on port %d...", ROUTER_IP, ROUTER_PORT, LISTEN_PORT)
    # Start poller thread
    poller = threading.Thread(target=poller_loop, daemon=True)
    poller.start()

    # Initial poll
    time.sleep(1)

    server = HTTPServer(("0.0.0.0", LISTEN_PORT), MetricsHandler)
    logging.info("Listening on http://0.0.0.0:%d/metrics", LISTEN_PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()


if __name__ == "__main__":
    main()
