"""The front gate (docs/superpowers/specs/2026-10-24-one-home-design.md): Caddy on the Pi asks GET /api/gate before
any *.home.arpa tool loads. Signed in as the owner → 200 with X-Remote-User; otherwise → the hub's sign-in, which
sends you back to where you were. home.arpa is a public suffix, so no cookie can span its names: each tool gets its own
host-only `hub_gate` cookie, handed over by a one-time code (`hub_gate_code`) that the gate spends on that tool's host."""
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

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
    u = urlsplit(url)
    query = urlencode(parse_qsl(u.query, keep_blank_values=True) + [(CODE_PARAM, code)])
    return urlunsplit(u._replace(query=query))


def split_code(url):
    """The URL without any hub_gate_code, and the first code value (None when there is none)."""
    u = urlsplit(url)
    pairs = parse_qsl(u.query, keep_blank_values=True)
    codes = [v for k, v in pairs if k == CODE_PARAM]
    if not codes:
        return url, None
    query = urlencode([(k, v) for k, v in pairs if k != CODE_PARAM])
    return urlunsplit(u._replace(query=query)), codes[0]


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
