"""The world outside: weather from Open-Meteo for the saved town, and the next calendar items."""
import datetime as dt
import json
import urllib.parse
import urllib.request

from . import auth, sources

WEATHER_CODES = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers",
    82: "Heavy showers", 85: "Snow showers", 86: "Snow showers", 95: "Thunderstorms", 96: "Thunderstorms", 99: "Thunderstorms",
}


def _get(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": "pi-hub/1 (home dashboard)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def find_place(name):
    name = " ".join((name or "").split())[:80]
    if len(name) < 2:
        raise ValueError("Type a town or city.")
    q = urllib.parse.urlencode({"name": name.split(",")[0], "count": 5, "language": "en", "format": "json"})
    data = json.loads(_get(f"https://geocoding-api.open-meteo.com/v1/search?{q}"))
    results = data.get("results") or []
    if "," in name:
        hint = name.split(",", 1)[1].strip().lower()
        results = [r for r in results if hint in (r.get("admin1", "") + " " + r.get("country", "") + " " + r.get("country_code", "")).lower()] or results
    if not results:
        raise ValueError(f"Couldn't find “{name}”. Try adding the state or country, like “Springfield, Illinois”.")
    r = results[0]
    return {"name": ", ".join(x for x in (r.get("name"), r.get("admin1"), r.get("country_code")) if x),
            "lat": round(r["latitude"], 3), "lon": round(r["longitude"], 3), "tz": r.get("timezone") or "auto"}


def units():
    return auth.get("units", "F")


def _icon(code, is_day=True):
    """One of a small set of drawn icons for the weather codes."""
    if code in (0, 1):
        return "clear-day" if is_day else "clear-night"
    if code == 2:
        return "partly-day" if is_day else "partly-night"
    if code == 3:
        return "cloudy"
    if code in (45, 48):
        return "fog"
    if code in (71, 73, 75, 77, 85, 86):
        return "snow"
    if code in (95, 96, 99):
        return "storm"
    if code in (56, 57, 66, 67):
        return "sleet"
    return "rain"


def _clock(iso):
    """'2026-10-20T15:00' -> '3 PM'; with minutes when they aren't zero."""
    t = dt.datetime.fromisoformat(iso)
    return t.strftime("%-I %p") if t.minute == 0 else t.strftime("%-I:%M %p")


def _weather():
    place = auth.get("place")
    if not place:
        return None
    f = units() == "F"
    q = urllib.parse.urlencode({
        "latitude": place["lat"], "longitude": place["lon"], "timezone": place.get("tz") or "auto",
        "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,relative_humidity_2m,uv_index,is_day,precipitation",
        "hourly": "temperature_2m,precipitation_probability,weather_code,is_day",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code,sunrise,sunset,uv_index_max,wind_speed_10m_max",
        "forecast_days": 7, "forecast_hours": 30,
        "temperature_unit": "fahrenheit" if f else "celsius", "wind_speed_unit": "mph" if f else "kmh",
        "precipitation_unit": "inch" if f else "mm",
    })
    d = json.loads(_get(f"https://api.open-meteo.com/v1/forecast?{q}"))
    cur, hr, day = d["current"], d["hourly"], d["daily"]
    now_iso = cur["time"][:13]
    hours = []
    for i, t in enumerate(hr["time"]):
        if t[:13] < now_iso:
            continue
        hours.append({"time": t, "label": _clock(t), "temp": round(hr["temperature_2m"][i]),
                      "rain": hr["precipitation_probability"][i] or 0, "icon": _icon(hr["weather_code"][i], hr["is_day"][i])})
    hours = hours[:24]
    days = []
    for i, date in enumerate(day["time"]):
        days.append({"date": date, "high": round(day["temperature_2m_max"][i]), "low": round(day["temperature_2m_min"][i]),
                     "rain": day["precipitation_probability_max"][i] or 0, "amount": day["precipitation_sum"][i] or 0,
                     "sky": WEATHER_CODES.get(day["weather_code"][i], ""), "icon": _icon(day["weather_code"][i]),
                     "uv": round(day["uv_index_max"][i] or 0), "wind": round(day["wind_speed_10m_max"][i] or 0),
                     "sunrise": _clock(day["sunrise"][i]), "sunset": _clock(day["sunset"][i])})
    # The one thing worth saying about the next hours, in plain words.
    soon = None
    raining = (cur.get("precipitation") or 0) > 0 or cur["weather_code"] >= 51
    if raining:
        dry = next((h for h in hours[1:12] if h["rain"] < 30), None)
        soon = f"Rain should ease around {dry['label']}." if dry else "Rain all afternoon and evening." if hours else None
    else:
        wet = next((h for h in hours[:8] if h["rain"] >= 50), None)
        if wet:
            soon = f"Rain likely from around {wet['label']} ({wet['rain']}%)."
    freeze = (32 if f else 0)
    tonight_low = min((h["temp"] for h in hours[:16]), default=None)
    return {
        "place": place["name"], "units": units(),
        "now": {"temp": round(cur["temperature_2m"]), "feels": round(cur["apparent_temperature"]),
                "sky": WEATHER_CODES.get(cur["weather_code"], ""), "code": cur["weather_code"], "icon": _icon(cur["weather_code"], cur["is_day"]),
                "wind": round(cur["wind_speed_10m"]), "gusts": round(cur["wind_gusts_10m"] or 0), "humidity": cur["relative_humidity_2m"],
                "uv": round(cur["uv_index"] or 0), "raining": raining},
        "hours": hours, "days": days, "soon": soon,
        "freeze_tonight": tonight_low is not None and tonight_low <= freeze,
        "tonight_low": tonight_low,
        "sunset": days[0]["sunset"] if days else None,
        "sunrise": days[1]["sunrise"] if len(days) > 1 else None,
        "air": _air(place), "alerts": _alerts(place),
    }


AQI = [(50, "Good"), (100, "Moderate"), (150, "Unhealthy for sensitive groups"), (200, "Unhealthy"), (300, "Very unhealthy"), (10_000, "Hazardous")]


def _air(place):
    try:
        q = urllib.parse.urlencode({"latitude": place["lat"], "longitude": place["lon"], "current": "us_aqi,pm2_5", "timezone": "auto"})
        a = json.loads(_get(f"https://air-quality-api.open-meteo.com/v1/air-quality?{q}"))["current"]
        aqi = a.get("us_aqi")
        if aqi is None:
            return None
        return {"aqi": round(aqi), "label": next(label for top, label in AQI if aqi <= top)}
    except Exception:  # noqa: BLE001
        return None


def _alerts(place):
    """Official warnings from the US National Weather Service. Outside the US there are none to show."""
    try:
        req = urllib.request.Request(f"https://api.weather.gov/alerts/active?point={place['lat']},{place['lon']}",
                                     headers={"User-Agent": "pi-hub (home dashboard)", "Accept": "application/geo+json"})
        with urllib.request.urlopen(req, timeout=8) as r:
            feats = json.load(r).get("features") or []
    except Exception:  # noqa: BLE001
        return []
    out = []
    for f in feats[:5]:
        p = f.get("properties") or {}
        out.append({"id": str(p.get("id") or "")[-40:], "event": str(p.get("event") or "Weather alert")[:60],
                    "headline": str(p.get("headline") or "")[:200], "severity": p.get("severity"),
                    "ends": p.get("ends") or p.get("expires"), "advice": str(p.get("instruction") or "")[:400]})
    return out


def weather():
    return sources.cached("weather", 900, _weather)


def _calendar():
    url = auth.get("calendar_url")
    if not url:
        return None
    import icalendar
    import recurring_ical_events
    cal = icalendar.Calendar.from_ical(_get(url.replace("webcal://", "https://"), timeout=15))
    now = dt.datetime.now().astimezone()
    out = []
    for ev in recurring_ical_events.of(cal).between(now, now + dt.timedelta(days=7)):
        start = ev.get("DTSTART").dt
        all_day = not isinstance(start, dt.datetime)
        when = dt.datetime.combine(start, dt.time()).astimezone() if all_day else start.astimezone()
        end = ev.get("DTEND").dt if ev.get("DTEND") else None
        if all_day and end and dt.datetime.combine(end, dt.time()).astimezone() <= now:
            continue
        if not all_day and end and isinstance(end, dt.datetime) and end.astimezone() < now:
            continue
        out.append({"title": str(ev.get("SUMMARY", "Busy"))[:80], "start": int(when.timestamp()), "all_day": all_day,
                    "where": str(ev.get("LOCATION", ""))[:60]})
    return sorted(out, key=lambda e: (e["start"], not e["all_day"]))[:8]


def calendar():
    return sources.cached("calendar", 900, _calendar)


def check_calendar(url):
    url = (url or "").strip()
    if not url.startswith(("https://", "webcal://")):
        raise ValueError("Paste the calendar's secret address. It starts with https:// or webcal://.")
    import icalendar
    try:
        icalendar.Calendar.from_ical(_get(url.replace("webcal://", "https://"), timeout=15))
    except Exception as e:  # noqa: BLE001
        raise ValueError("That address didn't return a calendar. Copy the iCal or ICS link again.") from e
    return url
