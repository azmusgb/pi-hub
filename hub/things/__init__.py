"""Every thing the hub knows about: fetch each source once, then build each thing's record.

gather() asks each designated source once (None for one that raised); build_all() turns those
answers into records. One builder going wrong gives its thing an "unknown" record and the rest
still build.
"""
from .. import mac_lab, records
from . import house, lab, network, printer


def _adguard():
    from .. import actions, sources
    # the same cache key as /api/network/adguard, so the helper is asked once every 5 minutes
    return sources.cached("helper-adguard", 300, lambda: actions.helper("adguard:stats", timeout=5))


def _backups():
    from .. import actions, sources
    # the same cache key as /api/system/backups
    return sources.cached("helper-backups", 300, lambda: actions.helper("backups:ages", timeout=5))


def _lab():
    """The print lab's view, asked only while the printer's current record is printing or paused."""
    from .. import sources
    rec = records.get("printer")
    return sources.lab_printing() if rec and rec["state"] in ("printing", "paused") else None


def _homebridge_login():
    from .. import homecontrol, sources
    return sources.cached("homebridge-login", 300, homecontrol.login_state)


def _obico():
    from .. import bambuddy
    return bambuddy.obico_status()


def _fetchers():
    from .. import outside, printing, sources
    return {"bambuddy": lambda: sources.bambuddy_printer(timeout=3), "pi_status": sources.pi_status,
            "netmon": sources.network_metrics, "lab": _lab, "sessions": sources.plex_sessions,
            "paper": printing.printer_state, "weather": outside.weather, "adguard": _adguard,
            "backups": _backups, "obico": _obico, "camera": sources.camera_health,
            "homebridge_login": _homebridge_login}


def gather():
    """What each source says now; None for a source that raised."""
    out = {}
    for key, fetch in _fetchers().items():
        try:
            out[key] = fetch()
        except Exception:
            out[key] = None
    return out


def _build(id, fn):
    try:
        return fn()
    except Exception as e:
        return records.make(id, "unknown", "No reading", records.SOURCE[id],
                            cause=f"The hub couldn't read it: {type(e).__name__}")


def build_all(inputs, prev, now):
    """Every thing's new record from the sources' answers (None: its source didn't answer)."""
    i = inputs.get
    s, net = i("pi_status"), i("netmon")
    out = {"printer": _build("printer", lambda: printer.printer(i("bambuddy"), s, i("lab"), prev.get("printer"), now)),
           "pc": _build("pc", lambda: house.pc(net, prev.get("pc"), now))}
    # Local AI's cause depends on the PC: this cycle's PC record, or the last one if NETMON didn't answer
    pc_rec = out["pc"] if out["pc"] is not None else prev.get("pc")
    builders = {
        "local_ai": lambda: house.local_ai(s, pc_rec),
        "workshop_display": lambda: house.workshop_display(s),
        "pi": lambda: house.pi(s),
        "movies_drive": lambda: house.movies_drive(s),
        "movie_copy": lambda: house.movie_copy(s, now),
        "plex": lambda: house.plex(s, i("sessions")),
        "devices": lambda: house.devices(s, i("homebridge_login")),
        "paper_printer": lambda: house.paper_printer(i("paper")),
        "weather": lambda: house.weather(i("weather")),
        "internet": lambda: network.internet(net),
        "adguard": lambda: network.adguard(i("adguard")),
        "backups": lambda: network.backups(i("backups"), now),
        "camera": lambda: network.camera(i("camera")),
    }
    # Failure detection reads the printer's state: this cycle's record, or the last one if Bambuddy was silent
    printer_rec = out["printer"] if out["printer"] is not None else prev.get("printer")
    builders["obico"] = lambda: printer.obico(i("obico"), printer_rec)
    builders["hms"] = lambda: printer.hms(i("bambuddy"))
    for id, fn in builders.items():
        out[id] = _build(id, fn)
    # The PC off during a print: this cycle's printer and Local AI, or the last ones if their source was
    # silent, but never a stale one (it would repeat a state nobody has confirmed). This cycle's Local AI
    # record has no since yet, so a down that was already down last cycle keeps that cycle's since.
    def fresh(rec):
        return rec if rec is not None and not rec.get("stale") else None

    def current(id):
        return out[id] if out[id] is not None else fresh(prev.get(id))

    ai = current("local_ai")
    if ai is not None and "since" not in ai:
        old = fresh(prev.get("local_ai"))
        ai = dict(ai, since=old["since"] if old and old["state"] == "down" and "since" in old else now)
    out["pc_printing"] = _build("pc_printing", lambda: house.pc_printing(current("printer"), ai, now))
    out["mac_lab"] = _build("mac_lab", lambda: lab.mac_lab_record(mac_lab.facts(), now))
    return out
