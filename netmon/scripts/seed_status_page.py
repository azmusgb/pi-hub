#!/usr/bin/env python3
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

    cur.execute("SELECT id FROM status_page WHERE slug = 'home'")
    row = cur.fetchone()
    if row:
        sp_id = row[0]
        print(f"Status page 'home' already exists (id={sp_id}).")
    else:
        cur.execute("""
            INSERT INTO status_page (
                slug, title, description, icon, theme, published,
                search_engine_index, show_tags, footer_text, show_powered_by,
                auto_refresh_interval
            ) VALUES (
                'home', 'Home Network & Infrastructure Status',
                'Real-time parallel observation of home LAN, gateway, WAN, and hardware.',
                '/icon.svg', 'dark', 1, 0, 0,
                'Monitored by Raspberry Pi 4 NETMON Appliance', 0, 60
            )
        """)
        sp_id = cur.lastrowid
        print(f"Created status page 'home' (id={sp_id}).")

    # Clean existing groups for this status page
    groups = cur.execute("SELECT id FROM `group` WHERE status_page_id = ?", (sp_id,)).fetchall()
    for g in groups:
        cur.execute("DELETE FROM monitor_group WHERE group_id = ?", (g[0],))
    cur.execute("DELETE FROM `group` WHERE status_page_id = ?", (sp_id,))

    categories = [
        ("🌐 Internet & Edge Demarcation", [1, 2, 3, 4, 5, 6]),
        ("🖥️ Workstations & Hardware", [7, 10]),
        ("⚡ Applications & Storage", [8, 9, 11, 12]),
    ]

    for weight, (gname, monitor_ids) in enumerate(categories):
        cur.execute("""
            INSERT INTO `group` (name, public, active, weight, status_page_id)
            VALUES (?, 1, 1, ?, ?)
        """, (gname, weight * 100, sp_id))
        gid = cur.lastrowid

        for m_weight, mid in enumerate(monitor_ids):
            cur.execute("""
                INSERT INTO monitor_group (monitor_id, group_id, weight)
                VALUES (?, ?, ?)
            """, (mid, gid, m_weight * 100))

    conn.commit()
    conn.close()
    print("Successfully populated status page groups and monitor assignments!")

if __name__ == "__main__":
    main()
