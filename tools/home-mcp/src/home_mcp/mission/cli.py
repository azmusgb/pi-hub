"""`home-mission`: validate a manifest, import it, drain the spool, show the spool. This CLI writes (to the spool and
to Pi Hub's mission routes), unlike the read-only MCP tools. Exit codes: 0 ok, 1 a problem or refusal, 2 Pi Hub has
no mission routes yet."""
import argparse
import asyncio
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .. import hub, shell
from . import drain, importer, spool
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
    args = ap.parse_args(argv)
    try:
        return args.fn(args)
    except RuntimeError as e:  # the contract files are missing: say so plainly
        print(e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
