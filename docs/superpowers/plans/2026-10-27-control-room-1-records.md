# Control room, piece 1: records — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every thing the hub knows about has one record, built from one designated source, and Home, the wall, Needs you, Help's Source responses and the alert triggers all read those records, so no two pages can disagree.

**Architecture:** `hub/records.py` holds the record rules (states, severity, staleness, debounce), the in-memory store, the `records` and `record_events` tables and the change feed. `hub/things/` holds one pure builder per thing (source data in, record out) and `gather()`, which fetches each thing's designated source. `events.run` calls `records.refresh()` every 30 s; the Watcher's printer, PC, drive, Plex, Homebridge and Pi-heat triggers now come from record changes. `now.build`, `needs.build` and `freshness.snapshot` become views over records. No visible redesign.

**Tech Stack:** Python 3, FastAPI, SQLite (`hub/db.py`), pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-27-control-room-design.md` (Piece 1, and Errors, Testing, Rollout step 1).

## Global Constraints

- Stack stays FastAPI, SQLite and plain browser modules, with the existing release gate and rollback (C9).
- Each field of a record has one designated source; where two sources disagree, the record says so (C2).
- Quiet hours hold back the phone alert only; the event is always recorded (C3).
- A thing whose source stops answering keeps its last record, marked stale; it never turns "off" or "OK" by itself (C4).
- A change must last two checks before it counts (debounced kinds below); the PC must be off the network 5 minutes.
- Words are plain and task-shaped, matching the hub's existing copy ("The touchscreen is offline.", "Clear the plate").
- Today's JSON response shapes of `/api/now`, `/api/needs` and `/api/freshness` stay the same, so the current pages and the wall keep working unchanged.
- Checks before each commit: `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests` and `node --test tests/*.mjs`.

## Values pinned by this plan

| Name (in `hub/records.py` unless noted) | Value |
|---|---|
| `STALE_AFTER` (s, by source) | `bambuddy` 90, `pi_status` 90, `netmon` 120, `camera` 90, `plex` 120, `homebridge` 120, `cups` 300, `adguard` 900, `backrest` 900, `weather` 3600, `hub` 90 |
| `DEBOUNCED` kinds | `workshop_display`, `local_ai`, `pi`, `movies_drive`, `internet`, `adguard`, `plex`, `devices` |
| `PC_DOWN_AFTER` (`things/house.py`) | 300 s |
| `ATTEMPT_WINDOW` (`things/printer.py`) | 900 s |
| `DISAGREE_AFTER` | 300 s |
| `FINISHED_AT` (`things/printer.py`) | 97 (%) |
| `HOT_AT` (`things/house.py`) | 75 (°C) |
| `BACKUP_BEHIND` (`things/network.py`) | 48 h |

**States and severity** (`KINDS` in `hub/records.py`; every kind also has `unknown` → `attention`):

| Kind | state → severity |
|---|---|
| `printer` | printing ok · paused attention · finished attention · failed problem · idle ok · offline attention |
| `camera` | live ok · no_picture attention |
| `workshop_display` | online ok · offline attention |
| `pc` | on ok · off problem |
| `local_ai` | ready ok · busy ok · down problem |
| `pi` | ok ok · hot attention · power attention |
| `movies_drive` | connected ok · not_mounted attention · missing problem |
| `movie_copy` | up_to_date ok · behind attention |
| `internet` | ok ok · slow attention · down problem |
| `adguard` | blocking ok · not_answering attention |
| `backups` | ok ok · behind attention |
| `plex` | playing info · idle ok · stopped problem |
| `devices` | ok ok · stopped problem |
| `paper_printer` | ready ok · busy info · problem attention |
| `weather` | ok ok · warning attention |
| `hub` | ok ok · disagreement attention |

`devices` here is Homebridge's service only; one record per device is piece 8.

## Review Focus

1. **Hub restarts mid-print.** The first refresh after a restart must learn the printer's state without firing `print_started` (today's Watcher rule). Test in Task 5.
2. **Bambuddy's webhook and the records both report the same print.** The second report within `PRINT_DEDUPE` (600 s) must still be dropped. Test in Task 5.
3. **A source returns partial or odd JSON** (missing keys, `null`s, a string where a dict was expected). That thing's builder gives `unknown` with a cause, and the other things still refresh. Test in Task 5.
4. **The hub restarts.** Records come back from the `records` table marked stale until the first refresh, and a restart doesn't write state-change events for them. Test in Task 1.
5. **A browser leaves the records stream.** Its subscriber is removed, so the subscriber list doesn't grow. Test in Task 6.

---

### Task 1: The record rules and store

**Files:**
- Create: `hub/records.py`
- Test: `tests/test_records.py`

**Interfaces:**
- Produces:
  - `KINDS: dict[str, dict[str, str]]`: kind → {state: severity}, from the table above.
  - `STALE_AFTER: dict[str, int]`, `DEBOUNCED: set[str]`, `DISAGREE_AFTER = 300`.
  - `make(id: str, state: str, headline: str, source: str, *, cause: str = "", actions: list[dict] | None = None, detail: dict | None = None, disagree: str = "") -> dict`: a record **without** `since`, `as_of`, `stale`, `severity`. An action is `{"name": "pause", "label": "Pause the print", "confirm": False}`.
  - `merge(prev: dict | None, new: dict | None, now: float) -> dict`: the stored record. `new is None` means the source didn't answer: keep `prev`'s fields, set `stale` when `now - prev["as_of"] > STALE_AFTER[source]`, raise severity to at least `attention`, and set `cause` to "<Source> not answering since <HH:MM>; last read <n> min ago." With `new`: `as_of = now`; `since` is kept unless `state` changed; `severity = KINDS[id][state]`; debounced kinds keep `prev`'s state until the new state has been seen on 2 consecutive merges.
  - `store(recs: dict[str, dict], now: float) -> list[dict]`: saves to memory and the `records` table; returns the changes (one dict per thing whose `state` or `severity` changed: `{"id", "ts", "old", "new", "severity", "headline", "cause"}`) and writes each to `record_events`.
  - `load() -> None`: fills memory from the `records` table, every record `stale=True`, writing no events.
  - `all() -> dict[str, dict]`, `get(id: str) -> dict | None`, `problems() -> list[dict]` (severity attention or problem; problem first, then oldest `since` first).
  - `subscribe() -> queue.Queue`, `unsubscribe(q) -> None`; `store` puts each change on every subscriber's queue.
  - Tables: `records (id TEXT PRIMARY KEY, body TEXT NOT NULL)` (JSON), `record_events (ts INTEGER, thing TEXT, old TEXT, new TEXT, severity TEXT, headline TEXT, cause TEXT)`, both in this module's own `SCHEMA` created on first use, like `events.ready()`. `record_events` rows older than 30 days are deleted on each `store`.

- [ ] **Step 1: Write the failing tests**

```python
def test_severity_comes_from_the_state():
    r = records.merge(None, records.make("pc", "off", "The PC is off", "netmon"), 1000)
    assert (r["severity"], r["since"], r["as_of"], r["stale"]) == ("problem", 1000, 1000, False)

def test_silent_source_keeps_the_last_record_and_goes_stale():
    ok = records.merge(None, records.make("printer", "printing", "Printing v72, 12%", "bambuddy"), 1000)
    r = records.merge(ok, None, 1000 + 91)
    assert r["state"] == "printing" and r["stale"] is True
    assert r["severity"] == "attention" and "not answering" in r["cause"]

def test_a_debounced_change_needs_two_checks():
    a = records.merge(None, records.make("movies_drive", "connected", "Connected", "pi_status"), 0)
    b = records.merge(a, records.make("movies_drive", "missing", "Missing", "pi_status"), 30)
    assert b["state"] == "connected"
    c = records.merge(b, records.make("movies_drive", "missing", "Missing", "pi_status"), 60)
    assert (c["state"], c["since"]) == ("missing", 60)

def test_store_reports_and_logs_changes_only():
    p = records.merge(None, records.make("printer", "printing", "Printing v72, 12%", "bambuddy"), 1000)
    changes = records.store({"printer": p}, 1000)
    assert records.store({"printer": records.merge(p, records.make("printer", "printing", "Printing v72, 13%", "bambuddy"), 1030)}, 1030) == []
    assert [c["new"] for c in changes] == ["printing"]
    assert db.one("SELECT COUNT(*) n FROM record_events")["n"] == 1

def test_load_after_restart_is_stale_and_silent():
    records.store({"pc": on_record}, 1000)
    records._reset_memory()
    records.load()
    assert records.get("pc")["stale"] is True
    assert db.one("SELECT COUNT(*) n FROM record_events")["n"] == 1   # no new rows

def test_problems_are_worst_then_oldest_first():
    records.store({
        "workshop_display": records.merge(None, records.make("workshop_display", "offline", "Offline", "pi_status"), 100),
        "adguard": records.merge(None, records.make("adguard", "not_answering", "Down", "adguard"), 200),
        "pc": records.merge(None, records.make("pc", "off", "Off", "netmon"), 300),
        "internet": records.merge(None, records.make("internet", "ok", "Internet OK", "netmon"), 300),
    }, 300)
    assert [r["id"] for r in records.problems()] == ["pc", "workshop_display", "adguard"]
```

Tests reset state with `records._reset_memory()` and a fresh `HUB_DB` per module, as `tests/test_now.py` does. `merged(rec, at=T)` (used in Tasks 2–3) is a test helper in `tests/helpers_records.py`, created here: `records.merge(None, rec, at)`.

- [ ] **Step 2: Run them to see them fail**

Run: `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_records.py`
Expected: FAIL, `ModuleNotFoundError: hub.records`.

- [ ] **Step 3: Implement `hub/records.py`** to the interfaces above. Memory is a module dict behind a `threading.Lock`; the debounce counter lives in memory only (`_pending[id] = (state, count)`), and `_reset_memory()` exists for tests.

- [ ] **Step 4: Run them to see them pass**, then the whole suite.

- [ ] **Step 5: Commit** `feat(records): one record per thing, with severity, staleness and change log`

---

### Task 2: The printer's record

**Files:**
- Create: `hub/things/__init__.py` (empty for now), `hub/things/printer.py`
- Test: `tests/test_things_printer.py`

**Interfaces:**
- Consumes: `records.make`.
- Produces: `printer(b: dict | None, s: dict | None, lab: dict | None, prev: dict | None, now: float) -> dict | None`, where `b` is `sources.bambuddy_printer()`, `s` is `sources.pi_status()`, `lab` is `sources.localai_lab()`. Returns `None` when `b is None` (so `merge` marks it stale). Source `bambuddy`.

Rules:
- State from Bambuddy only: `RUNNING` printing, `PAUSE` paused, `FINISH` finished while `awaiting_plate_clear` else idle, `FAILED` failed while `awaiting_plate_clear` else idle, `IDLE` idle; `connected` false → offline. If the previous state was printing or paused and Bambuddy now says `IDLE` with the last progress below `FINISHED_AT`, the state is failed.
- `detail`: `job` (from `job_name`, `.gcode`/`.3mf` dropped), `progress`, `layer`, `total_layers`, `nozzle`, `nozzle_target`, `bed`, `bed_target`, `ams_humidity`, `filament_type`, `filament_color`, `attempt`, `lab` (when printing or paused), `last_progress`.
- `attempt`: 1, or the previous attempt + 1 when the state becomes printing with the same `job` as the previous record, which ended (failed or idle) less than `ATTEMPT_WINDOW` ago.
- `headline`: printing → "Printing HEX_TILE_v72, 12%" (with ", attempt 2" from the second attempt); paused → "Paused at 40%"; finished → "Done: clear the plate"; failed → "Stopped at 23%: clear the plate"; idle → "Idle"; offline → "The printer isn't connected to Bambuddy".
- `cause` for failed: "Stopped at <HH:MM> after <n> min; the printer gave no reason."
- `actions`: today's `now.printer_actions(b)` names, with labels "Clear the plate", "Pause the print", "Resume the print".
- `disagree`: when `s["x2d_state"]` maps to a different state than Bambuddy's (Printing/Paused/Idle/Stopped/Error; any other value, including "No status", counts as different), the text "pi-status reports <x2d_state>; Bambuddy reports <state>".

- [ ] **Step 1: Write the failing tests**

```python
def test_bambuddy_decides_even_when_pi_status_has_no_status():
    r = printer.printer(RUNNING_V72, {"x2d_state": "No status"}, None, None, T)
    assert r["state"] == "printing" and r["headline"] == "Printing HEX_TILE_v72, 12%"
    assert r["disagree"] == "pi-status reports No status; Bambuddy reports printing"

def test_idle_below_97_after_printing_is_a_failure(): ...
def test_a_restart_of_the_same_job_within_15_min_is_attempt_2():
    stopped = merged(printer.printer(IDLE_V72, None, None, printing_v72_at_10pct, T0), at=T0)
    again = printer.printer(RUNNING_V72, None, None, stopped, T0 + 300)
    assert again["detail"]["attempt"] == 2 and again["headline"].endswith(", attempt 2")
def test_a_restart_after_15_min_is_a_new_job(): ...
def test_finished_asks_to_clear_the_plate_until_bambuddy_says_cleared(): ...
def test_no_answer_from_bambuddy_returns_none(): ...
```

- [ ] **Step 2: Run them to see them fail.** Run: `… pytest … tests/test_things_printer.py`. Expected: FAIL on import.
- [ ] **Step 3: Implement `hub/things/printer.py`.**
- [ ] **Step 4: Run them to see them pass**, then the whole suite.
- [ ] **Step 5: Commit** `feat(records): the printer's record from Bambuddy, with attempts and disagreements`

---

### Task 3: The house's records

**Files:**
- Create: `hub/things/house.py`
- Modify: `hub/sources.py` (`_netmon`: add `"win_ok": success.get("10.0.0.21")` to its result)
- Test: `tests/test_things_house.py`

**Interfaces:**
- Consumes: `records.make`.
- Produces (each returns `None` when its source returned `None`):
  - `pc(net: dict | None, prev: dict | None, now: float) -> dict | None` (source `netmon`): `win_ok` true → on; false → stays on with cause "Not answering on the network for <n> min" until `PC_DOWN_AFTER`, then off (keep the first failure time in `detail["down_since"]`); `None` (probe missing) → unknown.
  - `local_ai(s) -> dict | None` (source `pi_status`, field `ai_state`): Ready ready, Busy busy, Down down. Down headline "Local AI isn't answering", cause "The PC is on; Local AI itself isn't answering." when the `pc` record is on (pass it as `pc_rec`: `local_ai(s, pc_rec)`).
  - `workshop_display(s)` from `display_state` (Online/Offline); offline headline "The touchscreen is offline."
  - `pi(s)` from `pi_temp` and `pi_power`: power not "Good" → power; temp ≥ `HOT_AT` → hot; else ok. Headline "Pi 66 °C".
  - `movies_drive(s)` from `drive_state` (Connected/Not mounted/Missing); not_mounted action `{"name": "remount:movies", "label": "Remount it"}`; missing cause "Unplug it, wait 10 seconds and plug it back in."
  - `movie_copy(s, now)` from `s["mirror"]["last_ok"]`: older than 2 days → behind.
  - `plex(s, sessions)`: `services.plex` false → stopped (action `restart:plex`, "Restart movie service"); any session → playing ("Playing <title>"); else idle.
  - `devices(s)`: `services.homebridge` false → stopped (action `restart:homebridge`, "Restart smart-home service"); else ok.
  - `paper_printer(p)` from `printing.printer_state()` (source `cups`).
  - `weather(w)` from `outside.weather()`: any `alerts` → warning with the first headline; else ok, headline "44° Clear, high 75°".

- [ ] **Step 1: Write the failing tests**, one per builder, including:

```python
def test_pc_answering_on_the_network_is_on_even_when_local_ai_is_down():
    pc_rec = house.pc({"win_ok": True}, None, T)
    ai = house.local_ai({"ai_state": "Down"}, merged(pc_rec))
    assert pc_rec["state"] == "on" and ai["state"] == "down"
    assert ai["cause"] == "The PC is on; Local AI itself isn't answering."

def test_pc_is_off_only_after_5_minutes_without_an_answer():
    first = merged(house.pc({"win_ok": False}, on, T), at=T)
    assert first["state"] == "on" and "Not answering" in first["cause"]
    assert house.pc({"win_ok": False}, first, T + 300)["state"] == "off"

def test_pi_at_75_is_hot(): ...
def test_not_mounted_drive_offers_remount(): ...
def test_stopped_plex_offers_restart(): ...
def test_missing_fields_give_unknown_not_an_error():
    assert house.workshop_display({})["state"] == "unknown"
```

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement `hub/things/house.py` and the `_netmon` field.**
- [ ] **Step 4: Run them to see them pass**, then the whole suite.
- [ ] **Step 5: Commit** `feat(records): the house's records (PC, Local AI, display, Pi, drive, copy, Plex, devices, paper printer, weather)`

---

### Task 4: Network, backups and camera records

**Files:**
- Create: `hub/things/network.py`
- Modify: `hub/sources.py` (add `camera_health()`), `hub/app.py:418-462` (`/api/camera` and its helpers call `sources.camera_health()`; `_printer_port_open` and `_camera_reason` move to `sources.py`)
- Test: `tests/test_things_network.py`

**Interfaces:**
- Produces:
  - `sources.camera_health() -> dict`: `{"ok", "source", "since", "reason", "sources"}`, exactly today's `/api/camera` body, cached 5 s.
  - `internet(net)` (source `netmon`): `status` "bad" → down; any of `wan_ms`, `dns_ms` over 100 → slow; "ok" → ok; "unknown" → unknown. Headline "Internet OK", "Internet slow", "Internet down".
  - `adguard(report)` from the `adguard:stats` helper report (source `adguard`): `ok` → blocking ("Blocking ads: <blocked> of <queries> today"); not ok → not_answering, headline "AdGuard isn't answering", cause "Ad blocking is off for the house until it answers."
  - `backups(report, now)` from the `backups:ages` helper report (source `backrest`): any machine older than `BACKUP_BEHIND` or never → behind, naming it ("The Mac hasn't backed up for 3 days"); else ok ("Backed up: Pi 22 h ago, Mac 1 h ago"). `detail["machines"]` lists each.
  - `camera(h)` (source `camera`): `ok` → live ("Live from the MacBook"); else no_picture with cause from `reason`: `liveview_off` → "LAN Only Liveview is off on the printer, and the Mac bridge has no picture."; `printer_unreachable` → "The printer isn't answering on the network."; otherwise "Neither camera bridge has a picture."

- [ ] **Step 1: Write the failing tests**, including `test_adguard_down_is_a_problem_even_when_the_internet_is_ok` (internet ok and adguard not_answering, both records, adguard severity attention) and `test_api_camera_body_is_unchanged` (TestClient, `sources.camera_health` monkeypatched).
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement `hub/things/network.py` and the camera move.**
- [ ] **Step 4: Run them to see them pass**, then the whole suite.
- [ ] **Step 5: Commit** `feat(records): internet, AdGuard, backups and camera records`

---

### Task 5: The refresh loop and the triggers

**Files:**
- Modify: `hub/things/__init__.py`, `hub/records.py` (add `refresh`), `hub/events.py` (`Watcher.check`, `run`, `MESSAGES["pc_down"]`), `hub/app.py:23-28` (call `records.load()` before the threads start)
- Test: `tests/test_records_loop.py`

**Interfaces:**
- Consumes: every builder from Tasks 2–4; `records.merge`, `records.store`.
- Produces:
  - `things.gather() -> dict`: each designated source fetched once, `None` for any that raised: keys `bambuddy`, `pi_status`, `netmon`, `lab`, `sessions`, `paper`, `weather`, `adguard`, `backups`, `camera`.
  - `things.build_all(inputs: dict, prev: dict[str, dict], now: float) -> dict[str, dict | None]`: every thing's new record (`None` = no answer). One builder raising gives that thing `make(id, "unknown", "No reading", <source>, cause="The hub couldn't read it: <ExceptionName>")` and the rest still build.
  - `records.refresh(now: float | None = None, inputs: dict | None = None) -> list[dict]`: `gather()` (unless `inputs` is given), `build_all`, `merge` each, the `hub` record (disagreement on any record lasting `DISAGREE_AFTER` → `disagreement`, headline "Two sources disagree about the printer", cause the record's `disagree` text), `store`; returns the changes.
  - `events.on_changes(changes: list[dict], first: bool) -> None`: maps changes to today's triggers, with `first=True` (the first refresh after start) firing nothing:

| Change | Fires |
|---|---|
| printer → printing, from anything but printing or paused | `print_started` (detail "attempt <n>" from the second attempt), `dedupe=PRINT_DEDUPE` |
| printer → finished | `print_finished`, `dedupe=PRINT_DEDUPE` |
| printer → failed | `print_failed`, detail "at <last_progress>%", `dedupe=PRINT_DEDUPE` |
| pc on → off / off → on | `pc_down` / `pc_back` |
| movies_drive → missing or not_mounted / → connected | `drive_dropped` / `drive_back` |
| plex → stopped | `plex_stopped` |
| devices → stopped | `homebridge_stopped` |
| pi → hot | `pi_hot`, detail "<temp> °C" |

  - `Watcher.check` keeps only the mirror, Paperless and spool checks; its printer, PC, drive, Plex, Homebridge and heat code is deleted. `run` calls `records.refresh()` then `on_changes` each cycle, inside its own `try`.
  - `MESSAGES["pc_down"]` becomes `("Windows PC is down", "It hasn't answered on the network for 5 minutes. Check the PC or the room's breaker.")`.

- [ ] **Step 1: Write the failing tests**

```python
def test_first_refresh_after_restart_fires_nothing(fired):        # Review Focus 1
    events.on_changes(records.refresh(T, inputs=PRINTING), first=True)
    assert fired == []

def test_a_stop_and_restart_fires_failed_then_started_attempt_2(fired): ...
def test_webhook_then_record_report_of_one_finish_fires_once(fired):  # Review Focus 2
    events.fire("print_finished", dedupe=events.PRINT_DEDUPE)
    events.on_changes(finish_changes, first=False)
    assert fired.count("print_finished") == 1

def test_odd_source_json_gives_unknown_and_others_still_refresh():    # Review Focus 3
    recs = things.build_all(dict(GOOD, pi_status="not a dict"), {}, T)
    assert recs["workshop_display"]["state"] == "unknown"
    assert recs["printer"]["state"] == "printing"

def test_disagreement_over_5_minutes_is_an_attention_on_hub(): ...
def test_pc_down_fires_on_the_network_not_on_local_ai(fired): ...
def test_quiet_hours_still_record_the_event(monkeypatch, fired):
    # quiet_now → True; a failed print still writes an events row and a record_events row
```

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement**, deleting the replaced Watcher code and its now-unused state (`pc_down_since`, `pc_reported`, `last_print`, `last_progress`).
- [ ] **Step 4: Run them to see them pass**, then the whole suite. Existing Watcher tests in `tests/test_stage*.py` that drive `check()` with pi-status printer, PC, drive or service states are rewritten to drive `refresh(inputs=…)` plus `on_changes`, keeping their assertions on what fires.
- [ ] **Step 5: Commit** `feat(records): refresh every 30 s; alert triggers come from record changes`

---

### Task 6: `/api/records` and the live stream

**Files:**
- Modify: `hub/app.py` (two routes)
- Test: `tests/test_records_api.py`

**Interfaces:**
- Consumes: `records.all`, `records.subscribe`, `records.unsubscribe`.
- Produces:
  - `GET /api/records` → `{"as_of": <now>, "records": [<record>, …]}` ordered as `KINDS`. Open to the same roles as `/api/now`.
  - `GET /api/records/stream` → `text/event-stream`. On connect one `event: snapshot` with the `/api/records` body; then one `event: change` per change (`data:` the change dict plus the full new record under `"record"`); a `: ping` comment every 15 s. The subscriber is removed when the client disconnects.

- [ ] **Step 1: Write the failing tests**: the list's order and fields; the stream's first event is the snapshot; a `store` during the stream delivers a `change`; after the client closes, `len(records._subscribers) == 0` (Review Focus 5).
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement** with `StreamingResponse`; the generator reads its queue with a 15 s timeout and checks `await request.is_disconnected()`, unsubscribing in `finally`.
- [ ] **Step 4: Run them to see them pass**, then the whole suite.
- [ ] **Step 5: Commit** `feat(records): /api/records and a live change stream`

---

### Task 7: Today's pages read the records

**Files:**
- Modify: `hub/now.py`, `hub/needs.py`, `hub/freshness.py`, `hub/app.py` (`api_now`, `api_needs`, `api_freshness`)
- Test: `tests/test_now.py`, `tests/test_needs.py`, `tests/test_freshness.py` (rewritten fixtures), `tests/test_views_from_records.py`

**Interfaces:**
- Consumes: `records.all()`, `records.problems()`; a test helper `tests/helpers_records.py: records_from(pi_status: dict, bambuddy: dict | None = None, net: dict | None = None, now: float = T) -> dict[str, dict]` built with `things.build_all` and `records.merge`.
- Produces (response shapes unchanged):
  - `now.build(recs: dict[str, dict], sessions, sampler, disk_free, network=None) -> dict`. `printer` comes from `recs["printer"]` mapped to today's keys (`state`, `headline`, `progress`, `left`, `detail`, `temperatures`, the flat temperature keys, `job_name`, `lab`, `actions`). `issues` come from `records.problems()`-ordered records as `{"tone": "bad" for problem else "warn", "what": <thing's label>, "say": headline plus cause, "href", "fix"/"fix_label" from the first action}`. `summary` keeps its wording. The movies, home, workshop and pi blocks read their records.
  - `needs.build(events, feed, now, problems: list[dict])`: the hub's items come from `problems`; `_printer` and the printer-event path are deleted (the printer record's finished and failed states now say "clear the plate"). Local AI cards and the two de-duplications stay.
  - `freshness.snapshot(configured=None, recs=None)`: one row per record (`key` = id, `label` = the thing's label, `state` "stale" or "current", `confirmed_at` = `as_of`, `reading` = headline, `max_age` = `STALE_AFTER[source]`), then the unconfigured rows (`calendar` and any `configured` false) as today. `freshness.record`/`observe` stay for the sources that still call them.
  - Thing labels (`LABELS` in `hub/records.py`): printer "Bambu X2D", camera "Printer camera", workshop_display "Workshop display", pc "Windows PC", local_ai "Local AI", pi "Raspberry Pi", movies_drive "Movies drive", movie_copy "Movie copy from the PC", internet "Internet", adguard "Ad blocking", backups "Backups", plex "Movies", devices "Smart-home controls", paper_printer "Document printer", weather "Weather", hub "The hub's sources".

- [ ] **Step 1: Rewrite the existing view tests' fixtures through `records_from`, keeping their assertions**, and add `test_views_from_records.py` with: AdGuard down appears in `/api/now` issues and `/api/needs`; a PC answering with Local AI down says "Local AI isn't answering", not "The PC may be off".
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** `api_now` passes `records.all()` and no longer calls `pi_status`, `bambuddy_printer` or `localai_lab` itself.
- [ ] **Step 4: Run the whole suite and the wall check** (`cd tests/browser && node wall.mjs http://127.0.0.1:8765 --stub` against a local hub started as in the README).
- [ ] **Step 5: Commit** `feat(records): Home, the wall, Needs you and Source responses read the records`

---

### Task 8: The night of 26–27 October, end to end

**Files:**
- Create: `tests/fixtures/night_2026_10_26.py` (recorded inputs for each refresh, as `gather()` dicts with times), `tests/test_night.py`

**Interfaces:**
- Consumes: `records.refresh(now, inputs)`, `events.on_changes`, the TestClient for `/api/now`, `/api/needs`, `/api/freshness`, `/api/records`.

The fixture replays, every 30 s where it matters:
- 01:20 v72 starts;
- 01:31 Bambuddy reports IDLE at 10% (pi-status "No status" throughout);
- 01:36 v72 starts again;
- 02:01 at 11%, AdGuard's report not ok, the workshop display offline since 00:02, the PC answering with Local AI down from 02:02, quiet hours on, the camera without a picture until 01:57.

- [ ] **Step 1: Write the tests**
  - `test_one_story_for_the_printer`: at 02:01, `/api/now`'s printer, `/api/records`' printer and `/api/freshness`' printer row all say printing at 11%, attempt 2; Workshop history's source (`record_events`) has failed at 01:31 and printing (attempt 2) at 01:36.
  - `test_the_stop_is_recorded_despite_quiet_hours`: a `print_failed` events row and a `record_events` row at 01:31; the phone alert held.
  - `test_needs_home_and_wall_agree`: the set of problem labels in `/api/needs` equals the set in `/api/now` issues, and includes Ad blocking, Workshop display, Local AI; not Windows PC.
  - `test_the_hub_flags_the_disagreement`: pi-status says "No status" while Bambuddy says printing from 01:20, so from 01:25 (5 minutes later) the `hub` record is `disagreement` about the printer.
- [ ] **Step 2: Run them.** Any failure is a bug in Tasks 1–7: fix it there, with its own test, before this task's commit.
- [ ] **Step 3: Run the whole suite and the node tests.**
- [ ] **Step 4: Commit** `test(records): the night of 26–27 October gives one consistent story`

---

### Task 9: Release and live check

**Files:**
- Modify: `docs/status.md` (a dated section: what changed, what was checked live)

- [ ] **Step 1: Run every check in the README's Checks section.** Expected: all pass, `git diff --check` clean.
- [ ] **Step 2: Ask the owner before releasing.** The release is `git push pi main` (the Pi's hook runs the gate and rolls back on failure). Do not push without their yes.
- [ ] **Step 3: Live check** (after a release): `curl -s https://home.home.arpa/api/records` lists 16 records, none stale after 60 s; Home, the wall and Help show the same printer state; Needs you lists AdGuard while it's down. Record what was checked, and anything that wasn't, in `docs/status.md`.
- [ ] **Step 4: Commit** `docs: control room piece 1 (records) live`
