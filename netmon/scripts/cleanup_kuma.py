#!/usr/bin/env python3
import sqlite3
import sys

DB_PATH = "/mnt/usb1/netmon/uptime-kuma/kuma.db"

clean_names = {
    1: "Orbi Wi-Fi Router",
    2: "AT&T Fiber Gateway",
    3: "Cloudflare WAN (1.1.1.1)",
    4: "Google WAN (8.8.8.8)",
    5: "Google Public DNS",
    6: "Google HTTPS Web",
    7: "Windows 11 Workstation",
    8: "Windows Movies Share",
    9: "Windows Local AI",
    10: "Bambu P1S 3D Printer",
    11: "Pi Hub Web App",
    12: "Grafana Dashboards"
}

def main():
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
    except Exception as e:
        print(f"Failed to connect to database: {e}", file=sys.stderr)
        sys.exit(1)

    for mid, name in clean_names.items():
        cur.execute("UPDATE monitor SET name = ? WHERE id = ?;", (name, mid))

    # Clear stale error events from the initial setup before ignore_tls was enabled
    cur.execute("DELETE FROM heartbeat WHERE important = 1 AND status = 0;")

    conn.commit()
    conn.close()
    print("Successfully renamed monitors and cleared stale error event from event log!")

if __name__ == "__main__":
    main()
