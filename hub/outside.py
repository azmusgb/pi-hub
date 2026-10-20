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


def _weather():
    place = auth.get("place")
    if not place:
        return None
    q = urllib.parse.urlencode({
        "latitude": place["lat"], "longitude": place["lon"], "timezone": place.get("tz") or "auto",
        "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset",
        "forecast_days": 3, "temperature_unit": "fahrenheit", "wind_speed_unit": "mph",
    })
    d = json.loads(_get(f"https://api.open-meteo.com/v1/forecast?{q}"))
    cur, day = d["current"], d["daily"]
    days = []
    for i, date in enumerate(day["time"]):
        days.append({"date": date, "high": round(day["temperature_2m_max"][i]), "low": round(day["temperature_2m_min"][i]),
                     "rain": day["precipitation_probability_max"][i], "sky": WEATHER_CODES.get(day["weather_code"][i], "")})
    return {
        "place": place["name"],
        "now": {"temp": round(cur["temperature_2m"]), "feels": round(cur["apparent_temperature"]),
                "sky": WEATHER_CODES.get(cur["weather_code"], ""), "code": cur["weather_code"], "wind": round(cur["wind_speed_10m"])},
        "days": days,
        "sunset": day["sunset"][0][-5:] if day.get("sunset") else None,
    }


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
