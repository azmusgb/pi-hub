#!/usr/bin/env python3
import sqlite3
import sys

DB_PATH = "/mnt/usb1/netmon/uptime-kuma/kuma.db"

CUSTOM_CSS = """
/* === Ultra-Modern Linear/Apple Glassmorphic Theme === */
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

:root {
  --font-main: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

body.dark {
  font-family: var(--font-main);
  background-color: #07090e !important;
  background-image: 
    radial-gradient(ellipse 80% 50% at 50% -20%, rgba(56, 189, 248, 0.12), transparent),
    radial-gradient(circle at 100% 100%, rgba(99, 102, 241, 0.05), transparent 40%),
    radial-gradient(circle at 0% 100%, rgba(16, 185, 129, 0.04), transparent 40%) !important;
  background-attachment: fixed !important;
  color: #e2e8f0 !important;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Container width & alignment */
.container {
  max-width: 1040px !important;
  padding-left: 20px !important;
  padding-right: 20px !important;
}

/* Header & Title */
.title-flex {
  align-items: center;
  margin-top: 1.5rem !important;
  margin-bottom: 2rem !important;
  font-weight: 700;
  letter-spacing: -0.025em;
  font-size: 1.75rem !important;
  color: #f8fafc !important;
}

.logo {
  border-radius: 12px;
  box-shadow: 0 0 20px rgba(56, 189, 248, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 2px;
  background: rgba(255, 255, 255, 0.03);
}

/* Overall Status Banner */
.overall-status.shadow-box {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.14) 0%, rgba(6, 78, 59, 0.12) 100%) !important;
  border: 1px solid rgba(52, 211, 153, 0.3) !important;
  border-radius: 16px !important;
  padding: 1.25rem 1.75rem !important;
  box-shadow: 0 8px 30px rgba(16, 185, 129, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  margin-bottom: 2.25rem !important;
  font-size: 1.15rem !important;
  font-weight: 600 !important;
  letter-spacing: -0.01em;
  color: #34d399 !important;
  display: flex !important;
  align-items: center !important;
}

.overall-status svg {
  margin-right: 0.75rem;
  font-size: 1.35rem;
  filter: drop-shadow(0 0 6px rgba(52, 211, 153, 0.5));
}

/* Group Headers */
.group-title {
  font-size: 0.8125rem !important;
  font-weight: 700 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.08em !important;
  color: #94a3b8 !important;
  margin-top: 2rem !important;
  margin-bottom: 0.75rem !important;
  display: flex;
  align-items: center;
  padding-left: 0.25rem;
}

.group-title .chevron {
  font-size: 0.75rem;
  color: #64748b;
  transition: transform 0.2s ease;
}

/* Cards & Monitor Lists */
.dark .shadow-box:not(.alert):not(.overall-status) {
  background: rgba(15, 23, 42, 0.65) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 16px !important;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  overflow: hidden;
  padding: 0 !important;
}

/* Monitor Row Items */
.item {
  padding: 13px 20px !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important;
  transition: background-color 0.15s ease;
  display: flex;
  align-items: center;
}

.item:last-child {
  border-bottom: none !important;
}

.item:hover {
  background-color: rgba(255, 255, 255, 0.025) !important;
}

/* Monitor Title */
.item-name, .info a, .info span {
  font-size: 0.9375rem !important;
  font-weight: 600 !important;
  color: #f1f5f9 !important;
  letter-spacing: -0.01em;
  text-decoration: none !important;
}

.info a:hover {
  color: #38bdf8 !important;
}

/* Tags */
.tag-wrapper {
  border-radius: 6px !important;
  font-size: 0.675rem !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.04em !important;
  padding: 2px 7px !important;
  opacity: 0.95 !important;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  margin-left: 0.5rem;
}

/* Uptime Badge */
.badge.bg-primary {
  background: rgba(16, 185, 129, 0.12) !important;
  color: #34d399 !important;
  border: 1px solid rgba(52, 211, 153, 0.3) !important;
  border-radius: 9999px !important;
  font-family: var(--font-mono) !important;
  font-weight: 600 !important;
  font-size: 0.75rem !important;
  padding: 4px 10px !important;
  letter-spacing: -0.01em;
}

/* Heartbeat History Bars */
.hp-bar-big {
  border-radius: 6px;
  overflow: hidden;
}

.heartbeat-canvas {
  border-radius: 4px;
}

/* Ping / Latency Text */
.ping, [data-testid="ping"] {
  font-family: var(--font-mono) !important;
  font-size: 0.8125rem !important;
  color: #94a3b8 !important;
}

/* Footer */
footer {
  margin-top: 3.5rem !important;
  margin-bottom: 2.5rem !important;
  text-align: center;
  font-size: 0.8125rem !important;
  color: #64748b !important;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 1.5rem;
}

footer a {
  color: #94a3b8 !important;
  text-decoration: none;
}

footer a:hover {
  color: #38bdf8 !important;
}

/* Buttons */
.btn-primary {
  background: #2563eb !important;
  border-color: #3b82f6 !important;
  border-radius: 8px !important;
  font-weight: 600 !important;
  font-size: 0.8125rem !important;
  box-shadow: 0 2px 10px rgba(37, 99, 235, 0.25);
}
"""

def main():
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
    except Exception as e:
        print(f"Failed to connect to database: {e}", file=sys.stderr)
        sys.exit(1)

    cur.execute("UPDATE status_page SET custom_css = ? WHERE slug = 'home'", (CUSTOM_CSS.strip(),))
    conn.commit()
    conn.close()
    print("Custom CSS successfully written to kuma.db!")

if __name__ == "__main__":
    main()
