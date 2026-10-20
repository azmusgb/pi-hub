"""Read-only Plex: recently added, continue watching, search, and poster images."""
import json
import re
import urllib.parse
import urllib.request

from . import sources

THUMB_PATH = re.compile(r"^/library/metadata/\d+/(thumb|art)/\d+$")


def _request(path, params=None, accept="application/json", timeout=6):
    q = urllib.parse.urlencode(params or {})
    req = urllib.request.Request(f"{sources.PLEX_URL}{path}{'?' + q if q else ''}",
                                 headers={"Accept": accept, "X-Plex-Token": sources._plex_token()})
    return urllib.request.urlopen(req, timeout=timeout)


def _json(path, params=None):
    with _request(path, params) as r:
        return json.load(r)


def machine_id():
    return sources.cached("plex-id", 3600, lambda: _json("/identity")["MediaContainer"]["machineIdentifier"])


def _item(m):
    kind = m.get("type")
    title = m.get("title") or ""
    if kind == "episode" and m.get("grandparentTitle"):
        title = f"{m['grandparentTitle']}: {title}"
    duration = m.get("duration") or 0
    offset = m.get("viewOffset") or 0
    return {
        "key": str(m.get("ratingKey") or ""),
        "title": title[:90],
        "year": m.get("year"),
        "kind": kind,
        "minutes": round(duration / 60000) if duration else None,
        "progress": round(offset * 100 / duration) if duration and offset else 0,
        "thumb": m.get("thumb") if m.get("thumb") and THUMB_PATH.match(m["thumb"]) else None,
        "summary": (m.get("summary") or "")[:280],
        "rating": m.get("audienceRating") or m.get("rating"),
        "added": m.get("addedAt"),
    }


def _list(path, params=None, limit=24):
    data = _json(path, params)
    return [_item(m) for m in (data.get("MediaContainer") or {}).get("Metadata") or []][:limit]


def recently_added():
    return sources.cached("plex-recent", 120, lambda: _list("/library/recentlyAdded", {"X-Plex-Container-Size": 18}, 18))


def on_deck():
    return sources.cached("plex-deck", 60, lambda: _list("/library/onDeck", {"X-Plex-Container-Size": 8}, 8))


def search(query):
    query = query.strip()[:60]
    if not query:
        return []
    data = _json("/hubs/search", {"query": query, "limit": 12})
    out = []
    for hub in (data.get("MediaContainer") or {}).get("Hub") or []:
        if hub.get("type") in ("movie", "show", "episode"):
            out += [_item(m) for m in hub.get("Metadata") or []]
    return out[:24]


def thumb(path):
    if not THUMB_PATH.match(path or ""):
        return None
    with _request("/photo/:/transcode", {"url": path, "width": 300, "height": 450, "minSize": 1, "upscale": 1},
                  accept="image/jpeg", timeout=10) as r:
        return r.read(), r.headers.get("Content-Type", "image/jpeg")
