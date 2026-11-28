"""Deploy preflight for the Pi Hub and Local AI, read from each target's own authoritative records. Read-only:
git rev-parse, status, merge-base and ls-remote locally; fixed read commands over SSH; never fetch or push."""
import asyncio
import json
import re
from collections.abc import Awaitable, Callable
from typing import Any

from . import shell
from .hub import iso, now_iso

Runner = Callable[..., Awaitable[shell.Run]]

REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$")
SHA = re.compile(r"^[0-9a-f]{7,40}$")
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
# What a Pi release attempt can end as (deploy/pi-hub-release's record()): only "live" means it is running and healthy.
PI_OK = "live"
# Get-LocalAI-DeployStatus.ps1 fields without which readiness cannot be judged.
PC_REQUIRED = ("currentCommit", "health", "deploymentStatus")
PI_LIVE = "readlink -f /opt/pi-hub/current; cat /var/lib/pi-hub-releases/releases.json"
PC_STATUS = r"powershell -NoProfile -ExecutionPolicy Bypass -File C:\LocalAI\repo\deploy\Get-LocalAI-DeployStatus.ps1 -AsJson"
PC_DIRTY = r"git -C C:\LocalAI\repo status --porcelain"


def _failed(what: str, r: shell.Run) -> dict:
    detail = r.err or r.out.strip()[:200] or f"exit {r.code}"
    return {"source": what, "error": "unreachable" if r.code is None or r.code == 255 else "command",
            "detail": detail[:300]}


def _remote_head(r: shell.Run) -> str | None:
    line = r.out.strip().splitlines()[0] if r.code == 0 and r.out.strip() else ""
    sha = line.split()[0] if line else ""
    return sha if re.fullmatch(r"[0-9a-f]{40}", sha) else None


def _ps_date(v):
    """PowerShell's JSON dates ("/Date(ms)/") as ISO; other values unchanged."""
    m = re.fullmatch(r"/Date\((\d+)\)/", v) if isinstance(v, str) else None
    return iso(int(m.group(1)) / 1000) if m else v


def _same(a: str | None, b: str | None) -> bool:
    """Whether two SHAs name the same commit when one is abbreviated."""
    if not a or not b:
        return False
    return a.startswith(b) or b.startswith(a)


async def _contains(run: Runner, repo: str, ancestor: str, descendant: str) -> bool | None:
    """Whether descendant contains ancestor; None when either commit isn't in the local checkout."""
    r = await run(["git", "-C", repo, "merge-base", "--is-ancestor", ancestor, descendant])
    return {0: True, 1: False}.get(r.code)


async def _resolve(run: Runner, repo: str, ref: str) -> str | None:
    r = await run(["git", "-C", repo, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"])
    return r.out.strip() if r.code == 0 and r.out.strip() else None


def _checkout(status: shell.Run) -> dict:
    """`git status --porcelain -z` as facts: tracked changes and untracked paths. Unknown when it couldn't be read or
    an entry doesn't parse: an unreadable status must never look clean. -z gives paths unquoted, and a rename or copy
    entry is followed by its source path."""
    unknown = {"state": "unknown", "tracked_changes": None, "untracked": None}
    if status.code != 0:
        return unknown
    tracked, untracked = [], []
    entries = status.out.split("\0")
    i = 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if not entry:
            continue
        if len(entry) < 4 or entry[2] != " " or not set(entry[:2]) <= set(" MTADRCU?!"):
            return unknown
        (untracked if entry[:2] == "??" else tracked).append(entry[3:])
        if entry[0] in "RC":
            i += 1  # the source path of the rename or copy
    return {"state": "dirty" if tracked or untracked else "clean", "tracked_changes": tracked, "untracked": untracked}


def _listed(paths: list[str], most: int = 5) -> str:
    more = len(paths) - most
    return ", ".join(paths[:most]) + (f" and {more} more" if more > 0 else "")


def _bad(source: str, error: str, detail: str) -> dict:
    return {"source": source, "error": error, "detail": detail}


def _unreadable(errors: list, blockers: list) -> None:
    if errors:
        blockers.append("some sources couldn't be read; see errors")


def _checkout_findings(checkout: dict, dirty_r: shell.Run, errors: list, warnings: list) -> list[str]:
    """What the local checkout means for the release paths: errors and warnings are added to; returns what blocks
    install.sh."""
    install_blockers = []
    if checkout["state"] == "unknown":
        errors.append(_failed("local checkout status", dirty_r))
        install_blockers.append("the local checkout's status couldn't be read")
    elif checkout["state"] == "dirty":
        listed = _listed(checkout["tracked_changes"] + checkout["untracked"])
        install_blockers.append(f"install.sh refuses a checkout with changes or untracked files: {listed}")
        if checkout["tracked_changes"]:
            warnings.append(f"uncommitted changes to tracked files won't ship with a push: {_listed(checkout['tracked_changes'])}")
        if checkout["untracked"]:
            warnings.append(f"untracked files in the local checkout (not shipped by a push): {_listed(checkout['untracked'])}")
    return install_blockers


def _release_history(rest: str, errors: list) -> list[dict]:
    """The Pi's release attempts, oldest first. Unreadable history is not "no attempts": readiness can't be judged
    without it, so it is an error."""
    try:
        history = json.loads(rest)
    except ValueError:
        history = None
    if not isinstance(history, list):
        errors.append(_bad("the Pi's release history (releases.json)", "bad_history", rest.strip()[:200] or "empty"))
        history = []
    entries = [e for e in history if isinstance(e, dict)]
    return sorted(entries, key=lambda e: e.get("ts") if isinstance(e.get("ts"), (int, float)) else 0)


def _read_live(live_r: shell.Run, errors: list, blockers: list) -> dict[str, Any]:
    """The running release and how its record reads; blockers and errors are added to."""
    live: dict[str, Any] = {"sha": None, "status": None, "message": None, "at": None}
    if live_r.code != 0:
        errors.append(_failed("the Pi's running release (ssh)", live_r))
        return live
    path, _, rest = live_r.out.partition("\n")
    live["sha"] = path.strip().rsplit("/", 1)[-1] or None
    by_time = _release_history(rest, errors)
    newest = by_time[-1] if by_time else None
    mine = next((e for e in reversed(by_time) if _same(e.get("sha"), live["sha"])), None)
    if mine:
        live.update(status=mine.get("status"), message=mine.get("message"), at=iso(mine.get("ts")))
    bad_history = any(e.get("error") == "bad_history" for e in errors)
    if not mine and not bad_history:
        blockers.append(f"there is no release record for the running release ({live['sha']})")
    elif mine and mine.get("status") != PI_OK:
        blockers.append(f"the running release ({live['sha']}) is recorded as {mine.get('status')}: {mine.get('message')}")
    # The newest attempt is judged by its outcome as well as its commit: a failed re-release of the running
    # commit is still a failed release.
    if newest and newest is not mine:
        blockers.append(f"the newest release attempt ({newest.get('sha')}, {newest.get('status')}) is not the "
                        f"running release: {newest.get('message')}")
    return live


async def _against_intended(run: Runner, repo: str, ref: str, sha: str, targets: tuple, blockers: list) -> None:
    """Blocks when the Pi's main or the running release has commits the intended one lacks, or isn't local."""
    for name, target in targets:
        if not target:
            continue
        contained = await _contains(run, repo, target, sha)
        if contained is False:
            blockers.append(f"{name} ({target[:10]}) has commits {ref} doesn't contain: another session may have "
                            "released; stop and ask before overwriting it")
        elif contained is None:
            blockers.append(f"{name} ({target[:10]}) is not in the local checkout; fetch to compare before releasing")


async def pi_hub(run: Runner, intended: str | None) -> dict:
    repo, host = shell.pihub_repo(), shell.pi_host()
    ref = intended or "main"
    errors, blockers, warnings = [], [], []
    sha_r, local_main_r, dirty_r, gh_r, pi_r, live_r = await asyncio.gather(
        _resolve(run, repo, ref), _resolve(run, repo, "main"),
        run(["git", "-C", repo, "status", "--porcelain", "-z"]),
        run(["git", "-C", repo, "ls-remote", "origin", "refs/heads/main"]),
        run(["git", "-C", repo, "ls-remote", "pi", "refs/heads/main"]),
        run(shell.ssh(host, PI_LIVE)),
    )
    if sha_r is None:
        blockers.append(f"{ref} is not a commit in {repo}")
    # The checkout is a fact; what it means depends on the release path. `git push pi <sha>:main` ships only the commit,
    # so the working tree can't change what goes live. install.sh refuses any status output (deploy/install.sh:11) and
    # copies a few deploy files from the working tree, so for it the checkout must be clean.
    checkout = _checkout(dirty_r)
    install_blockers = _checkout_findings(checkout, dirty_r, errors, warnings)
    github_main = _remote_head(gh_r)
    if github_main is None:
        errors.append(_failed("GitHub main (git ls-remote origin)", gh_r))
    pi_main = _remote_head(pi_r)
    if pi_main is None:
        errors.append(_failed("the Pi's repository (git ls-remote pi)", pi_r))

    live = _read_live(live_r, errors, blockers)
    live_full = await _resolve(run, repo, live["sha"]) if live["sha"] else None
    if live["sha"] and pi_main and not _same(pi_main, live["sha"]):
        blockers.append(f"the Pi's main ({pi_main[:10]}) is not the running release ({live['sha']}): a release "
                        "failed or is in progress")
    if sha_r:
        await _against_intended(run, repo, ref, sha_r, (("the Pi's main", pi_main),
                                                        ("the running release", live_full or live["sha"])), blockers)
        if github_main and sha_r != github_main and await _contains(run, repo, sha_r, github_main) is not True:
            warnings.append(f"{ref} ({sha_r[:10]}) is not on GitHub main ({github_main[:10]})")
        if local_main_r and sha_r != local_main_r:
            install_blockers.append(f"install.sh ships local main ({local_main_r[:10]}), not {ref}; the checks above are for {ref}")
        if _same(sha_r, live["sha"]):
            warnings.append("the intended commit is already live; a release would be a no-op")
    _unreadable(errors, blockers)
    return _shape("pi-hub", ref, sha_r, errors, blockers, warnings,
                  github_main=github_main, deploy_remote_main=pi_main, live=live, checkout=checkout,
                  local_checkout_clean=None if checkout["state"] == "unknown" else checkout["state"] == "clean",
                  install_sh={"ready": not blockers and not install_blockers, "blockers": install_blockers,
                              "warnings": []})


def _github_heads(gh_r: shell.Run, errors: list) -> dict[str, str]:
    """The release and main heads from `git ls-remote origin`; errors says what is missing or unreadable."""
    source = "GitHub release and main (git ls-remote origin)"
    if gh_r.code != 0:
        errors.append(_failed(source, gh_r))
        return {}
    heads = {}
    for line in gh_r.out.splitlines():
        parts = line.split()
        if len(parts) == 2 and FULL_SHA.fullmatch(parts[0]):
            heads[parts[1].rsplit("/", 1)[-1]] = parts[0]
    missing = [b for b in ("release", "main") if b not in heads]
    if missing:
        errors.append(_bad(source, "missing", f"no {' or '.join(missing)} branch in the answer"))
    return heads


def _status_problems(st: Any) -> list[str]:
    if not isinstance(st, dict):
        return [f"expected an object, got {type(st).__name__}"]
    problems = [f"no {k}" for k in PC_REQUIRED if not st.get(k)]
    if st.get("currentCommit") and not FULL_SHA.fullmatch(str(st["currentCommit"])):
        problems.append(f"currentCommit {str(st['currentCommit'])[:20]!r} is not a commit")
    return problems


def _pc_status(status_r: shell.Run, errors: list) -> dict:
    """Get-LocalAI-DeployStatus.ps1's answer, or {} with an error when it can't be trusted as evidence."""
    source = "Get-LocalAI-DeployStatus.ps1"
    if status_r.code != 0:
        errors.append(_failed(f"{source} on the PC (ssh)", status_r))
        return {}
    try:
        st = json.loads(status_r.out)
    except ValueError:
        errors.append(_bad(source, "bad_json", status_r.out[:200]))
        return {}
    problems = _status_problems(st)
    if problems:
        errors.append(_bad(source, "bad_status", "; ".join(problems)))
        return {}
    return st


def _pc_clean(dirty_r: shell.Run, errors: list, blockers: list) -> bool | None:
    if dirty_r.code != 0:
        errors.append(_failed("PC checkout status (ssh)", dirty_r))
        return None
    clean = not dirty_r.out.strip()
    if not clean:
        blockers.append(r"C:\LocalAI\repo has local changes: LocalAI Safe Deploy skips until they are removed")
    return clean


def _status_findings(st: dict, task: dict, blockers: list, warnings: list) -> None:
    """What the target's own status says about its health and its Safe Deploy task."""
    if st.get("health") != "HEALTHY":
        blockers.append(f"Local AI health is {st.get('health')}: {st.get('healthDetail')}")
    if st.get("deploymentStatus") != "HEALTHY":
        blockers.append(f"the deploy state is {st.get('deploymentStatus')}")
    if st.get("deploymentIdentityMismatch"):
        blockers.append("the running commit differs from the recorded deploy state")
    if task["last_result"] not in (0, None):
        warnings.append(f"LocalAI Safe Deploy's last run returned {task['last_result']}")
    if not st.get("taskInstalled", True):
        blockers.append("the LocalAI Safe Deploy task is not installed")


def _release_findings(live_sha: str | None, github_release: str | None, github_main: str | None,
                      next_run: Any, blockers: list, warnings: list) -> None:
    if live_sha and github_release and live_sha != github_release:
        blockers.append(f"release ({github_release[:12]}) is not deployed yet (running {live_sha[:12]}); Safe Deploy's "
                        f"next run is {next_run}. Another ship may be in flight: stop and ask")
    if github_main and github_release and github_main != github_release:
        warnings.append(f"main ({github_main[:12]}) has merged work not shipped to release ({github_release[:12]})")


def _intended_findings(intended: str, live_sha: str | None, github_release: str | None,
                       blockers: list, warnings: list) -> None:
    if _same(intended, live_sha):
        warnings.append("the intended commit is already live")
    elif _same(intended, github_release):
        warnings.append("the intended commit is on release, waiting for Safe Deploy")
    else:
        # Readiness is about this candidate: one that is neither running nor on release isn't what would deploy.
        blockers.append(f"the intended commit {intended[:12]} is neither the running release nor release "
                        f"({(github_release or '?')[:12]}); ship it to release first")


async def localai(run: Runner, intended: str | None) -> dict:
    repo, host = shell.localai_repo(), shell.pc_host()
    errors, blockers, warnings = [], [], []
    status_r, dirty_r, gh_r = await asyncio.gather(
        run(shell.ssh(host, PC_STATUS), timeout=60),
        run(shell.ssh(host, PC_DIRTY)),
        run(["git", "-C", repo, "ls-remote", "origin", "refs/heads/release", "refs/heads/main"]),
    )
    heads = _github_heads(gh_r, errors)
    github_release, github_main = heads.get("release"), heads.get("main")

    st = _pc_status(status_r, errors)
    live_sha = st.get("currentCommit")
    live = {"sha": live_sha, "health": st.get("health"), "status": st.get("deploymentStatus"),
            "deployed_at": st.get("deployedAt"), "previous": st.get("previousCommit"),
            "identity_mismatch": st.get("deploymentIdentityMismatch")}
    task = {"state": st.get("taskState"), "last_run": _ps_date(st.get("taskLastRunTime")),
            "last_result": st.get("taskLastResult"), "next_run": _ps_date(st.get("taskNextRunTime"))}

    pc_clean = _pc_clean(dirty_r, errors, blockers)
    if st:
        _status_findings(st, task, blockers, warnings)
    _release_findings(live_sha, github_release, github_main, task["next_run"], blockers, warnings)
    if intended:
        _intended_findings(intended, live_sha, github_release, blockers, warnings)
    _unreadable(errors, blockers)
    return _shape("localai", intended, None, errors, blockers, warnings,
                  github_release=github_release, github_main=github_main, live=live,
                  pc_checkout={"head": st.get("repoHead"), "release_as_fetched": st.get("originRelease"),
                               "clean": pc_clean},
                  safe_deploy_task=task, target_checked_at=st.get("checkedAt"))


def _shape(target, ref, sha, errors, blockers, warnings, **fields) -> dict:
    out = {"ok": not errors, "target": target, "source": f"deploy_state {target}", "as_of": now_iso(),
           "intended": {"ref": ref, "sha": sha}, **fields,
           "ready": not blockers, "blockers": blockers, "warnings": warnings}
    if errors:
        out["errors"] = errors
    return out


async def deploy_state(run: Runner, target: str, intended: str | None = None) -> dict:
    if target not in ("pi-hub", "localai"):
        raise ValueError("target must be pi-hub or localai")
    if intended is not None:
        if not REF.fullmatch(intended) or ".." in intended:
            raise ValueError("intended must be a branch, tag or commit SHA")
        if target == "localai" and not SHA.fullmatch(intended):
            raise ValueError("for localai, intended must be a commit SHA (7-40 hex characters)")
    return await (pi_hub(run, intended) if target == "pi-hub" else localai(run, intended))
