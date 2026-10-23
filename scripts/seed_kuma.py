#!/usr/bin/env python3
import sqlite3
import sys

DB_PATH = "/mnt/usb1/netmon/uptime-kuma/kuma.db"

monitors = [
    {"name": "Orbi Router (10.0.0.1)", "type": "ping", "hostname": "10.0.0.1", "interval": 30},
    {"name": "AT&T Gateway (192.168.1.254)", "type": "ping", "hostname": "192.168.1.254", "interval": 30},
    {"name": "Internet (Cloudflare 1.1.1.1)", "type": "ping", "hostname": "1.1.1.1", "interval": 60},
    {"name": "Internet (Google 8.8.8.8)", "type": "ping", "hostname": "8.8.8.8", "interval": 60},
    {"name": "DNS Resolution (Google)", "type": "dns", "hostname": "google.com", "dns_resolve_server": "8.8.8.8", "dns_resolve_type": "A", "interval": 60},
    {"name": "Web Connectivity (Google HTTPS)", "type": "http", "url": "https://www.google.com", "interval": 60},
    {"name": "Windows Desktop (10.0.0.21)", "type": "ping", "hostname": "10.0.0.21", "interval": 60},
    {"name": "Windows SMB Movie Share (445)", "type": "port", "hostname": "10.0.0.21", "port": 445, "interval": 60},
    {"name": "Windows Web / Local AI (80)", "type": "http", "url": "http://10.0.0.21", "interval": 60, "accepted_statuscodes_json": '["200-299","308"]'},
    {"name": "Bambu P1S 3D Printer", "type": "ping", "hostname": "10.0.0.136", "interval": 60},
    {"name": "Workshop Smart Display", "type": "ping", "hostname": "10.0.0.124", "interval": 60},
    {"name": "Pi Hub Web App", "type": "http", "url": "http://10.0.0.30", "interval": 60},
    {"name": "Grafana Dashboards", "type": "http", "url": "http://10.0.0.30:3000", "interval": 60},
]

def main():
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
    except Exception as e:
        print(f"Failed to connect to database: {e}", file=sys.stderr)
        sys.exit(1)

    existing = [r[0] for r in cur.execute("SELECT name FROM monitor").fetchall()]
    added = 0
    for m in monitors:
        if m["name"] in existing:
            continue
        cur.execute("""
            INSERT INTO monitor (
                name, type, active, interval, hostname, port, url,
                dns_resolve_server, dns_resolve_type, accepted_statuscodes_json
            ) VALUES (
                :name, :type, 1, :interval, :hostname, :port, :url,
                :dns_resolve_server, :dns_resolve_type, :accepted_statuscodes_json
            )
        """, {
            "name": m["name"],
            "type": m["type"],
            "interval": m.get("interval", 60),
            "hostname": m.get("hostname"),
            "port": m.get("port"),
            "url": m.get("url"),
            "dns_resolve_server": m.get("dns_resolve_server"),
            "dns_resolve_type": m.get("dns_resolve_type"),
            "accepted_statuscodes_json": m.get("accepted_statuscodes_json", '["200-299"]'),
        })
        added += 1

    conn.commit()
    conn.close()
    print(f"Seeded {added} new monitors into Uptime Kuma (total: {len(existing) + added}).")

if __name__ == "__main__":
    main()
