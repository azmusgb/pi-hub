"""The mission-events contract (A35 §7.4), read from docs/contracts/mission-events-v1.json and nowhere else (M1b plan
decision 1): the sources and their types, each type's fields, the grammar, the limits and the never-accepted names all
come from the file, so the contract and this validator can't drift. A token the file uses that this module can't check
fails at load, never silently at a post.

A refusal names the event's index and the field's path, never the value, so a bad field can't carry text into a
response or a log."""
import json
import re
from datetime import datetime
from pathlib import Path

PATH = Path(__file__).resolve().parents[2] / "docs" / "contracts" / "mission-events-v1.json"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
ISO = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)")
CONTROL = re.compile(r"[\x00-\x09\x0b-\x1f\x7f]")  # control characters other than newline
MAX_DEPTH = 32  # objects and lists inside one event; the deepest the contract needs is 5 (links in a body)
SPECIAL = {"type", "body"}  # envelope fields checked by their own rules, not a grammar token


class Refused(Exception):
    """An event or batch the contract refuses: `status` and `code` as the contract's `errors` name them."""

    def __init__(self, status, code, detail, retry_after=None):
        super().__init__(detail)
        self.status, self.code, self.detail, self.retry_after = status, code, detail, retry_after


def _name(key):
    """A key as it may appear in a refusal: bounded and printable (keys are the caller's input too)."""
    return "".join(c if c.isprintable() else "?" for c in str(key)[:40])


def _spec(spec):
    """(token, optional, nullable) from a field's grammar string such as 'text:80 (… null or absent when not seen)'.
    The prose after the token is documentation, except '(optional' and 'null or absent', which are rules."""
    return re.split(r"[ (]", spec.strip(), maxsplit=1)[0], "(optional" in spec, "null or absent" in spec


def too_deep(value, limit=MAX_DEPTH):
    """Whether `value` nests objects or lists more than `limit` deep. Iterative, so a hostile depth can't overflow
    the stack before the recursive checks run."""
    stack = [(value, 1)]
    while stack:
        item, depth = stack.pop()
        children = item.values() if isinstance(item, dict) else item if isinstance(item, list) else ()
        if children and depth > limit:
            return True
        stack.extend((child, depth + 1) for child in children)
    return False


def parse_at(value):
    """An ISO 8601 date-time with an offset as a datetime, or None."""
    if not isinstance(value, str) or not ISO.fullmatch(value):
        return None
    try:
        at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return at if at.tzinfo else None


class Contract:
    def __init__(self, data):
        self.data = data
        self.version = data["version"]
        self.sources = {s: frozenset(types) for s, types in data["sources"].items()}
        self.types, self.shapes, self.limits = data["types"], data["shapes"], data["limits"]
        self.never = frozenset(data["never_accepted"])
        g = data["grammar"]
        self._slug = re.compile(g["slug"])
        self._sha = re.compile(g["sha"])
        self._repo = re.compile(g["repo"].split(", ", 1)[1])
        self._kinds = frozenset(k.strip() for k in g["child_id"].split("kind one of", 1)[1].split(","))
        self._path_max = int(re.search(r"text:(\d+)", g["path"]).group(1))
        self._aliases = {k: v for k, v in g.items() if re.fullmatch(r"(text|int|enum|list):\S+", v)}
        for spec in self._every_spec():
            self._resolve(_spec(spec)[0])  # raises for a token this module can't check

    def _every_spec(self):
        env = self.data["envelope"]
        yield from (v for k, v in {**env["required"], **env["optional"]}.items() if k not in SPECIAL)
        common = self.data["session_common"]
        yield from common["required"].values()
        yield from common["optional"].values()
        for t in self.types.values():
            yield from t["required"].values()
            yield from t["optional"].values()
        for fields in self.shapes.values():
            yield from fields.values()

    def _resolve(self, token):
        """A check for one grammar token: a function (value, initiative) -> bool, or a shape name."""
        if token in self._aliases:
            return self._resolve(self._aliases[token])
        if token in self.shapes:
            return token
        if token.startswith("list:"):
            inner, _, limit = token[5:].rpartition(":")
            return ("list", self._resolve(inner), int(limit))
        leaf = self._leaf(token)
        if leaf is None:
            raise ValueError(f"the contract names a type this validator can't check: {token}")
        return leaf

    def _leaf(self, token):
        if token.startswith("text:"):
            n = int(token[5:])
            return lambda v, _i: isinstance(v, str) and 1 <= len(v) <= n and not CONTROL.search(v)
        if token.startswith("enum:"):
            allowed = frozenset(token[5:].split("|"))
            return lambda v, _i: isinstance(v, str) and v in allowed
        if token.startswith("int:"):
            low, _, high = token[4:].partition("..")
            low, high = int(low), int(high)
            return lambda v, _i: isinstance(v, int) and not isinstance(v, bool) and low <= v <= high
        return {
            "slug": lambda v, _i: self.valid_slug(v),
            "sha": lambda v, _i: isinstance(v, str) and bool(self._sha.fullmatch(v)),
            "repo": lambda v, _i: isinstance(v, str) and bool(self._repo.fullmatch(v)),
            "uuid": lambda v, _i: isinstance(v, str) and bool(UUID.fullmatch(v)),
            "iso": lambda v, _i: parse_at(v) is not None,
            "bool": lambda v, _i: isinstance(v, bool),
            "path": lambda v, _i: (isinstance(v, str) and 1 <= len(v) <= self._path_max and not CONTROL.search(v)
                                   and not v.startswith("/") and ".." not in v.split("/")),
            "child_id": self._child_ok,
        }.get(token)

    def _child_ok(self, value, initiative):
        """`<initiative>:<kind>:<slug>`, of the event's own initiative."""
        parts = value.split(":") if isinstance(value, str) else []
        return (len(parts) == 3 and parts[0] == initiative and parts[1] in self._kinds
                and bool(self._slug.fullmatch(parts[2])))

    def valid_slug(self, value):
        return isinstance(value, str) and bool(self._slug.fullmatch(value))

    def accepts_version(self, header):
        """Whether a client's X-Mission-Contract header names the version this hub accepts."""
        return (header or "").strip() == str(self.version)

    def check(self, source, event, index):
        """None for an event `source` may post, else raises Refused. Order: depth (before anything recursive), size, never-accepted names, type, unknown
        fields, then grammar, so the most specific code wins."""
        at = f"event {index}"
        if not isinstance(event, dict):
            raise Refused(400, "bad_batch", f"{at}: not an object")
        if too_deep(event):
            raise Refused(400, "bad_field", f"{at}: nested deeper than {MAX_DEPTH}")
        if len(json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode()) > self.limits["event_bytes"]:
            raise Refused(413, "too_large", f"{at}: over {self.limits['event_bytes']} bytes")
        self._never_accepted(event, at)
        etype = event.get("type")
        if not isinstance(etype, str) or etype not in self.sources.get(source, ()):
            raise Refused(400, "unknown_type", f"{at}: type is not one {source} may send")
        env = self.data["envelope"]
        self._fields({**env["required"], **{k: v + " (optional)" for k, v in env["optional"].items()}},
                     event, at, initiative=None, skip=SPECIAL)
        body = event.get("body", {})
        if not isinstance(body, dict):
            raise Refused(400, "bad_field", f"{at}: body is not an object")
        self._fields(self._body_fields(source, etype), body, f"{at}: body", initiative=event["initiative"])

    def _body_fields(self, source, etype):
        t = self.types[etype]
        fields = {**t["required"], **{k: v + " (optional)" for k, v in t["optional"].items()}}
        if source == "claude" and etype != "gap":
            common = self.data["session_common"]
            fields.update(common["required"])
            fields.update({k: v + " (optional)" for k, v in common["optional"].items()})
        return fields

    def _never_accepted(self, value, path):
        if isinstance(value, dict):
            for key, inner in value.items():
                if key in self.never:
                    raise Refused(400, "unknown_field", f"{path}.{_name(key)}: never accepted")
                self._never_accepted(inner, f"{path}.{_name(key)}")
        elif isinstance(value, list):
            for i, inner in enumerate(value):
                self._never_accepted(inner, f"{path}[{i}]")

    def _fields(self, fields, obj, path, initiative, skip=frozenset()):
        """Unknown names first (any of them refuses the event), then each field's presence and grammar."""
        for key in obj:
            if key not in fields and key not in skip:
                raise Refused(400, "unknown_field", f"{path}.{_name(key)}: not in the contract")
        for key, spec in fields.items():
            if key in skip:  # type is checked before, body after
                continue
            token, optional, nullable = _spec(spec)
            if key not in obj:
                if not optional:
                    raise Refused(400, "bad_field", f"{path}.{key}: missing")
                continue
            if obj[key] is None and nullable:
                continue
            self._value(self._resolve(token), obj[key], f"{path}.{key}", initiative)

    def _value(self, check, value, path, initiative):
        if isinstance(check, str):  # a shape
            if not isinstance(value, dict):
                raise Refused(400, "bad_field", f"{path}: not an object")
            self._fields(self.shapes[check], value, path, initiative)
        elif isinstance(check, tuple):  # ("list", inner, limit)
            _, inner, limit = check
            if not isinstance(value, list) or len(value) > limit:
                raise Refused(400, "bad_field", f"{path}: not a list of at most {limit}")
            for i, item in enumerate(value):
                self._value(inner, item, f"{path}[{i}]", initiative)
        elif not check(value, initiative):
            raise Refused(400, "bad_field", f"{path}: doesn't fit its grammar")


def load(path=PATH):
    return Contract(json.loads(Path(path).read_text(encoding="utf-8")))


CURRENT = load()
