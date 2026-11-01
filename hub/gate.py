"""The front gate (docs/superpowers/specs/2026-10-24-one-home-design.md): Caddy on the Pi asks GET /api/gate before
any *.home.arpa tool loads. Signed in as the owner → 200 with X-Remote-User; otherwise → the hub's sign-in, which
sends you back to where you were. home.arpa is a public suffix, so no cookie can span its names: each tool gets its own
host-only `hub_gate` cookie, handed over by a one-time code (`hub_gate_code`) that the gate spends on that tool's host."""
from urllib.parse import quote, unquote, urlsplit, urlunsplit

HOME = "https://home.home.arpa/"
COOKIE = "hub_gate"
CODE_PARAM = "hub_gate_code"
DOMAIN = ".home.arpa"


def _ours(host):
    host = (host or "").lower()
    return host == "home.arpa" or host.endswith(DOMAIN)


def on_home_arpa(host):
    """Whether the request's Host (port ignored) is a home.arpa name."""
    return _ours((host or "").split(":")[0])


def with_code(url, code):
    """The URL with the code appended raw (it is URL-safe), leaving the rest of the query as it was."""
    u = urlsplit(url)
    return urlunsplit(u._replace(query=f"{u.query}&{CODE_PARAM}={code}" if u.query else f"{CODE_PARAM}={code}"))


def split_code(url):
    """The URL without any hub_gate_code, and the first code value (None when there is none). The rest of the query
    is left byte for byte."""
    u = urlsplit(url)
    parts = u.query.split("&") if u.query else []
    mine = [p for p in parts if p.partition("=")[0] == CODE_PARAM]
    if not mine:
        return url, None
    rest = "&".join(p for p in parts if p.partition("=")[0] != CODE_PARAM)
    return urlunsplit(u._replace(query=rest)), unquote(mine[0].partition("=")[2])


def safe_next(url):
    """Only an https address on a home.arpa name; anything else goes to the hub's Home."""
    try:
        u = urlsplit(str(url or ""))
    except ValueError:
        return HOME
    if u.scheme != "https" or u.username or u.password or not _ours(u.hostname):
        return HOME
    return u.geturl()


def original_url(headers):
    """The address the person asked for, from Caddy's forward_auth headers."""
    proto = headers.get("x-forwarded-proto", "https")
    host = headers.get("x-forwarded-host", "")
    uri = headers.get("x-forwarded-uri", "/") or "/"
    return f"{proto}://{host}{uri if uri.startswith('/') else '/' + uri}"


def signin_url(headers):
    return f"{HOME}?signin=owner&next={quote(safe_next(split_code(original_url(headers))[0]), safe='')}"


def cookie_kwargs(max_age):
    """Settings for a tool's host-only `hub_gate` cookie."""
    return dict(secure=True, httponly=True, samesite="lax", path="/", max_age=max_age)


def lax_like(headers):
    """Whether a browser would send a SameSite=Lax cookie with the request behind this forward_auth check: one from the
    tool's own pages or typed into the address bar, or a top-level link to it that changes nothing. The owner's own
    devices pass the gate on these alone, so another website open on the Mac can't post to a tool as the owner (its
    gate cookie, being Lax, never could)."""
    method = (headers.get("x-forwarded-method") or "").upper()  # Caddy always sends it; without it, assume a change
    site = (headers.get("sec-fetch-site") or "").lower()
    if site in ("same-origin", "none"):
        return True
    if site:  # same-site, cross-site: home.arpa is a public suffix, so another tool counts as another site
        return method in ("GET", "HEAD") and (headers.get("sec-fetch-mode") or "").lower() == "navigate"
    # A browser without Fetch Metadata: its Origin (sent on every change) must be the tool's own address.
    origin = headers.get("origin")
    if origin is None:
        return method in ("GET", "HEAD")
    host = (headers.get("x-forwarded-host") or "").lower()
    return bool(host) and urlsplit(origin).netloc.lower() == host
