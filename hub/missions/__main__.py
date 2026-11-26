"""`python -m hub.missions rebuild <initiative> [--check]` (A35 §6.2): replays an initiative's log through the same
projection the live path uses. With --check it writes nothing and exits 1 when the live tables differ from the log;
without, it replaces the initiative's projections in one transaction. Exit 2: usage, or no event for the initiative.
The database is HUB_DB's, as the hub's own."""
import argparse
import sys

from .. import db
from . import store
from .contract import CURRENT


def rebuild(initiative, check):
    store.ready()
    with db.transaction() as c:  # one snapshot for the replay and the compare; --check writes nothing in it
        replayed = store.replay(c, initiative)
        found = None if replayed is None else store.differences(replayed, store.load_rows(c, initiative))
        if replayed is not None and not check:
            store.replace(c, initiative, replayed)
    if found is None:
        print(f"No events for {initiative}.", file=sys.stderr)
        return 2
    for line in found:
        print(line)
    rows = sum(len(t) for t in replayed.values())
    if check:
        print(f"{initiative}: {rows} rows from the log, {len(found)} differ from the live tables.")
        return 1 if found else 0
    print(f"{initiative}: rebuilt {rows} rows from the log; {len(found)} differed before.")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m hub.missions", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("rebuild", help="rebuild one initiative's projections from the log")
    r.add_argument("initiative")
    r.add_argument("--check", action="store_true", help="compare only; exit 1 on a difference")
    args = ap.parse_args(argv)
    if not CURRENT.valid_slug(args.initiative):
        print("The initiative is a slug such as a34.", file=sys.stderr)
        return 2
    return rebuild(args.initiative, args.check)


if __name__ == "__main__":
    sys.exit(main())
