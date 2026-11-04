"""Notices what changes in the house and runs the household's rules on it.

Every 30 seconds the records are refreshed (hub/records.py) and their changes become today's
triggers: a print starting or ending, the PC, the movies drive, Plex, Homebridge, the Pi's heat.
The records keep the existing debounce (a change has to last two checks) and the PC has to be
off the network for 5 minutes. The Watcher still checks the movie copy, the Paperless backup,
spools, the network alerts and the weather.
"""
import base64
import sys
import time
import traceback
import urllib.request

from . import auth, db, records, sources

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (ts INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS rule_runs (
  id INTEGER PRIMARY KEY, rule_id INTEGER, rule_text TEXT NOT NULL, trigger TEXT NOT NULL,
  action TEXT NOT NULL, ts INTEGER NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rule_runs_time ON rule_runs(ts);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY, trigger TEXT NOT NULL, action TEXT NOT NULL, target TEXT,
  label TEXT, enabled INTEGER NOT NULL DEFAULT 1, last_run INTEGER, last_result TEXT
);
"""

# trigger -> what people see in "When …"
TRIGGERS = {
    "print_finished": "a print finishes",
    "print_failed": "a print fails or stops early",
    "print_started": "a print starts",
    "drive_dropped": "the movies drive drops out",
    "drive_back": "the movies drive comes back",
    "pc_down": "the Windows PC is down for 5 minutes",
    "pc_back": "the Windows PC comes back",
    "plex_stopped": "Plex stops",
    "homebridge_stopped": "Homebridge stops",
    "pi_hot": "the Pi gets hotter than 75 °C",
    "filament_low": "a filament spool runs low",
    "wan_loss": "the Internet connection has sustained packet loss",
    "wan_down": "the Internet connection goes down",
    "mirror_stale": "the movies haven't been copied from the PC for two days",
    "paperless_stale": "Paperless hasn't been backed up to the Pi for two days",
    "weather_alert": "the weather service issues a warning",
    "rain_soon": "rain is on the way",
    "freeze_tonight": "it will freeze tonight",
}

# action -> (what people see in "then …", needs an accessory)
ACTIONS = {
    "notify": ("send a phone alert", False),
    "turn_on": ("turn on", True),
    "turn_off": ("turn off", True),
    "flash": ("flash", True),
    "rescan_plex": ("rescan the Plex library", False),
    "restart_plex": ("restart Plex", False),
    "restart_homebridge": ("restart Homebridge", False),
}

MESSAGES = {
    "print_finished": ("X2D print finished", "Ready to take off the plate."),
    "print_failed": ("X2D print stopped", "It ended before finishing. Check the printer."),
    "print_started": ("X2D print started", ""),
    "drive_dropped": ("Movies drive dropped out", "Unplug it, wait 10 seconds and plug it back in."),
    "drive_back": ("Movies drive is back", "Plex can play movies again."),
    "pc_down": ("Windows PC is down", "It hasn't answered on the network for 5 minutes. Check the PC or the room's breaker."),
    "pc_back": ("Windows PC is back", ""),
    "plex_stopped": ("Plex stopped", "Restart it from the hub's Pi page."),
    "homebridge_stopped": ("Homebridge stopped", "Restart it from the hub's Pi page."),
    "pi_hot": ("The Pi is running hot", "Above 75 °C."),
    "filament_low": ("Filament running low", "See Inventory in Bambuddy."),
    "wan_loss": ("Internet packet loss detected", "Sustained >5% packet loss on the WAN edge connection."),
    "wan_down": ("Internet connection down", "All external WAN probes are failing."),
    "mirror_stale": ("Movies not copied from the PC", "New films on the PC aren't on the Pi yet. See Drives in the hub."),
    "paperless_stale": ("Paperless backup missing", "No copy of your documents has reached the Pi for two days. Check that the PC is on."),
    "weather_alert": ("Weather warning", ""),
    "rain_soon": ("Rain on the way", ""),
    "freeze_tonight": ("Freezing tonight", "Cover plants and bring in anything that mustn't freeze."),
}

# A print failure reaches the phone only through hub/urgent.py; the seeded print_failed notify rule stays, labelled so
PRINT_FAILED_TEXT = "Print failures are sent by the hub's urgent alerts"
PRINT_FAILED_OLD_TEXT = "Send a phone alert when a 3D print fails or stops early"
PRINT_FAILED_SKIP = {"status": "skipped", "message": "Print failures reach your phone as the hub's urgent alerts."}

DEFAULT_RULES = [
    ("drive_back", "rescan_plex", None, "Find new movies when the drive comes back", 1),
    ("filament_low", "notify", None, "Tell me when a spool runs low", 1),
    ("weather_alert", "notify", None, "Pass on official weather warnings", 1),
    ("print_finished", "notify", None, "Send a phone alert when a 3D print finishes", 1),
    ("pc_down", "notify", None, "Send a phone alert when Windows PC is down for 5 minutes", 1),
    ("wan_loss", "notify", None, "Send a phone alert when sustained WAN packet loss occurs", 1),
    # Kept (seeding counts positions) but off: its light is the master bedroom's Floor Lamp, not a workshop light.
    ("print_finished", "flash", "27e5e4f8f7746b97a91a0a24384bd30696d4f76a751d582e35a0a4bb767547f6", "Flash the Floor Lamp when a print finishes", 0),
    ("print_failed", "notify", None, PRINT_FAILED_TEXT, 1),
    ("mirror_stale", "notify", None, "Tell me when the movies haven't been copied from the PC for two days", 1),
    ("paperless_stale", "notify", None, "Tell me when Paperless hasn't been backed up to the Pi for two days", 1),
]

TOPIC_FILE = "/etc/pi-status/ntfy_topic"
# ntfy servers, one per line: the Pi's own (http://127.0.0.1:8093) and, while phones still listen there, ntfy.sh.
SERVERS_FILE = "/etc/pi-status/ntfy_servers"


def ntfy_servers():
    try:
        with open(SERVERS_FILE) as f:
            servers = [line.strip().rstrip("/") for line in f if line.strip() and not line.startswith("#")]
    except OSError:
        servers = []
    return servers or ["https://ntfy.sh"]


_relabelled = set()  # DB files this process has relabelled the old print_failed rule in


def ready():
    db.conn().executescript(SCHEMA)
    seeded = auth.get("rules_seeded")
    if seeded is True:  # the first release seeded one rule
        seeded = 1
    for trig, act, target, label, on in DEFAULT_RULES[seeded or 0:]:
        db.run("INSERT INTO rules (trigger, action, target, label, enabled) VALUES (?, ?, ?, ?, ?)", trig, act, target, label, on)
    path = db.conn().execute("PRAGMA database_list").fetchone()[2]
    if path not in _relabelled:  # an existing install: the seeded rule, if its words are still the old default
        db.run("UPDATE rules SET label = ? WHERE trigger = 'print_failed' AND action = 'notify' AND label = ?",
               PRINT_FAILED_TEXT, PRINT_FAILED_OLD_TEXT)
        _relabelled.add(path)
    if (seeded or 0) < len(DEFAULT_RULES):
        auth.put("rules_seeded", len(DEFAULT_RULES))


# ---- Phone messages, respecting quiet hours ----

def quiet_now(now=None):
    q = auth.get("quiet_hours")
    if not q or not q.get("on"):
        return False
    t = time.localtime(now or time.time())
    minutes = t.tm_hour * 60 + t.tm_min
    start, end = (int(x.split(":")[0]) * 60 + int(x.split(":")[1]) for x in (q["from"], q["to"]))
    return start <= minutes < end if start < end else minutes >= start or minutes < end


def push(title, body="", tags="", priority="default", urgent=False, click=None):
    """Sends a phone message through ntfy. Quiet hours hold back anything that isn't urgent.
    click is the link a tap opens."""
    if quiet_now() and not urgent:
        return "Held back for quiet hours."
    try:
        with open(TOPIC_FILE) as f:
            topic = f.read().strip()
    except OSError:
        return "No alert topic is set up."
    title = " ".join(str(title).replace("\r", "").split("\n")).strip()
    try:
        title.encode("latin-1")
    except UnicodeEncodeError:  # ntfy reads RFC 2047 UTF-8 titles
        title = "=?UTF-8?B?" + base64.b64encode(title.encode()).decode() + "?="
    headers = {"Title": title, "Tags": tags, "Priority": priority}
    if click:
        headers["Click"] = click.replace("\r", "").replace("\n", "")
    sent = False
    for server in ntfy_servers():
        req = urllib.request.Request(f"{server}/{topic}", data=(body or title).encode(), method="POST",
                                     headers=headers)
        try:
            urllib.request.urlopen(req, timeout=10).close()
            sent = True
        except (OSError, ValueError):
            pass
    return "Sent." if sent else "The phone message didn't go out."


# ---- Rules ----

def rules():
    ready()
    return db.rows("SELECT * FROM rules ORDER BY id")


def describe(rule, names=None):
    if rule["trigger"] == "print_failed" and rule["action"] == "notify":
        return PRINT_FAILED_TEXT + "."
    when = TRIGGERS.get(rule["trigger"], rule["trigger"])
    what, needs = ACTIONS.get(rule["action"], (rule["action"], False))
    target = ((names or {}).get(rule["target"]) or "an accessory") if needs else ""
    return f"When {when}, {what}{' ' + target if target else ''}."


def add_rule(trigger, action, target=None):
    validate_rule(trigger, action, target)
    ready()
    if db.one("SELECT COUNT(*) AS n FROM rules")["n"] >= 40:
        raise ValueError("That's the most rules the hub keeps. Remove one first.")
    return db.run("INSERT INTO rules (trigger, action, target) VALUES (?, ?, ?)",
                  trigger, action, target if ACTIONS[action][1] else None).lastrowid


def policy(rule, kind, stamp=None, names=None, alerts_ready=None):
    if not rule.get("enabled", 1):
        return {"status": "skipped", "message": "Automation is turned off."}
    if rule["action"] == "notify":
        if kind == "print_failed":  # urgent.check is the one sender for a print failure
            return dict(PRINT_FAILED_SKIP)
        if kind != "weather_alert" and quiet_now(stamp):
            return {"status": "skipped", "message": "Phone alert held back for quiet hours."}
        if alerts_ready is False:
            return {"status": "blocked", "message": "No phone alert topic is configured."}
    if ACTIONS[rule["action"]][1] and names is not None and rule.get("target") not in names:
        return {"status": "blocked", "message": "The selected accessory is not currently available."}
    return {"status": "would_run", "message": "Would " + describe(rule, names).split(", ", 1)[1]}


def preview(b, names=None):
    if not isinstance(b, dict):
        raise ValueError("Supply the automation fields as an object.")
    if not isinstance(b.get("enabled", True), (bool, int)) or b.get("enabled", True) not in (0, 1):
        raise ValueError("Choose whether the automation is enabled.")
    trigger, action = str(b.get("trigger", "")), str(b.get("action", ""))
    validate_rule(trigger, action, b.get("target"))
    rule = {"trigger": trigger, "action": action, "target": b.get("target"), "enabled": b.get("enabled", True)}
    db.conn().executescript(SCHEMA)
    since = int(time.time()) - 30 * 86400
    matches = db.rows("SELECT ts, detail FROM events WHERE kind = ? AND ts >= ? ORDER BY ts DESC, rowid DESC LIMIT 100", trigger, since)
    alert_ready = topic_ready()
    samples = [{**event, **policy(rule, trigger, event["ts"], names, alert_ready)} for event in matches]
    return {"text": describe(rule, names), "days": 30, "matches": len(samples), "capped": len(samples) == 100,
            "would_run": sum(e["status"] == "would_run" for e in samples),
            "would_skip": sum(e["status"] == "skipped" for e in samples),
            "blocked": sum(e["status"] == "blocked" for e in samples), "samples": samples[:10],
            "now": policy(rule, trigger, names=names, alerts_ready=alert_ready),
            "note": "Preview only. Current settings and accessory availability are applied to recorded event times. No action was run."}


def validate_rule(trigger, action, target=None):
    if trigger not in TRIGGERS:
        raise ValueError("Choose what should start the rule.")
    if action not in ACTIONS:
        raise ValueError("Choose what the rule should do.")
    if ACTIONS[action][1] and (not isinstance(target, str) or not target or len(target) > 80):
        raise ValueError("Choose which light or plug.")


def execute(rule, kind, detail=""):
    from . import actions, homecontrol, urgent
    if rule.get("enabled", 1) and rule["action"] == "notify" and kind == "pc_down":
        try:
            if urgent.recently_pushed("pc", time.time()):
                return {"status": "skipped", "message": "Already sent as an urgent alert."}
        except Exception:  # can't tell: send the rule's own alert rather than leave the run stuck
            traceback.print_exc(file=sys.stderr)
    decision = policy(rule, kind)
    if decision["status"] != "would_run":
        return decision
    act = rule["action"]
    try:
        if act == "notify":
            title, body = MESSAGES.get(kind, (TRIGGERS.get(kind, kind), ""))
            text = f"{detail.rstrip('.')}. {body}".strip() if detail else body
            message = push(title, text, "warning" if kind == "weather_alert" else "bell", urgent=kind == "weather_alert")
            status = "succeeded" if message == "Sent." else "skipped" if message == "Held back for quiet hours." else "failed"
            return {"status": status, "message": message}
        if act in ("turn_on", "turn_off"):
            items = {a["id"]: a for a in homecontrol.accessories()}
            a = items.get(rule["target"])
            if not a or not a["control"]:
                return {"status": "blocked", "message": "That accessory isn't in Homebridge any more."}
            homecontrol.set_value(a["id"], a["control"], act == "turn_on")
            return {"status": "succeeded", "message": f"Turned {'on' if act == 'turn_on' else 'off'} {a['name']}."}
        if act == "flash":
            items = {a["id"]: a for a in homecontrol.accessories()}
            a = items.get(rule["target"])
            if not a or not a["control"]:
                return {"status": "blocked", "message": "That accessory isn't in Homebridge any more."}
            was_on = a.get("on")
            if was_on is None:  # nothing true to restore: a lamp that was really on would be left off
                return {"status": "blocked", "message": f"{a['name']}'s state isn't known, so it wasn't flashed."}
            homecontrol.set_value(a["id"], a["control"], not was_on)
            time.sleep(1.2)
            homecontrol.set_value(a["id"], a["control"], was_on)
            return {"status": "succeeded", "message": f"Flashed {a['name']}."}
        name = {"rescan_plex": "rescan:plex", "restart_plex": "restart:plex", "restart_homebridge": "restart:homebridge"}[act]
        return {"status": "succeeded", "message": actions.run(name)["message"]}
    except Exception as e:
        return {"status": "failed", "message": str(e)[:200] or "It didn't work."}


def run_action(rule, kind, detail=""):
    return execute(rule, kind, detail)["message"]


# Bambuddy's webhook and the printer status both report the same print start/finish/failure;
# whichever arrives second within this window is dropped.
PRINT_DEDUPE = 600
MIRROR_STALE = 2 * 86400


def fire(kind, detail="", dedupe=0):
    """Records an event and runs its rules. With dedupe (seconds), skips a repeat: the latest event in the
    same family (print_…) is this kind and fired that recently. A start after a failure still counts."""
    ready()
    stamp = int(time.time())
    if dedupe:
        last = db.one("SELECT kind, ts FROM events WHERE kind LIKE ? ORDER BY ts DESC, rowid DESC LIMIT 1",
                      kind.split("_")[0] + "_%")
        if last and last["kind"] == kind and last["ts"] >= stamp - dedupe:
            return False
    db.run("INSERT INTO events (ts, kind, detail) VALUES (?, ?, ?)", stamp, kind, detail[:200])
    db.run("DELETE FROM events WHERE ts < ?", stamp - 30 * 86400)
    db.run("DELETE FROM rule_runs WHERE ts < ?", stamp - 30 * 86400)
    for rule in db.rows("SELECT * FROM rules WHERE trigger = ?", kind):
        text = describe(rule)
        run_id = db.run("INSERT INTO rule_runs (rule_id, rule_text, trigger, action, ts, status, message) "
                        "VALUES (?, ?, ?, ?, ?, 'running', 'Started; no completion recorded yet.')",
                        rule["id"], text, kind, rule["action"], stamp).lastrowid
        start = time.monotonic()
        result = execute(rule, kind, detail)
        db.run("UPDATE rule_runs SET status = ?, message = ?, elapsed_ms = ? WHERE id = ?",
               result["status"], result["message"][:200], int((time.monotonic() - start) * 1000), run_id)
        db.run("UPDATE rules SET last_run = ?, last_result = ? WHERE id = ?", stamp, result["message"][:200], rule["id"])
        auth.log("rule", "Automations", f"rule:{rule['id']}", result["message"])


def history(limit=60):
    ready()
    return db.rows("SELECT * FROM rule_runs WHERE ts >= ? ORDER BY id DESC LIMIT ?",
                   int(time.time()) - 30 * 86400, min(100, max(1, limit)))


def recent(limit=40):
    ready()
    return db.rows("SELECT ts, kind, detail FROM events ORDER BY ts DESC, rowid DESC LIMIT ?", limit)


# ---- Record changes become triggers ----

# states that say nothing about the thing (it isn't answering, or answered something odd); a trigger
# compares with the last state that did say something, so a source dropping out and coming back
# doesn't report the same print or dropout twice
UNSURE = {"unknown", "offline"}
LIVE = {"printing", "paused"}
FINISHED_AT = 97  # percent; a print that ended below this was stopped early
_last = {}  # thing -> its last state outside UNSURE, as on_changes saw it (only events.run's thread)
_last_progress = {}  # "printer" -> the progress last seen while printing or paused; survives an offline gap
_hot = {}  # "pi" -> whether the Pi's last temperature reading was at or above house.HOT_AT


def _forget():
    _last.clear()
    _last_progress.clear()
    _hot.clear()


# thing -> [(new states, states it mustn't come from, trigger)]; the printer has its own rules below
ON = {
    "pc": [({"off"}, {"off"}, "pc_down"), ({"on"}, {"on"}, "pc_back")],
    "movies_drive": [({"missing", "not_mounted"}, {"missing", "not_mounted"}, "drive_dropped"),
                     ({"connected"}, {"connected"}, "drive_back")],
    "plex": [({"stopped"}, {"stopped"}, "plex_stopped")],
    "devices": [({"stopped"}, {"stopped"}, "homebridge_stopped")],
}  # pi_hot follows the Pi's temperature, whatever its state: see _note_heat


def _printer(before, new, rec):
    """The print trigger for a printer change, as (kind, detail), or None. A print that was live and is
    now idle, finished or failed ended one way or the other: Bambuddy's FINISH is a finish, its FAILED
    (or a failed record) is a failure, otherwise the last progress seen while printing decides."""
    d = rec.get("detail") or {}
    if new == "printing" and before not in LIVE:
        attempt = d.get("attempt") or 1
        return "print_started", f"attempt {attempt}" if attempt > 1 else ""
    pct = _last_progress.get("printer")
    if before in LIVE and new in ("idle", "finished", "failed"):
        failed = ("print_failed", f"at {pct if pct is not None else d.get('last_progress') or 0}%")
        if new == "finished" or d.get("bambuddy_state") == "FINISH":
            return "print_finished", ""
        if new == "failed" or d.get("bambuddy_state") == "FAILED" or (pct is not None and pct < FINISHED_AT):
            return failed
        return "print_finished", ""
    if new == "finished":
        return "print_finished", ""
    if new == "failed":  # no live print seen before it: the record's own progress
        return "print_failed", f"at {d.get('last_progress') or 0}%"
    return None


def _note_progress():
    rec = records.get("printer")
    if rec and rec["state"] in LIVE:
        p = (rec.get("detail") or {}).get("last_progress")
        _last_progress["printer"] = p if isinstance(p, (int, float)) else 0


def _fire(kind, detail, dedupe=0):
    try:
        fire(kind, detail, dedupe=dedupe)
    except Exception:
        traceback.print_exc(file=sys.stderr)


def on_changes(changes, first):
    """Fires today's triggers for the records that changed. The first refresh after a start fires
    nothing: a print already under way, or a PC already off, isn't news."""
    for ch in changes:
        new = ch["new"]
        if (ch["id"] not in ON and ch["id"] != "printer") or new in UNSURE:
            continue
        before = _last.get(ch["id"]) or (ch["old"] if ch["old"] not in UNSURE else None)
        _last[ch["id"]] = new
        if first or before is None or before == new:
            continue
        if ch["id"] == "printer":
            hit = _printer(before, new, ch["record"])
            if before in LIVE and new not in LIVE:  # the print ended: its progress is spent
                _last_progress.pop("printer", None)
            if hit:
                _fire(*hit, dedupe=PRINT_DEDUPE)
            continue
        for states, not_from, kind in ON[ch["id"]]:
            if new in states and before not in not_from:
                _fire(kind, "")
    # remembered after this cycle's changes, so the next cycle's end of a print sees the last live progress
    _note_progress()
    _note_heat(first)


def _note_heat(first):
    """pi_hot when the Pi's temperature crosses HOT_AT upwards. The temperature is read from the record,
    whose state is debounced (it keeps the old reading until a change has held two checks), and works
    whatever the state, since pi-status may report a power problem while the Pi is hot."""
    from .things.house import HOT_AT
    rec = records.get("pi")
    temp = ((rec or {}).get("detail") or {}).get("temp")
    if not isinstance(temp, (int, float)) or rec.get("stale"):
        return
    was, hot = _hot.get("pi"), temp >= HOT_AT
    _hot["pi"] = hot
    if hot and was is False and not first:
        _fire("pi_hot", f"{temp} °C")


# ---- Watching for changes ----

class Watcher:
    def __init__(self):
        self.seen = {"wan_loss": False, "wan_down": False}
        self.mirror_stale = False
        self.paperless_stale = False
        self.low_spools = None  # Bambuddy spool ids seen low; None until the first answer
        self.pending = {}
        self.alerts_seen = None
        self.rain_day = None
        self.freeze_day = None

    def _steady(self, key, value):
        """True once a new value has held for two checks; returns (changed, value)."""
        if key not in self.seen:
            self.seen[key] = value
            return False
        if value == self.seen[key]:
            self.pending.pop(key, None)
            return False
        self.pending[key] = self.pending.get(key, 0) + 1
        if self.pending[key] >= 2:
            self.seen[key] = value
            self.pending.pop(key)
            return True
        return False

    def _check_spools(self):
        """A spool that newly drops to low in Bambuddy (which takes each print's filament off by itself)."""
        from . import bambuddy
        spools = bambuddy.spools()
        if spools is None:
            return
        low = {sp["id"]: sp for sp in spools if sp["low"]}
        if self.low_spools is not None:
            for sid in sorted(low.keys() - self.low_spools):
                sp = low[sid]
                fire("filament_low", f"{sp['colour']} {sp['material']}, {sp['grams_left']} g left")
        self.low_spools = set(low)

    def check(self, s, now=None):
        """The movie copy, the Paperless backup and the spools (the rest comes from the records)."""
        now = now or time.time()
        if s is None:
            return
        mirror = s.get("mirror") or {}
        if mirror.get("last_ok"):
            stale = now - mirror["last_ok"] > MIRROR_STALE
            if stale and not self.mirror_stale:
                fire("mirror_stale", mirror.get("message") or "")
            self.mirror_stale = stale
        self._check_spools()
        paperless = s.get("paperless_backup") or {}
        if paperless.get("last_ok"):
            stale = now - paperless["last_ok"] > MIRROR_STALE
            if stale and not self.paperless_stale:
                fire("paperless_stale")
            self.paperless_stale = stale

    def check_network(self, alerts, now=None):
        if alerts is None:
            return
        has_loss = "PacketLossDetected" in alerts or "HighInternetLatency" in alerts
        if self._steady("wan_loss", has_loss) and has_loss:
            fire("wan_loss")

        has_down = "InternetDown" in alerts or "GatewayUnreachable" in alerts
        if self._steady("wan_down", has_down) and has_down:
            fire("wan_down")

    def check_weather(self, w, now=None):
        """Weather events: new official warnings, rain coming (once a day), and frost tonight (once a day, after 3 pm)."""
        if not w:
            return
        t = time.localtime(now or time.time())
        today = time.strftime("%Y-%m-%d", t)
        ids = {a["id"] for a in w.get("alerts") or []}
        if self.alerts_seen is not None:
            for a in w.get("alerts") or []:
                if a["id"] not in self.alerts_seen:
                    fire("weather_alert", a["headline"] or a["event"])
        self.alerts_seen = ids
        if w.get("soon") and w["soon"].startswith("Rain likely") and self.rain_day != today:
            self.rain_day = today
            fire("rain_soon", w["soon"])
        if w.get("freeze_tonight") and t.tm_hour >= 15 and self.freeze_day != today:
            self.freeze_day = today
            fire("freeze_tonight", f"Down to {w.get('tonight_low')}°.")


def loop_pass(first, now=None, inputs=None):
    """One records pass: refresh, the urgent pushes (every pass, the first too), then the rule triggers.
    The urgent check comes before the triggers so a print_failed or pc_down rule fired by this same
    refresh finds the urgent alert already sent and skips its own. Returns False when the refresh failed,
    so the hub's first pass is still to come."""
    from . import urgent
    try:
        changes = records.refresh() if now is None and inputs is None else records.refresh(now, inputs=inputs)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        return False
    now = time.time() if now is None else now
    try:
        from . import releases
        releases.loop(now)
    except Exception:
        traceback.print_exc(file=sys.stderr)
    try:
        urgent.check(records.all(), now)
    except Exception:
        traceback.print_exc(file=sys.stderr)
    try:
        on_changes(changes, first)
    except Exception:
        traceback.print_exc(file=sys.stderr)
    return True


def run(every=30):
    w = Watcher()
    time.sleep(20)
    first = True  # the first refresh after the hub starts only learns the state
    while True:
        if loop_pass(first):
            first = False
        try:
            w.check(sources.pi_status())
        except Exception:
            pass
        try:
            w.check_network(sources.active_network_alerts())
        except Exception:
            pass
        try:
            from . import outside
            w.check_weather(outside.weather())
        except Exception:
            pass
        time.sleep(every)


def topic_ready():
    try:
        with open(TOPIC_FILE) as f:
            return bool(f.read().strip())
    except OSError:
        return False

