"""Notices what changes in the house and runs the household's rules on it.

Every 30 seconds it compares the current state with the last one. A change has to last two
checks (a minute) before it counts, so blips don't fire rules. The Windows PC has to be
down for 5 minutes, since Local AI restarts quickly and the room's breaker trips don't.
"""
import time
import urllib.request

from . import auth, db, sources

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
    "pc_down": ("Windows PC is down", "Local AI has been unreachable for 5 minutes. Check the PC or the room's breaker."),
    "pc_back": ("Windows PC is back", ""),
    "plex_stopped": ("Plex stopped", "Restart it from the hub's Pi page."),
    "homebridge_stopped": ("Homebridge stopped", "Restart it from the hub's Pi page."),
    "pi_hot": ("The Pi is running hot", "Above 75 °C."),
    "filament_low": ("Filament running low", "Check the filament shelf in the hub."),
    "wan_loss": ("Internet packet loss detected", "Sustained >5% packet loss on the WAN edge connection."),
    "wan_down": ("Internet connection down", "All external WAN probes are failing."),
    "weather_alert": ("Weather warning", ""),
    "rain_soon": ("Rain on the way", ""),
    "freeze_tonight": ("Freezing tonight", "Cover plants and bring in anything that mustn't freeze."),
}

DEFAULT_RULES = [
    ("drive_back", "rescan_plex", None, "Find new movies when the drive comes back", 1),
    ("filament_low", "notify", None, "Tell me when a spool runs low", 1),
    ("weather_alert", "notify", None, "Pass on official weather warnings", 1),
    ("print_finished", "notify", None, "Send a phone alert when a 3D print finishes", 1),
    ("pc_down", "notify", None, "Send a phone alert when Windows PC is down for 5 minutes", 1),
    ("wan_loss", "notify", None, "Send a phone alert when sustained WAN packet loss occurs", 1),
]

TOPIC_FILE = "/etc/pi-status/ntfy_topic"


def ready():
    db.conn().executescript(SCHEMA)
    seeded = auth.get("rules_seeded")
    if seeded is True:  # the first release seeded one rule
        seeded = 1
    for trig, act, target, label, on in DEFAULT_RULES[seeded or 0:]:
        db.run("INSERT INTO rules (trigger, action, target, label, enabled) VALUES (?, ?, ?, ?, ?)", trig, act, target, label, on)
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


def push(title, body="", tags="", priority="default", urgent=False):
    """Sends a phone message through ntfy. Quiet hours hold back anything that isn't urgent."""
    if quiet_now() and not urgent:
        return "Held back for quiet hours."
    try:
        with open(TOPIC_FILE) as f:
            topic = f.read().strip()
    except OSError:
        return "No alert topic is set up."
    req = urllib.request.Request(f"https://ntfy.sh/{topic}", data=(body or title).encode(), method="POST",
                                 headers={"Title": title, "Tags": tags, "Priority": priority})
    try:
        urllib.request.urlopen(req, timeout=10).close()
        return "Sent."
    except OSError:
        return "The phone message didn't go out."


# ---- Rules ----

def rules():
    ready()
    return db.rows("SELECT * FROM rules ORDER BY id")


def describe(rule, names=None):
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
    from . import actions, homecontrol
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
            was_on = a.get("on", False)
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


def fire(kind, detail=""):
    ready()
    stamp = int(time.time())
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


# ---- Watching for changes ----

class Watcher:
    def __init__(self):
        self.seen = {"wan_loss": False, "wan_down": False}
        self.pending = {}
        self.pc_down_since = None
        self.pc_reported = None
        self.last_print = None
        self.last_progress = 0
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

    def check(self, s, now=None):
        now = now or time.time()
        if s is None:
            return
        svc = s.get("services") or {}
        if s.get("drive_state") in ("Connected", "Missing", "Not mounted"):
            if self._steady("drive", s["drive_state"] == "Connected"):
                fire("drive_back" if self.seen["drive"] else "drive_dropped")
        else:
            self.pending.pop("drive", None)
        for key in ("plex", "homebridge"):
            if isinstance(svc.get(key), bool):
                if self._steady(key, svc[key]) and not self.seen[key]:
                    fire(f"{key}_stopped")
            else:
                self.pending.pop(key, None)
        if s.get("pi_temp") is not None:
            if self._steady("hot", s["pi_temp"] > 75) and self.seen["hot"]:
                fire("pi_hot", f"{s['pi_temp']} °C")
        else:
            self.pending.pop("hot", None)

        pc_up = s.get("ai_state") in ("Ready", "Busy")
        if s.get("ai_state") not in ("Ready", "Busy", "Down"):
            self.pc_down_since = None
        elif pc_up:
            self.pc_down_since = None
            if self.pc_reported is False:
                fire("pc_back")
            self.pc_reported = True
        else:
            self.pc_down_since = self.pc_down_since or now
            if now - self.pc_down_since >= 300 and self.pc_reported is not False:
                fire("pc_down")
                self.pc_reported = False

        state = s.get("x2d_state")
        if state == "Printing":
            if self.last_print not in ("Printing", "Paused"):
                fire("print_started")
            self.last_progress = s.get("x2d_progress") or 0
        elif self.last_print in ("Printing", "Paused") and state in ("Idle", "Stopped", "Error"):
            if state == "Error" or (state in ("Stopped", "Idle", "No status") and self.last_progress < 97):
                fire("print_failed", f"at {self.last_progress}%")
            else:
                fire("print_finished")
        if state in ("Printing", "Paused", "Idle", "Stopped", "Error"):
            self.last_print = state

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


def run(every=30):
    w = Watcher()
    time.sleep(20)
    while True:
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

