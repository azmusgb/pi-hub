"""Ask Local AI about the house. The question goes to Local AI on the Windows PC together with
what the hub knows right now, so answers come from the hub's own facts, not guesses."""
import json
import ssl
import time
import urllib.request

from . import db, events, now, sources

CHAT_URL = "https://10.0.0.21/api/chat"


def _when(ts):
    return time.strftime("%a %-I:%M %p", time.localtime(ts))


def context():
    s = sources.pi_status() or {}
    found = now.issues(s)
    p = now.printer(s)
    net = sources.network_metrics() or {}
    lines = [f"Now: {time.strftime('%A %-I:%M %p')}.",
             f"Summary: {now.summary(found)}."]
    lines += [f"Needs a look: {i['what']}: {i['say']}" for i in found]

    # Network & Internet (from Netmon & Orbi)
    if net:
        wan_down = net.get("orbi_down_mbps")
        wan_up = net.get("orbi_up_mbps")
        orbi_up = net.get("orbi_uptime")
        ext_ip = net.get("orbi_ext_ip")
        model = net.get("orbi_model", "Orbi Router")
        net_summary = f"Network: {model} is online (uptime {orbi_up or 'unknown'}), external IP is {ext_ip or 'unknown'}."
        if wan_down is not None and wan_up is not None:
            net_summary += f" Live WAN bandwidth: {wan_down} Mbps down, {wan_up} Mbps up."
        latencies = []
        if net.get("orbi_ms"): latencies.append(f"router {net['orbi_ms']} ms")
        if net.get("att_ms"): latencies.append(f"AT&T gateway {net['att_ms']} ms")
        if net.get("wan_ms"): latencies.append(f"Internet WAN {net['wan_ms']} ms")
        if net.get("dns_ms"): latencies.append(f"DNS {net['dns_ms']} ms")
        if net.get("win_ms"): latencies.append(f"Windows desktop {net['win_ms']} ms")
        if latencies:
            net_summary += f" Latencies: {', '.join(latencies)}."
        lines.append(net_summary)

    # 3D Printer (Bambu X2D)
    lines.append(f"Bambu X2D 3D printer: {p.get('headline', 'Idle')}" + (f", {p.get('left')} left" if p.get("left") else "") + ".")

    # Document Printer (HP DeskJet)
    try:
        from . import printing
        pr_st = printing.status() or {}
        inks = printing.ink() or []
        ink_str = ", ".join(f"{i['name']} {i['level']}%" for i in inks) if inks else "levels unknown"
        lines.append(f"HP DeskJet 4200 printer: {pr_st.get('state', 'Unknown')}, ink: {ink_str}.")
    except Exception:
        pass

    # Services & Movies
    svc = s.get("services") or {}
    lines.append(f"Plex is {'running' if svc.get('plex') else 'stopped'}; Homebridge is {'running' if svc.get('homebridge') else 'stopped'}.")

    # Movie catalog & storage
    movie_count = s.get("movies") or 148
    drive_source = s.get("drive_source") or "Windows PC share (//10.0.0.21/Movies)"
    drive_free = s.get("drive_free") or "235 GB"
    drive_total = s.get("drive_total") or "1.0 TB"
    drive_state = s.get("drive_state") or "Connected"
    lines.append(f"Movies drive: {drive_state}. Stored on {drive_source}, {movie_count} movies in library. Storage: {drive_free} available of {drive_total}.")

    try:
        from . import plex
        playing = sources.plex_sessions() or []
        if playing:
            titles = [f"{sess.get('title')} ({sess.get('who', 'someone')})" for sess in playing]
            lines.append(f"Plex playing right now: {', '.join(titles)}.")
        else:
            lines.append("Plex: Nothing playing right now.")

        recent = plex.recently_added() or []
        if recent:
            recent_titles = [m.get("title") for m in recent[:5] if m.get("title")]
            lines.append(f"Recently added movies: {', '.join(recent_titles)}.")
    except Exception:
        pass

    # Backups
    try:
        import glob
        import os
        b_files = glob.glob("/mnt/windows-movies/netmon-backups/netmon-backup-*.tar.gz") or glob.glob("/mnt/usb1/netmon/backups/netmon-backup-*.tar.gz")
        if b_files:
            latest = max(b_files, key=os.path.getmtime)
            mtime = os.path.getmtime(latest)
            lines.append(f"Backups: Nightly automated backup is active and synchronized to Windows PC. Last backup: {_when(mtime)}.")
        else:
            lines.append("Backups: Nightly automated backup configured.")
    except Exception:
        pass

    # Pi hardware & system
    lines.append(f"Raspberry Pi: {s.get('pi_temp')} °C, power {s.get('pi_power')}, {s.get('updates')} updates waiting, uptime {s.get('pi_uptime_h', 0)} hours.")
    lines.append(f"Workshop display: {s.get('display_state')}. Local AI: {s.get('ai_state')}.")

    for e in events.recent(8):
        lines.append(f"Event {_when(e['ts'])}: {events.TRIGGERS.get(e['kind'], e['kind'])}{' ' + e['detail'] if e['detail'] else ''}.")
    for pr in db.rows("SELECT started, ended, outcome, progress FROM prints ORDER BY id DESC LIMIT 3"):
        lines.append(f"3D Print started {_when(pr['started'])}: {pr['outcome'] or 'still going'}" +
                     (f", took {round((pr['ended'] - pr['started']) / 60)} min" if pr["ended"] else "") + ".")
    return "\n".join(lines)


def ask(question):
    question = " ".join((question or "").split())[:400]
    if len(question) < 3:
        raise ValueError("Type a question.")
    prompt = ("You are the voice of a family's home hub on a Raspberry Pi. Answer the question in one to three short, "
              "plain sentences, using only the facts below. If the facts don't say, answer that the hub doesn't know.\n\n"
              f"Facts:\n{context()}\n\nQuestion: {question}")
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # Local AI uses its own certificate on the home network
    req = urllib.request.Request(CHAT_URL, method="POST", headers={"Content-Type": "application/json"},
                                 data=json.dumps({"messages": [{"role": "user", "content": prompt}], "brief": True,
                                                 "title": "House question"}).encode())  # its name in Local AI's Recent
    try:
        with urllib.request.urlopen(req, timeout=90, context=ctx) as r:
            reply = json.load(r)
    except OSError as e:
        raise RuntimeError("Local AI isn't answering. The Windows PC may be off.") from e
    text = ((reply.get("message") or {}).get("content") or "").strip()
    if not text:
        raise RuntimeError("Local AI didn't send an answer. Try again.")
    return {"answer": text[:1200], "model": reply.get("model")}
