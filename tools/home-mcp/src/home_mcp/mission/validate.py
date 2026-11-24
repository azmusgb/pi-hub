"""Validators for mission events and manifests, driven by the two contract files in contract/ (copies of pi-hub's
docs/contracts/mission-events-v1.json and docs/missions/manifest.schema.json). Each returns a list of problems; empty
means ok. A problem names the field path and the rule, never the value, so a bad field can't carry text into a log."""
import json
import re
from datetime import datetime
from functools import cache
from pathlib import Path

# pi-hub owns both files; this package lives in the same repo (tools/home-mcp/src/home_mcp/mission/), so it reads
# them in place rather than keeping copies that could drift.
REPO_ROOT = Path(__file__).resolve().parents[5]
CONTRACT_FILE = REPO_ROOT / "docs" / "contracts" / "mission-events-v1.json"
SCHEMA_FILE = REPO_ROOT / "docs" / "missions" / "manifest.schema.json"
KINDS = ("initiative", "stage", "gate", "workstream", "task", "decision", "risk", "evidence", "experiment",
         "deliverable")
# Every list in a manifest and the kind its ids carry.
LIST_KIND = {"stages": "stage", "gates": "gate", "workstreams": "workstream", "tasks": "task",
             "decisions": "decision", "risks": "risk", "evidence": "evidence"}
_SLUG = re.compile(r"[a-z0-9][a-z0-9-]{1,39}")
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_ISO = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)")
_SHA = re.compile(r"[0-9a-f]{7,40}")
_REPO = re.compile(r"[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}")
_CONTROL = re.compile(r"[\x00-\x09\x0b-\x1f\x7f]")
_EXPERIMENT = re.compile(r"[a-z0-9][a-z0-9-]{1,39}/E-\d{3,6}")


def _load(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise RuntimeError(f"cannot read {path}: {type(e).__name__}. home-mission must run from a pi-hub checkout "
                           "(editable install: uv sync in tools/home-mcp)") from e


@cache
def load_contract() -> dict:
    return _load(CONTRACT_FILE)


@cache
def load_schema() -> dict:
    return _load(SCHEMA_FILE)


def _name(key) -> str:
    """A key as it may appear in a problem: bounded and printable (keys come from untrusted input too)."""
    text = str(key)[:40]
    return "".join(c if c.isprintable() else "?" for c in text)


def _int_bool(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _spec(spec: str) -> tuple[str, bool, bool]:
    """(type token, optional, nullable) from a grammar string like 'text:80 (from the transcript ...)'. The prose
    after the token is documentation, except '(optional' and 'null or absent', which are rules."""
    optional = "(optional" in spec
    nullable = "null or absent" in spec
    token = spec if spec.startswith("enum:") else re.split(r"[ (]", spec, maxsplit=1)[0]
    if token.startswith("enum:"):
        token = re.split(r" \(", token, maxsplit=1)[0]
    return token.strip(), optional, nullable


def _text_ok(value, limit: int) -> bool:
    return isinstance(value, str) and 1 <= len(value) <= limit and _CONTROL.search(value) is None


def _path_ok(value) -> bool:
    return (_text_ok(value, 300) and not value.startswith("/") and ".." not in value.split("/"))


def _matches(pattern: re.Pattern):
    return lambda v: isinstance(v, str) and pattern.fullmatch(v) is not None


def _int_ok(value, token: str) -> bool:
    low, _, high = token[4:].partition("..")
    return _int_bool(value) and int(low) <= value <= int(high)


# Leaf grammar tokens that take no argument.
_LEAVES = {
    "slug": _matches(_SLUG), "uuid": _matches(_UUID), "sha": _matches(_SHA), "repo": _matches(_REPO),
    "iso": lambda v: _matches(_ISO)(v) and _iso_parses(v), "bool": lambda v: isinstance(v, bool),
    "label": lambda v: _text_ok(v, 240), "path": _path_ok,
}


def _leaf_ok(token: str, value) -> bool | None:
    """Whether `value` satisfies a leaf token, or None when the contract names a token this validator lacks."""
    if token in _LEAVES:
        return _LEAVES[token](value)
    if token.startswith("text:"):
        return _text_ok(value, int(token[5:]))
    if token.startswith("enum:"):
        return isinstance(value, str) and value in token[5:].split("|")
    if token.startswith("int:"):
        return _int_ok(value, token)
    return None


def _check(spec: str, value, path: str, problems: list[str], initiative: str | None = None, kind: str | None = None,
           refs: list | None = None) -> None:
    """One value against one grammar token. For child_id, `initiative` pins the file's initiative and `kind` the
    kind the id must carry; `refs` collects (path, id) pairs that must resolve later."""
    token, _, nullable = _spec(spec)
    if value is None and nullable:
        return
    if token in load_contract()["shapes"]:
        _shape(token, value, path, problems, refs)
    elif token.startswith("list:"):
        inner, _, limit = token[5:].rpartition(":")
        if not isinstance(value, list) or not limit.isdigit() or len(value) > int(limit):
            problems.append(f"{path}: not a list of at most {limit} items")
            return
        for i, item in enumerate(value):
            _check(inner, item, f"{path}[{i}]", problems, initiative, kind, refs)
    elif token == "child_id":
        if not _child_ok(value, initiative, kind):
            problems.append(f"{path}: not {token}")
        elif refs is not None and kind is None:
            refs.append((path, value))
    else:
        ok = _leaf_ok(token, value)
        if ok is None:
            problems.append(f"{path}: the contract names a type this validator doesn't know")
        elif not ok:
            problems.append(f"{path}: not {token}")


def _iso_parses(value: str) -> bool:
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return False
    return True


def _child_ok(value, initiative: str | None, kind: str | None) -> bool:
    if not isinstance(value, str):
        return False
    parts = value.split(":")
    if len(parts) != 3 or _SLUG.fullmatch(parts[0]) is None or parts[1] not in KINDS \
            or _SLUG.fullmatch(parts[2]) is None:
        return False
    return (initiative is None or parts[0] == initiative) and (kind is None or parts[1] == kind)


def _shape(name: str, value, path: str, problems: list[str], refs: list | None = None) -> None:
    fields = load_contract()["shapes"][name]
    if not isinstance(value, dict):
        problems.append(f"{path}: not an object ({name})")
        return
    _fields(fields, value, path, problems, refs=refs)


def _fields(fields: dict, obj: dict, path: str, problems: list[str], skip: frozenset = frozenset(), **kw) -> None:
    """Required and optional fields of one object (a field is optional when its spec says so). Unknown fields are
    refused, except names in `skip`, which another check already reported."""
    for key, spec in fields.items():
        _, optional, _ = _spec(spec)
        if key not in obj:
            if not optional:
                problems.append(f"{path}.{key}: missing")
            continue
        _check(spec, obj[key], f"{path}.{key}", problems, **kw)
    for key in obj:
        if key not in fields and key not in skip:
            problems.append(f"{path}.{_name(key)}: unknown field")


def _never_accepted(value, path: str, banned: frozenset, problems: list[str]) -> None:
    """Names the contract refuses outright, at any depth: this is what keeps prompt or tool text out of the ledger
    even when a bug nests it."""
    if isinstance(value, dict):
        for key, inner in value.items():
            here = f"{path}.{_name(key)}"
            if key in banned:
                problems.append(f"{here}: never accepted")
            _never_accepted(inner, here, banned, problems)
    elif isinstance(value, list):
        for i, inner in enumerate(value):
            _never_accepted(inner, f"{path}[{i}]", banned, problems)


def validate_event(source: str, event) -> list[str]:
    """Problems with one event as `source` would post it (the envelope; type fields live in `body`). Pi Hub sets
    seq, received_at and source, so an event that carries them is refused as an unknown field."""
    contract = load_contract()
    if source not in contract["sources"]:
        return ["source: not a known source"]
    if not isinstance(event, dict):
        return ["event: not an object"]
    problems: list[str] = []
    _never_accepted(event, "event", frozenset(contract["never_accepted"]), problems)
    try:
        size = len(json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError):
        return problems + ["event: not JSON"]
    if size > contract["limits"]["event_bytes"]:
        problems.append(f"event: {size} bytes, over {contract['limits']['event_bytes']}")
    banned = frozenset(contract["never_accepted"])
    etype = event.get("type")
    allowed = contract["sources"][source]
    _envelope(contract, source, event, problems, banned)
    if isinstance(etype, str) and etype in allowed:
        body = event.get("body", {})
        if isinstance(body, dict):
            _body(contract, source, etype, body, problems, banned)
    return problems


def _envelope(contract: dict, source: str, event: dict, problems: list[str], banned: frozenset) -> None:
    """The envelope fields: required and optional, the type allowed for the source, unknown names refused."""
    env = contract["envelope"]
    for key, spec in {**env["required"], **env["optional"]}.items():
        if key not in event:
            if key in env["required"]:
                problems.append(f"event.{key}: missing")
        elif key == "type":
            if not isinstance(event[key], str) or event[key] not in contract["sources"][source]:
                problems.append(f"event.type: not allowed for source {source}")
        elif key == "body":
            if not isinstance(event[key], dict):
                problems.append("event.body: not an object")
        else:
            _check(spec, event[key], f"event.{key}", problems)
    for key in event:
        if key not in env["required"] and key not in env["optional"] and key not in banned:
            problems.append(f"event.{_name(key)}: unknown field")


def _body(contract: dict, source: str, etype: str, body: dict, problems: list[str], banned: frozenset) -> None:
    spec = contract["types"][etype]
    fields = {**spec["required"], **{k: (v if "(optional" in v else f"{v} (optional)")
                                      for k, v in spec["optional"].items()}}
    if source == "claude" and etype != "gap":
        common = contract["session_common"]
        fields.update(common["required"])
        fields.update({k: (v if "(optional" in v else f"{v} (optional)") for k, v in common["optional"].items()})
    _fields(fields, body, "event.body", problems, skip=banned)


def validate_manifest(obj) -> list[str]:
    """Problems with a manifest, by the schema file's rules."""
    if not isinstance(obj, dict):
        return ["manifest: not an object"]
    schema = load_schema()["fields"]
    problems: list[str] = []
    init = obj.get("initiative")
    initiative = init.get("id") if isinstance(init, dict) and isinstance(init.get("id"), str) \
        and _SLUG.fullmatch(init["id"]) else None
    ctx = {"initiative": initiative, "ids": {}, "refs": [], "typed_refs": []}
    for key, spec in schema.items():
        if key in obj:
            _section(key, spec, obj[key], problems, ctx)
        elif isinstance(spec, dict) and spec.get("required", False):
            problems.append(f"manifest.{key}: missing")
    for key in obj:
        if key not in schema:
            problems.append(f"manifest.{_name(key)}: unknown field")
    _cross_checks(obj, ctx, problems)
    return problems


def _section(key: str, spec, value, problems: list[str], ctx: dict) -> None:
    """One top-level manifest field: the version, the initiative object, the experiments, or a list of entities."""
    path = f"manifest.{key}"
    if key == "manifest":
        _check(spec["type"], value, path, problems)
    elif key == "initiative":
        if isinstance(value, dict):
            _fields(spec["fields"], value, path, problems)
        else:
            problems.append(f"{path}: not an object")
    elif key == "experiments":
        _experiments(value, problems)
    else:
        _list(key, spec["list_of"], value, path, problems, ctx)


def _cross_checks(obj: dict, ctx: dict, problems: list[str]) -> None:
    """Rules across the file: references resolve, stage numbers are unique, dependencies are acyclic."""
    ids = ctx["ids"]
    for path, ident, kind in ctx["typed_refs"]:
        if ids.get(ident) is None or ident.split(":")[1] != kind:
            problems.append(f"{path}: no {kind} with that id in this file")
    for path, ident in ctx["refs"]:
        if ident not in ids:
            problems.append(f"{path}: no entity with that id in this file")
    stages = obj.get("stages")
    stage_ns = [s.get("n") for s in stages if isinstance(s, dict) and _int_bool(s.get("n"))] \
        if isinstance(stages, list) else []
    if len(stage_ns) != len(set(stage_ns)):
        problems.append("manifest.stages: stage n is not unique")
    if isinstance(obj.get("dependencies"), list):
        problems.extend(_cycle(obj["dependencies"]))


def _list(name: str, item_spec, value, path: str, problems: list[str], ctx: dict) -> None:
    if not isinstance(value, list):
        problems.append(f"{path}: not a list")
        return
    if not isinstance(item_spec, dict):
        problems.append(f"{path}: the schema names a list this validator doesn't know")
        return
    for i, item in enumerate(value):
        here = f"{path}[{i}]"
        if not isinstance(item, dict):
            problems.append(f"{here}: not an object")
            continue
        _item(name, item_spec, item, here, problems, ctx)


def _item(name: str, fields: dict, item: dict, path: str, problems: list[str], ctx: dict) -> None:
    for key, spec in fields.items():
        here = f"{path}.{key}"
        nested = isinstance(spec, dict)  # a nested list (a stage's gates)
        optional = spec.get("optional", False) if nested else _spec(spec)[1]
        if key not in item:
            if not optional:
                problems.append(f"{here}: missing")
        elif nested:
            _list(key, spec["list_of"], item[key], here, problems, ctx)
        else:
            _item_field(name, key, spec, item[key], here, problems, ctx)
    for key in item:
        if key not in fields:
            problems.append(f"{path}.{_name(key)}: unknown field")
    if name == "evidence" and ("source" in item) == ("pr" in item):
        problems.append(f"{path}: exactly one of source or pr is required")


def _item_field(name: str, key: str, spec: str, value, here: str, problems: list[str], ctx: dict) -> None:
    """One scalar field of a manifest entity. Ids register as defined; stage and workstream fields and every other
    child id (dependency ends, evidence links) are references that must resolve once the whole file is read."""
    token, initiative = _spec(spec)[0], ctx["initiative"]
    if key == "id" and token == "child_id":
        kind = LIST_KIND.get(name)
        _check(spec, value, here, problems, initiative=initiative, kind=kind)
        if _child_ok(value, initiative, kind):
            if value in ctx["ids"]:
                problems.append(f"{here}: id is not unique in this file")
            ctx["ids"][value] = here
    elif key in ("stage", "workstream") and token == "child_id":
        _check(spec, value, here, problems, initiative=initiative, kind=key)
        if _child_ok(value, initiative, key):
            ctx["typed_refs"].append((here, value, key))
    elif token == "child_id":
        _check(spec, value, here, problems, initiative=initiative, refs=ctx["refs"])
    elif token.startswith("list:link"):
        _check(spec, value, here, problems, initiative=initiative)
        for j, link in enumerate(value if isinstance(value, list) else []):
            ent = link.get("entity") if isinstance(link, dict) else None
            if _child_ok(ent, initiative, None):
                ctx["refs"].append((f"{here}[{j}].entity", ent))
    else:
        _check(spec, value, here, problems)


def _experiments(value, problems: list[str]) -> None:
    if not isinstance(value, list):
        problems.append("manifest.experiments: not a list")
        return
    seen = set()
    for i, entry in enumerate(value):
        if not isinstance(entry, str) or _EXPERIMENT.fullmatch(entry) is None:
            problems.append(f"manifest.experiments[{i}]: not <project>/E-NNN")
        elif entry in seen:
            problems.append(f"manifest.experiments[{i}]: listed twice")
        else:
            seen.add(entry)


def _cycle(deps: list) -> list[str]:
    """A problem when the dependency edges (from -> to) contain a cycle. Malformed edges are the field checks' job."""
    graph: dict[str, list[str]] = {}
    for d in deps:
        if isinstance(d, dict) and isinstance(d.get("from"), str) and isinstance(d.get("to"), str):
            graph.setdefault(d["from"], []).append(d["to"])
    state: dict[str, int] = {}  # 1 on the current path, 2 finished
    for start in graph:
        if start in state:
            continue
        stack = [(start, iter(graph.get(start, [])))]
        state[start] = 1
        while stack:
            node, it = stack[-1]
            for nxt in it:
                if state.get(nxt) == 1:
                    return ["manifest.dependencies: contains a cycle"]
                if nxt not in state:
                    state[nxt] = 1
                    stack.append((nxt, iter(graph.get(nxt, []))))
                    break
            else:
                state[node] = 2
                stack.pop()
    return []
