"""Where the hub's data comes from. Every source is cached and may be missing.

- pi-status (localhost:8099): Pi health, movie drive, services, X2D / display / Local AI.
- Plex (localhost:32400): what's playing, using the server's own token file.
- /proc: processor and memory, sampled for the small charts.
"""
import json
import os
import threading
import time
import urllib.request
from collections import deque

from . import freshness

PI_STATUS_URL = os.environ.get("HUB_PI_STATUS_URL", "http://127.0.0.1:8099/status")
NETMON_PROMETHEUS_URL = os.environ.get("HUB_NETMON_PROMETHEUS_URL", "http://127.0.0.1:9091")
PLEX_URL = os.environ.get("HUB_PLEX_URL", "http://127.0.0.1:32400")
PLEX_TOKEN_FILE = os.environ.get("HUB_PLEX_TOKEN_FILE", "/etc/pi-hub/secrets/plex_token")

_cache = {}
_lock = threading.Lock()


def cached(key, ttl, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    try:
        value = fn()
    except Exception:
        value = None
    freshness.record(key, ttl, value)
    with _lock:
        _cache[key] = (time.time(), value)
    return value


def _get_json(url, headers=None, timeout=4):
    req = urllib.request.Request(url, headers={"Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def pi_status():
    return cached("pi", 10, lambda: _get_json(PI_STATUS_URL))


def _netmon():
    try:
        dur_data = _get_json(f"{NETMON_PROMETHEUS_URL}/api/v1/query?query=probe_duration_seconds", timeout=2)
        succ_data = _get_json(f"{NETMON_PROMETHEUS_URL}/api/v1/query?query=probe_success", timeout=2)
    except Exception:
        return None

    durations = {}
    for item in dur_data.get("data", {}).get("result", []):
        inst = item.get("metric", {}).get("instance")
        val = item.get("value", [0, "0"])[1]
        try:
            durations[inst] = round(float(val) * 1000, 1)
        except (ValueError, TypeError):
            pass

    success = {}
    for item in succ_data.get("data", {}).get("result", []):
        inst = item.get("metric", {}).get("instance")
        val = item.get("value", [0, "0"])[1]
        success[inst] = val == "1"

    orbi_ms = durations.get("10.0.0.1")
    att_ms = durations.get("192.168.1.254")
    wan_ms = durations.get("8.8.8.8") or durations.get("1.1.1.1")
    dns_ms = durations.get("10.0.0.1:53") or durations.get("1.1.1.1:53")
    win_ms = durations.get("10.0.0.21")
    printer_ms = durations.get("10.0.0.136") or durations.get("10.0.0.124")

    # A probe that isn't reporting doesn't count as up; the Internet is up while any WAN probe answers.
    orbi_ok = success.get("10.0.0.1")
    wan = [success[i] for i in ("1.1.1.1", "8.8.8.8") if i in success]
    wan_ok = any(wan) if wan else None

    if orbi_ok is False or wan_ok is False:
        tone = "bad"
    elif orbi_ok is None or wan_ok is None:
        tone = "unknown"
    else:
        tone = "ok"

    orbi_info = {}
    try:
        orbi_info = _get_json("http://127.0.0.1:9120/status", timeout=1) or {}
    except Exception:
        pass

    return {
        "status": tone,
        "orbi_ms": orbi_ms,
        "att_ms": att_ms,
        "wan_ms": wan_ms,
        "dns_ms": dns_ms,
        "win_ms": win_ms,
        "printer_ms": printer_ms,
        "orbi_model": orbi_info.get("model", "RBR750"),
        "orbi_uptime": orbi_info.get("uptime_human"),
        "orbi_ext_ip": orbi_info.get("external_ip"),
        "orbi_down_mbps": orbi_info.get("calc_down_mbps"),
        "orbi_up_mbps": orbi_info.get("calc_up_mbps"),
        "grafana_url": "http://10.0.0.30:3000",
        "uptime_kuma_url": "http://10.0.0.30:3001/status/home",
    }


BAMBUDDY_PRINTER_URL = os.environ.get("HUB_BAMBUDDY_PRINTER_URL", "http://127.0.0.1:8000/api/v1/printers/1/status")


def _bambuddy():
    try:
        from . import bambuddy
        data = _get_json(BAMBUDDY_PRINTER_URL, bambuddy.headers(), timeout=1)
        if not data or not isinstance(data, dict):
            return None
        temps = data.get("temperatures") or {}
        ams_list = data.get("ams") or []
        first_ams = ams_list[0] if ams_list else {}
        tray_list = first_ams.get("tray") or []
        first_tray = next((t for t in tray_list if t.get("exists")), {})
        return {
            "connected": bool(data.get("connected")),
            "state": data.get("state"),
            "job_name": data.get("current_print") or data.get("subtask_name"),
            "progress": data.get("progress"),
            "layer_num": data.get("layer_num"),
            "total_layers": data.get("total_layers"),
            "nozzle_temp": temps.get("nozzle"),
            "nozzle_target": temps.get("nozzle_target"),
            "bed_temp": temps.get("bed"),
            "bed_target": temps.get("bed_target"),
            "ams_humidity": first_ams.get("humidity"),
            "ams_temp": first_ams.get("temp"),
            "filament_type": first_tray.get("tray_type"),
            "filament_color": first_tray.get("tray_color"),
            "wifi_signal": data.get("wifi_signal"),
        }
    except Exception:
        return None


def bambuddy_printer():
    return cached("bambuddy_printer", 3, _bambuddy)


def network_metrics():
    return cached("netmon", 10, _netmon)


def active_network_alerts():
    def _fetch():
        try:
            data = _get_json(f"{NETMON_PROMETHEUS_URL}/api/v1/alerts", timeout=2)
            alerts = data.get("data", {}).get("alerts", [])
            return [a["labels"]["alertname"] for a in alerts if a.get("state") == "firing" and "alertname" in a.get("labels", {})]
        except Exception:
            return []
    return cached("net_alerts", 15, _fetch)


WORLD_URL = os.environ.get("HUB_WORLD_URL", "https://10.0.0.21/api/world")


def _world():
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # Local AI uses its own certificate on the home network
    with urllib.request.urlopen(WORLD_URL, timeout=4, context=ctx) as r:
        return json.load(r)


def world():
    return cached("world", 20, _world)


def _plex_token():
    with open(PLEX_TOKEN_FILE) as f:
        return f.read().strip()


def _plex_sessions():
    data = _get_json(f"{PLEX_URL}/status/sessions", {"X-Plex-Token": _plex_token()})
    container = data.get("MediaContainer")
    if not isinstance(container, dict):
        raise ValueError("Plex returned no session container")
    out = []
    for m in container.get("Metadata") or []:
        duration = m.get("duration") or 0
        offset = m.get("viewOffset") or 0
        title = m.get("title") or "Something"
        if m.get("type") == "episode" and m.get("grandparentTitle"):
            title = f"{m['grandparentTitle']}: {title}"
        kind = m.get("type") if m.get("type") in ("movie", "episode") else "other"
        thumb = m.get("grandparentThumb") if kind == "episode" else m.get("thumb")
        n = len(out)
        out.append({
            # The shape other apps (Local AI, the workshop display) rely on. Add fields; don't rename these.
            "title": title[:80],
            "show": (m.get("grandparentTitle") or "")[:60] if kind == "episode" else "",
            "year": m.get("year") if kind == "movie" else None,
            "kind": kind,
            "who": ((m.get("User") or {}).get("title") or "")[:40],
            "device": ((m.get("Player") or {}).get("title") or "")[:40],
            "state": (m.get("Player") or {}).get("state") or "playing",
            "progress": round(offset * 100 / duration) if duration else 0,
            "minutes_left": round((duration - offset) / 60000) if duration else None,
            "poster": f"/api/now/poster/{n}.jpg" if thumb else None,
            "_thumb": thumb,
        })
    return out[:6]


def plex_sessions():
    return cached("plex", 15, _plex_sessions)


class Sampler:
    """Processor and memory use every 10 s for the last hour, for the sparklines."""

    def __init__(self, every=10, keep=360):
        self.every = every
        self.cpu = deque(maxlen=keep)
        self.mem = deque(maxlen=keep)
        self.temp = deque(maxlen=keep)
        self._prev = None

    def _cpu_percent(self):
        with open("/proc/stat") as f:
            parts = [int(x) for x in f.readline().split()[1:]]
        idle, total = parts[3] + parts[4], sum(parts)
        prev, self._prev = self._prev, (idle, total)
        if not prev or total == prev[1]:
            return None
        return round(100 * (1 - (idle - prev[0]) / (total - prev[1])), 1)

    @staticmethod
    def _mem():
        info = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                info[k] = int(v.split()[0])
        total, avail = info["MemTotal"], info["MemAvailable"]
        return round(100 * (total - avail) / total, 1), round(avail / 1048576, 1), round(total / 1048576, 1)

    @staticmethod
    def _temp():
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return round(int(f.read()) / 1000, 1)

    def sample(self):
        cpu = self._cpu_percent()
        if cpu is not None:
            self.cpu.append(cpu)
        self.mem.append(self._mem()[0])
        self.temp.append(self._temp())

    def run(self):
        while True:
            try:
                self.sample()
            except Exception:
                pass
            time.sleep(self.every)

    def snapshot(self):
        try:
            used, free_gb, total_gb = self._mem()
        except Exception:
            used = free_gb = total_gb = None
        return {
            "cpu_series": list(self.cpu)[-90:],
            "mem_series": list(self.mem)[-90:],
            "temp_series": list(self.temp)[-90:],
            "mem_free_gb": free_gb,
            "mem_total_gb": total_gb,
        }


def disk_free_gb(path="/"):
    st = os.statvfs(path)
    return round(st.f_bavail * st.f_frsize / 1e9, 1)
