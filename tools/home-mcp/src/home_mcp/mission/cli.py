"""`home-mission`: validate a manifest, import it, drain the spool, show the spool, and the /mission skill's actions
(attach, detach, task, status). This CLI writes (to the spool, the attach binding and Pi Hub's mission routes), unlike
the read-only MCP tools. Exit codes: 0 ok, 1 a problem or refusal, 2 Pi Hub has no mission routes yet."""
import argparse
import asyncio
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .. import hub, shell
from . import drain, importer, local, spool
from .validate import validate_event, validate_manifest

BATCH_SOURCE = "importer"


def _load(path: str):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8")), None
    except (OSError, ValueError) as e:
        return None, f"cannot read {path}: {type(e).__name__}"


def _problems(label: str, problems: list[str]) -> None:
    for p in problems:
        print(f"{label}: {p}")


def cmd_validate(args) -> int:
    manifest, err = _load(args.manifest)
    if err:
        print(err)
        return 1
    problems = validate_manifest(manifest)
    _problems("manifest", problems)
    print("ok" if not problems else f"{len(problems)} problems")
    return 1 if problems else 0


def _build(args):
    """(result, None) or (None, exit code) after printing why."""
    manifest, err = _load(args.manifest)
    if err:
        print(err)
        return None, 1
    problems = validate_manifest(manifest)
    if problems:
        _problems("manifest", problems)
        return None, 1
    ref = {"repo": args.repo, "path": args.path or f"docs/missions/{Path(args.manifest).name}", "commit": args.commit}
    result = importer.build(manifest, ref, print_lab=args.print_lab)
    bad = 0
    for i, ev in enumerate(result.events):
        for p in validate_event(BATCH_SOURCE, ev):
            print(f"event {i} ({ev['type']}): {p}")
            bad += 1
    return (result, None) if not bad else (None, 1)


def cmd_import(args) -> int:
    result, code = _build(args)
    if result is None:
        return code
    counts = Counter(e["type"] for e in result.events)
    for etype, n in counts.items():
        print(f"{n:4d} {etype}")
    for u in result.unavailable:
        print(f"unavailable: {u['id']} ({u['reason']})")
    if args.dry_run:
        print(f"{len(result.events)} events, all valid; nothing sent")
        return 0
    return asyncio.run(_send(result.events))


async def _send(events: list[dict]) -> int:
    key, why = await drain.source_key(BATCH_SOURCE, shell.run)
    if key is None:
        print(f"no importer key: {why}")
        return 1
    async with hub.make_client() as client:
        if client.base_url.scheme != "https":
            print("HOME_MCP_HUB_URL isn't https, so the key isn't sent")
            return 1
        for i in range(0, len(events), drain.BATCH):
            out = await drain.post_batch(client, BATCH_SOURCE, key, events[i:i + drain.BATCH])
            if out.kind == "ok":
                continue
            if out.code == 404:
                print("Pi Hub has no mission routes yet (M1b)")
                return 2
            print(f"Pi Hub did not take the import: {'HTTP ' + str(out.code) if out.code else out.detail}"
                  f" (sent {i} of {len(events)} events; re-running is safe, ids are stable)")
            return 1
    print(f"sent {len(events)} events")
    return 0


def cmd_drain(args) -> int:
    r = asyncio.run(drain.drain())
    print(f"{r.status}: {r.detail}" if r.detail else r.status,
          f"posted {r.posted}, dropped {r.dropped}, kept {r.kept}" if r.status in ("done", "stopped") else "")
    return 1 if r.status == "stopped" else 0


def cmd_spool(args) -> int:
    s = spool.status()
    print(f"{s['count']} events waiting" + (f" ({', '.join(f'{k} {v}' for k, v in s['by_source'].items())})" if s["by_source"] else ""))
    if s["oldest_at"]:
        try:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(s["oldest_at"])
            print(f"oldest: {s['oldest_at']} ({int(age.total_seconds())} s ago)")
        except ValueError:
            print("oldest: unreadable time")
    if s["corrupt"]:
        print(f"{s['corrupt']} unreadable lines (the next drain or removal discards them)")
    return 0


def _child(initiative: str, kind: str, value: str) -> str | None:
    """A child id of the bound initiative, from either the full id or its last segment ("measure")."""
    cid = value if ":" in value else f"{initiative}:{kind}:{value}"
    parts = cid.split(":")
    ok = len(parts) == 3 and parts[0] == initiative and parts[1] == kind and local.is_slug(parts[2])
    return cid if ok else None


def _report(event: dict) -> str:
    """Spool one claude event when reporting is on and it passes the contract; say what happened either way."""
    on, why = local.enabled()
    if not on:
        return f"not spooled: {why}"
    problems = validate_event("claude", event)
    if problems:
        return "not spooled: " + "; ".join(problems)
    spool.append(event, "claude")
    return f"spooled {event['type']}"


def _session(value: str | None) -> str | None:
    """The --session value when it is a session id. An unsubstituted ${CLAUDE_SESSION_ID} is not one."""
    return value if local.is_uuid(value) else None


def cmd_attach(args) -> int:
    if not local.is_slug(args.initiative):
        print(f"not an initiative id (lower-case letters, digits and '-'): {local.clean(args.initiative, 40)}")
        return 1
    workstream = _child(args.initiative, "workstream", args.workstream) if args.workstream else None
    if args.workstream and workstream is None:
        print(f"not a workstream of {args.initiative}: {local.clean(args.workstream, 80)}")
        return 1
    cwd, session = args.cwd or os.getcwd(), _session(args.session)
    key = local.cwd_key(cwd)
    with local.bindings_for_update() as bindings:
        old = bindings.get(key, {})
        same = old.get("initiative") == args.initiative
        binding = {"initiative": args.initiative, "attached_at": local.now_iso(),
                   "session_id": old.get("session_id") if same else None, "lineage": old.get("lineage", []) if same else []}
        binding.update({k: v for k, v in (("workstream", workstream), ("branch", local.branch(cwd)),
                                          ("remote", local.remote(cwd))) if v})
        if session:
            local.rebind(binding, session)
            for other in [k for k, b in bindings.items() if k != key and b.get("session_id") == session]:
                del bindings[other]  # a session reports under one binding: the newest attach wins
        bindings[key] = binding
    print(f"attached {key} to {args.initiative}" + (f" ({workstream})" if workstream else ""))
    if not session:
        print("session id not given: this session's next hook firing in this directory fills it in")
        return 0
    body = {**local.common(binding, cwd), **local.attached_body(binding, key, "attach")}
    print(_report(local.event("session.attached", args.initiative, body)))
    return 0


def _bound(args) -> tuple[str | None, dict | None]:
    """(key, binding) for this directory, or for --session wherever it was attached."""
    bindings = local.load_bindings()
    cwd, session = args.cwd or os.getcwd(), _session(args.session)
    here = local.cwd_key(cwd)
    key = (local.find(bindings, cwd, session) if session else None) or (here if here in bindings else None)
    return (key, bindings[key]) if key else (None, None)


def cmd_detach(args) -> int:
    key, binding = _bound(args)
    if key is None:
        print("not attached here; nothing to detach")
        return 0
    with local.bindings_for_update() as bindings:
        bindings.pop(key, None)
    print(f"detached {key} from {binding['initiative']}")
    if local.is_uuid(binding.get("session_id")):
        body = {**local.common(binding, args.cwd or os.getcwd()), "reason": "detached"}
        print(_report(local.event("session.ended", binding["initiative"], body)))
    return 0


def cmd_task(args) -> int:
    key, binding = _bound(args)
    if key is None:
        print("not attached here: run /mission attach <initiative> first")
        return 1
    if not local.is_uuid(binding.get("session_id")):
        print("the attach is still waiting for this session's id (the next hook firing fills it in); try again")
        return 1
    task = _child(binding["initiative"], "task", args.task)
    if task is None:
        print(f"not a task of {binding['initiative']}: {local.clean(args.task, 80)}")
        return 1
    body = {**local.common(binding, args.cwd or os.getcwd()), "task": task}
    summary = local.clean(args.summary, 280) if args.summary else ""
    if args.action == "done" and summary:
        body["summary"] = summary
    print(_report(local.event(f"task.{'started' if args.action == 'start' else 'done'}", binding["initiative"], body)))
    return 0


def cmd_status(args) -> int:
    key, binding = _bound(args)
    if key is None:
        print("not attached here")
    else:
        print(f"attached: {key} -> {binding['initiative']}" + (f" ({binding['workstream']})" if binding.get("workstream") else ""))
        print(f"session: {binding.get('session_id') or 'waiting for the next hook firing'}"
              + (f" (lineage {len(binding['lineage'])})" if binding.get("lineage") else ""))
        print(f"branch: {binding.get('branch') or '-'}  remote: {binding.get('remote') or '-'}")
    on, why = local.enabled()
    print("reporting: on" if on else f"reporting: off ({why})")
    if local.drain_argv() is None:
        print("drain: no command in mission-config.json, so the hook never starts one")
    return cmd_spool(args)


def _skill_parsers(sub) -> None:
    """The /mission skill's actions. Each takes --cwd (default: here) and --session (the Claude Code session id)."""
    def add(name: str, help_text: str, fn):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--cwd", help="the session's directory (default: the current one)")
        p.add_argument("--session", help="the Claude Code session id")
        p.set_defaults(fn=fn)
        return p
    a = add("attach", "attach this directory's session to an initiative", cmd_attach)
    a.add_argument("initiative")
    a.add_argument("workstream", nargs="?")
    add("detach", "remove this directory's binding", cmd_detach)
    t = add("task", "report a task of the bound initiative started or done", cmd_task)
    t.add_argument("task")
    t.add_argument("action", choices=["start", "done"])
    t.add_argument("--summary", help="one line for task done")
    add("status", "the binding, whether reporting is on, and the spool", cmd_status)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="home-mission", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate", help="check a manifest against the schema")
    v.add_argument("manifest")
    v.set_defaults(fn=cmd_validate)
    i = sub.add_parser("import", help="turn a manifest into importer events and post them (or --dry-run)")
    i.add_argument("manifest")
    i.add_argument("--repo", required=True, help="owner/name of the repo holding the manifest")
    i.add_argument("--commit", required=True, help="the commit the manifest is at")
    i.add_argument("--path", help="the manifest's path in that repo (default docs/missions/<file name>)")
    i.add_argument("--print-lab", help="a print-lab checkout (default HOME_MCP_PRINTLAB_REPO or ~/dev/print-lab)")
    i.add_argument("--dry-run", action="store_true")
    i.set_defaults(fn=cmd_import)
    d = sub.add_parser("drain", help="post the spool to Pi Hub")
    d.set_defaults(fn=cmd_drain)
    s = sub.add_parser("spool", help="spool commands")
    s.add_argument("what", choices=["status"])
    s.set_defaults(fn=cmd_spool)
    _skill_parsers(sub)
    args = ap.parse_args(argv)
    try:
        return args.fn(args)
    except RuntimeError as e:  # the contract files are missing: say so plainly
        print(e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
