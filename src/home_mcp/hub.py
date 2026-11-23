"""Pi Hub's open read endpoints. Every call returns data or a structured failure, never an exception."""
import asyncio
import os
import ssl
from datetime import datetime, timezone
from pathlib import Path

import httpx

DEFAULT_URL = "https://hub.rahe-home.duckdns.org"


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def iso(ts) -> str | None:
    """An epoch time from the hub as local ISO, or None for a missing or unreadable one."""
    if ts is None or isinstance(ts, bool):
        return None
    try:
        return datetime.fromtimestamp(float(ts), timezone.utc).astimezone().isoformat(timespec="seconds")
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def make_client(transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    """A client for the hub from HOME_MCP_HUB_URL, HOME_MCP_HUB_CA and HOME_MCP_TIMEOUT."""
    base = os.environ.get("HOME_MCP_HUB_URL", DEFAULT_URL).rstrip("/")
    try:
        timeout = float(os.environ.get("HOME_MCP_TIMEOUT", "10"))
    except ValueError:
        timeout = 10.0
    ca = os.environ.get("HOME_MCP_HUB_CA")
    ca_path = Path(ca).expanduser() if ca else None
    verify: ssl.SSLContext | bool = (ssl.create_default_context(cafile=str(ca_path))
                                     if ca_path and ca_path.is_file() else True)
    return httpx.AsyncClient(base_url=base, timeout=timeout, verify=verify, transport=transport,
                             headers={"Accept": "application/json"})


async def get(client: httpx.AsyncClient, path: str,
              headers: dict[str, str] | None = None) -> tuple[object | None, dict | None]:
    """(data, None) on success, else (None, failure) with error unreachable, http or bad_json. headers are sent with
    this request only; nothing from them enters a failure."""
    source = f"pi-hub {path}"
    try:
        r = await client.get(path, headers=headers)
    except httpx.TimeoutException:
        return None, {"source": source, "error": "unreachable", "detail": "timed out"}
    except httpx.HTTPError as e:
        return None, {"source": source, "error": "unreachable", "detail": str(e) or type(e).__name__}
    if r.is_redirect:
        where = r.headers.get("location")
        detail = f"HTTP {r.status_code} to {where}" if where else f"HTTP {r.status_code}"
        return None, {"source": source, "error": "http", "detail": detail}
    if r.status_code >= 400:
        return None, {"source": source, "error": "http", "detail": f"HTTP {r.status_code}"}
    try:
        return r.json(), None
    except ValueError:
        return None, {"source": source, "error": "bad_json", "detail": r.text[:200]}


async def gather(client: httpx.AsyncClient, *paths: str) -> tuple[dict, list[dict]]:
    """Fetch several paths at once: {path: data} for those that worked, and the failures."""
    results = await asyncio.gather(*(get(client, p) for p in paths))
    data = {p: d for p, (d, err) in zip(paths, results) if err is None}
    return data, [err for _, err in results if err is not None]
