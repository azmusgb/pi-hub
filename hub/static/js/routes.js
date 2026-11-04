// The hub's addresses, in one place (platform step 7, PR 7.4): the pages the shell draws and the old paths it moves.
// The router (main.js, sections.js) imports this, and the server (hub/app.py) reads the same object at start-up to
// answer every other path with a real 404. Everything after "export default" is plain JSON, so keep it that way.
export default {
  "pages": ["/", "/wall", "/weather", "/workshop", "/lab", "/documents", "/print", "/lists", "/media", "/drives",
            "/network", "/system", "/backups", "/versions", "/alerts", "/rules", "/settings", "/more"],
  "redirects": {
    "/next": "/",
    "/movies": "/media",
    "/control": "/network",
    "/pi": "/system",
    "/apps": "/",
    "/apps/bambuddy": "/workshop",
    "/bambuddy": "/workshop",
    "/apps/grafana": "/network",
    "/grafana": "/network",
    "/apps/status": "/network",
    "/status": "/network",
    "/apps/scan": "/documents"
  }
};
