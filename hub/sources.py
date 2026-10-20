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

PI_STATUS_URL = os.environ.get("HUB_PI_STATUS_URL", "http://127.0.0.1:8099/status")
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
    with _lock:
        _cache[key] = (now, value)
    return value


def _get_json(url, headers=None, timeout=4):
    req = urllib.request.Request(url, headers={"Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def pi_status():
    return cached("pi", 10, lambda: _get_json(PI_STATUS_URL))


def _plex_token():
    with open(PLEX_TOKEN_FILE) as f:
        return f.read().strip()


def _plex_sessions():
    data = _get_json(f"{PLEX_URL}/status/sessions", {"X-Plex-Token": _plex_token()})
    out = []
    for m in (data.get("MediaContainer") or {}).get("Metadata") or []:
        duration = m.get("duration") or 0
        offset = m.get("viewOffset") or 0
        title = m.get("title") or "Something"
        if m.get("type") == "episode" and m.get("grandparentTitle"):
            title = f"{m['grandparentTitle']}: {title}"
        out.append({
            "title": title[:80],
            "who": ((m.get("User") or {}).get("title") or "")[:40],
            "device": ((m.get("Player") or {}).get("title") or "")[:40],
            "state": (m.get("Player") or {}).get("state") or "playing",
            "progress": round(offset * 100 / duration) if duration else 0,
            "minutes_left": round((duration - offset) / 60000) if duration else None,
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
