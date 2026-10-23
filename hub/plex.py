"""Read-only Plex: recently added, continue watching, search, and poster images."""
import json
import re
import time
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
        "art": next((a for a in (m.get("art"), m.get("grandparentArt")) if a and THUMB_PATH.match(a)), None),
        "summary": (m.get("summary") or "")[:280],
        "rating": m.get("audienceRating") or m.get("rating"),
        "added": m.get("addedAt"),
    }


def _list(path, params=None, limit=24):
    data = _json(path, params)
    return [_item(m) for m in (data.get("MediaContainer") or {}).get("Metadata") or []][:limit]


def _sections():
    dirs = (_json("/library/sections").get("MediaContainer") or {}).get("Directory") or []
    return [
        {"key": str(s.get("key")), "title": s.get("title", ""), "type": s.get("type", "")}
        for s in dirs if s.get("type") == "movie"
    ]


def movie_sections():
    return sources.cached("plex-sections", 300, _sections) or []


def _dedupe_items(items, limit):
    seen = set()
    out = []
    for it in items:
        key = (it.get("title", "").strip().lower(), it.get("year"))
        if key not in seen:
            seen.add(key)
            out.append(it)
    return out[:limit]


def recently_added(section=None):
    if section and section != "all":
        return sources.cached(f"plex-recent-{section}", 120, lambda: _list(f"/library/sections/{section}/recentlyAdded", {"X-Plex-Container-Size": 18}, 18))
    return sources.cached("plex-recent", 120, lambda: _dedupe_items(_list("/library/recentlyAdded", {"X-Plex-Container-Size": 36}, 36), 18))


def on_deck():
    return sources.cached("plex-deck", 60, lambda: _dedupe_items(_list("/library/onDeck", {"X-Plex-Container-Size": 24}, 24), 8))


def search(query):
    query = query.strip()[:60]
    if not query:
        return []
    data = _json("/hubs/search", {"query": query, "limit": 24})
    raw = []
    for hub in (data.get("MediaContainer") or {}).get("Hub") or []:
        if hub.get("type") in ("movie", "show", "episode"):
            raw += [_item(m) for m in hub.get("Metadata") or []]
    return _dedupe_items(raw, 24)


def thumb(path, wide=False):
    if not THUMB_PATH.match(path or ""):
        return None
    size = {"width": 1280, "height": 720} if wide else {"width": 300, "height": 450}
    with _request("/photo/:/transcode", {"url": path, **size, "minSize": 1, "upscale": 1},
                  accept="image/jpeg", timeout=10) as r:
        return r.read(), r.headers.get("Content-Type", "image/jpeg")


def _raw_history():
    return _json("/status/sessions/history/all", {"sort": "viewedAt:desc", "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 500})


def raw_history():
    return sources.cached("plex-raw-history", 600, _raw_history)


def _accounts():
    out = {}
    try:
        for a in (_json("/accounts").get("MediaContainer") or {}).get("Account") or []:
            out[a.get("id")] = a.get("name") or ""
    except Exception:  # noqa: BLE001
        pass
    return out


def watch_stats(days=30):
    """Watching over the last month: how much, who, and which nights."""
    data = raw_history() or {}
    since = int(time.time()) - days * 86400
    lib = {u["key"]: u for u in (library_stats() or {}).get("_all", [])}
    names = sources.cached("plex-accounts", 3600, _accounts) or {}
    rows = [m for m in (data.get("MediaContainer") or {}).get("Metadata") or [] if (m.get("viewedAt") or 0) >= since]
    people, nights, minutes, titles = {}, [0] * 7, 0, {}
    for m in rows:
        mins = round((m.get("duration") or 0) / 60000) or (lib.get(str(m.get("ratingKey"))) or {}).get("minutes") or 0
        minutes += mins
        who = names.get(m.get("accountID")) or "Someone"
        people[who] = people.get(who, 0) + 1
        nights[time.localtime(m["viewedAt"]).tm_wday] += 1
        t = m.get("grandparentTitle") if m.get("type") == "episode" else m.get("title")
        if t:
            titles[t] = titles.get(t, 0) + 1
    week = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"]
    busiest = max(range(7), key=lambda i: nights[i]) if rows else None
    return {"days": days, "watched": len(rows), "hours": round(minutes / 60, 1),
            "people": sorted(({"name": k, "count": v} for k, v in people.items()), key=lambda x: -x["count"])[:6],
            "nights": [{"day": week[i][:3], "count": nights[i]} for i in range(7)],
            "busiest": week[busiest] if busiest is not None and nights[busiest] else None,
            "again": [{"title": k[:60], "count": v} for k, v in sorted(titles.items(), key=lambda kv: -kv[1]) if v > 1][:5]}


def _history():
    data = raw_history() or {}
    accounts = sources.cached("plex-accounts", 3600, _accounts) or {}
    out = []
    for m in (data.get("MediaContainer") or {}).get("Metadata") or []:
        title = m.get("title") or ""
        if m.get("type") == "episode" and m.get("grandparentTitle"):
            title = f"{m['grandparentTitle']}: {title}"
        out.append({"title": title[:90], "who": (accounts.get(m.get("accountID")) or "")[:40], "when": m.get("viewedAt")})
    return out[:40]


def history():
    return sources.cached("plex-history", 300, _history)


def _library_stats(section=None):
    dirs = (_json("/library/sections").get("MediaContainer") or {}).get("Directory") or []
    movie_secs = [s for s in dirs if s.get("type") == "movie"]
    if not movie_secs:
        return None
    if section and section != "all":
        target_secs = [s for s in movie_secs if str(s.get("key")) == str(section)]
        if not target_secs:
            target_secs = movie_secs[:1]
    else:
        target_secs = movie_secs

    items = []
    seen = set()
    for sec in target_secs:
        try:
            sec_items = (_json(f"/library/sections/{sec['key']}/all").get("MediaContainer") or {}).get("Metadata") or []
            for m in sec_items:
                rk = str(m.get("ratingKey") or "")
                dedup = (m.get("title", "").strip().lower(), m.get("year")) if len(target_secs) > 1 else rk
                if dedup not in seen:
                    seen.add(dedup)
                    items.append(m)
        except Exception:
            continue

    unwatched, total_size, unwatched_size, every = [], 0, 0, []
    for m in items:
        every.append({"key": str(m.get("ratingKey")), "minutes": round((m.get("duration") or 0) / 60000) or None})
        size = sum(p.get("size") or 0 for media in m.get("Media") or [] for p in media.get("Part") or [])
        total_size += size
        if not m.get("viewCount") and not m.get("viewOffset"):
            unwatched.append({"key": str(m.get("ratingKey")), "title": (m.get("title") or "")[:90], "year": m.get("year"),
                              "gb": round(size / 1e9, 1), "added": m.get("addedAt"), "thumb": m.get("thumb") if THUMB_PATH.match(m.get("thumb") or "") else None,
                              "art": m.get("art") if THUMB_PATH.match(m.get("art") or "") else None,
                              "minutes": round((m.get("duration") or 0) / 60000) or None, "summary": (m.get("summary") or "")[:400],
                              "rating": m.get("audienceRating") or m.get("rating"), "content_rating": m.get("contentRating"),
                              "genres": [g.get("tag") for g in m.get("Genre") or []][:3]})
            unwatched_size += size
    old = int(time.time()) - 180 * 86400
    stale = sorted((u for u in unwatched if (u["added"] or 0) < old), key=lambda u: -u["gb"])
    return {"movies": len(items), "watched": len(items) - len(unwatched), "total_gb": round(total_size / 1e9),
            "unwatched": len(unwatched), "unwatched_gb": round(unwatched_size / 1e9), "never_watched_old": stale[:12],
            "_unwatched": unwatched, "_all": every}


def library_stats(section=None):
    key = f"plex-stats-{section}" if section and section != "all" else "plex-stats"
    return sources.cached(key, 1800, lambda: _library_stats(section))


def pick(kids=False, max_minutes=None, skip=(), section=None):
    """Movie night: one unwatched movie at random, optionally family-friendly or short enough for tonight."""
    import random
    try:
        stats = library_stats(section) if section else library_stats()
    except TypeError:
        stats = library_stats()
    stats = stats or {}
    pool = [u for u in stats.get("_unwatched") or [] if u["key"] not in skip]
    if kids:
        pool = [u for u in pool if (u.get("content_rating") or "") in ("G", "PG", "TV-G", "TV-Y", "TV-Y7", "TV-PG")]
    if max_minutes:
        pool = [u for u in pool if u.get("minutes") and u["minutes"] <= max_minutes]
    return random.choice(pool) if pool else None
