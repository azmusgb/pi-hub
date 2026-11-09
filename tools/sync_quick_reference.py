#!/usr/bin/env python3
"""Keep hub/quick_start_reference.json equal to print-lab's presets/quick/x2d-start-reference.json (A19 P9).

The Pi re-checks every sliced file against this reference before Prepare and Start, so the hub's copy must be the one
print-lab's worker checks against. print-lab owns the file; this copies it. Run from the Mac:

    python3 tools/sync_quick_reference.py --check          # exit 1 and say so if the copies differ
    python3 tools/sync_quick_reference.py --write          # replace the hub's copy with print-lab's

`--source` names print-lab's file (default: ~/dev/print-lab/presets/quick/x2d-start-reference.json, which must be a
checkout of its main). Standard library only."""
import argparse
import json
import sys
from pathlib import Path

HUB_COPY = Path(__file__).resolve().parents[1] / "hub" / "quick_start_reference.json"
DEFAULT_SOURCE = Path.home() / "dev" / "print-lab" / "presets" / "quick" / "x2d-start-reference.json"
KEYS = ("commands", "machine_start_sha256", "block_lines")


def load(path: Path) -> dict:
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or any(k not in data for k in KEYS) or not isinstance(data["commands"], list):
        raise ValueError(f"{path} isn't a start-block reference (needs {', '.join(KEYS)}).")
    return data


def main(argv=None, hub_copy: Path = HUB_COPY) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    args = ap.parse_args(argv)
    try:
        source, mine = load(args.source), load(hub_copy)
    except (OSError, ValueError) as e:
        print(f"sync_quick_reference: {e}", file=sys.stderr)
        return 2
    same = source == mine
    if args.check:
        print("in sync" if same else "DIFFERENT: the hub's reference isn't print-lab's. Run with --write and ship it.")
        return 0 if same else 1
    if not same:
        hub_copy.write_text(args.source.read_text())
    print("already in sync" if same else f"wrote {hub_copy}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
