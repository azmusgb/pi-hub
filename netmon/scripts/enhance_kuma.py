#!/usr/bin/env python3
import json
import sqlite3
import sys

DB_PATH = "/mnt/usb1/netmon/uptime-kuma/kuma.db"

def main():
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
    except Exception as e:
        print(f"Failed to connect to database: {e}", file=sys.stderr)
        sys.exit(1)

    # 1. Set default entry page to the public status page
    entry_val = json.dumps("statusPage-home")
    cur.execute("INSERT OR REPLACE INTO setting (key, value) VALUES ('entryPage', ?)", (entry_val,))

    # 2. Show tags on status page and enable full 24h history bars
    cur.execute("UPDATE status_page SET show_tags = 1, show_only_last_heartbeat = 0 WHERE slug = 'home'")

    # 3. Create colorful category tags
    tags = {
        "Gateway": "#00d1b2", # Teal / Cyan
        "WAN": "#209cee",     # Blue
        "LAN": "#7957d5",     # Purple
        "Service": "#ff9f43"  # Warm Orange
    }

    cur.execute("DELETE FROM monitor_tag")
    cur.execute("DELETE FROM tag")

    tag_ids = {}
    for name, color in tags.items():
        cur.execute("INSERT INTO tag (name, color) VALUES (?, ?)", (name, color))
        tag_ids[name] = cur.lastrowid

    # 4. Map monitors to tags
    monitor_tag_map = {
        1: "Gateway", # Orbi
        2: "Gateway", # AT&T
        3: "WAN",     # Cloudflare 1.1.1.1
        4: "WAN",     # Google 8.8.8.8
        5: "WAN",     # DNS Google
        6: "WAN",     # Web Google
        7: "LAN",     # Windows Desktop
        8: "Service", # Windows SMB
        9: "Service", # Windows Web
        10: "LAN",    # Bambu Printer
        11: "Service",# Pi Hub
        12: "Service" # Grafana
    }

    for mid, tname in monitor_tag_map.items():
        tid = tag_ids[tname]
        cur.execute("INSERT INTO monitor_tag (monitor_id, tag_id) VALUES (?, ?)", (mid, tid))

    conn.commit()
    conn.close()
    print("Successfully enhanced Uptime Kuma with default Status Page, tags, and mappings!")

if __name__ == "__main__":
    main()
