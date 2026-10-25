"""Find documents in Paperless (one home, Documents). The hub asks the PC directly with a view-only token: it is a
machine caller and can't sign in through the gate. Results link to Paperless itself; nothing is copied (D8)."""
import json
import urllib.request
from urllib.parse import urlencode

API = "http://10.0.0.21:8010/api/documents/"
TOKEN_FILE = "/etc/pi-hub/secrets/paperless_token"
OPEN = "tool:paperless"  # the page resolves it to the address in use (sections.js resolveLink)
MAX_QUERY = 100


def _token():
    try:
        with open(TOKEN_FILE) as f:
            return f.read().strip() or None
    except OSError:
        return None


def _get(url, token):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "Authorization": f"Token {token}"})
    with urllib.request.urlopen(req, timeout=4) as r:
        return json.load(r)


def search(q, n=8):
    """Matching documents, newest first (recent ones for an empty query); None when Paperless can't be asked."""
    token = _token()
    if not token:
        return None
    q = " ".join(str(q or "").split())[:MAX_QUERY]
    params = {"page_size": n, "ordering": "-created", **({"query": q} if q else {})}
    page = _get(f"{API}?{urlencode(params)}", token)
    return [{"id": d["id"], "title": str(d.get("title") or "Untitled")[:120], "created": str(d.get("created") or "")[:10],
             "link": f"{OPEN}/documents/{d['id']}/details"} for d in page.get("results") or []]
