"""The front gate (docs/superpowers/specs/2026-10-24-one-home-design.md): Caddy on the Pi asks GET /api/gate before
any *.home.arpa tool loads. Signed in as the owner → 200 with X-Remote-User; otherwise → the hub's sign-in, which
sends you back to where you were. The session cookie is shared with every *.home.arpa name as `hub_gate`."""
from urllib.parse import quote, urlsplit

HOME = "https://home.home.arpa/"
COOKIE = "hub_gate"
DOMAIN = ".home.arpa"


def _ours(host):
    host = (host or "").lower()
    return host == "home.arpa" or host.endswith(DOMAIN)


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
    return f"{HOME}?signin=owner&next={quote(safe_next(original_url(headers)), safe='')}"


def cookie_kwargs(host, max_age):
    """Cookie settings for `hub_gate` when the sign-in came through a home.arpa name; None otherwise."""
    if not _ours((host or "").split(":")[0]):
        return None
    return dict(domain=DOMAIN, secure=True, httponly=True, samesite="lax", path="/", max_age=max_age)
