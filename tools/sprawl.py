#!/usr/bin/env python3
"""Measure code sprawl in a git repo: dead code, unused imports, duplication, oversized files.

Runs pinned versions of ruff, vulture, jscpd and (for repos with a package.json) knip
through uvx/npx, so nothing is installed into the repo. Writes report.json and report.md
to --out, and with --baseline compares the counts against a saved baseline.

Exit codes: 0 ok, 1 a count rose above the baseline, 2 usage or setup error.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from collections import Counter
from pathlib import Path
from typing import NoReturn

RUFF = "ruff@0.8.4"
VULTURE = "vulture==2.14"
JSCPD = "jscpd@4.0.5"
KNIP = "knip@5.33.3"

PY_EXT = {".py"}
JS_EXT = {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"}
WEB_EXT = {".css", ".html"}
SKIP_PARTS = {"node_modules", "dist", "build", "vendor", ".venv", "venv", "__pycache__", "_archive", "site-packages"}
SKIP_SUFFIXES = (".min.js", ".min.css", ".bundle.js")
BIG_FILE_LINES = 800
RUFF_RULES = "F401,F811,F841,C901"
MAX_COMPLEXITY = 15


def die(msg: str) -> NoReturn:
    print(f"sprawl: {msg}", file=sys.stderr)
    sys.exit(2)


def run(cmd: list[str], cwd: Path, timeout: int = 900) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        die(f"{cmd[0]} not found on PATH")
    except subprocess.TimeoutExpired:
        die(f"{' '.join(cmd[:3])} timed out after {timeout}s")


def tracked_files(repo: Path, ref: str | None) -> list[str]:
    cmd = ["git", "ls-tree", "-r", "--name-only", ref] if ref else ["git", "ls-files"]
    res = run(cmd, repo)
    if res.returncode != 0:
        die(f"git could not list files: {res.stderr.strip()}")
    keep = []
    for name in res.stdout.splitlines():
        p = Path(name)
        if SKIP_PARTS.intersection(p.parts) or name.endswith(SKIP_SUFFIXES):
            continue
        keep.append(name)
    return keep


def export_ref(repo: Path, ref: str, dest: Path) -> None:
    """Write a clean copy of `ref` to dest, leaving the repo's working tree alone."""
    archive = dest / "src.tar"
    res = run(["git", "archive", "--format=tar", "-o", str(archive), ref], repo)
    if res.returncode != 0:
        die(f"git archive {ref} failed: {res.stderr.strip()}")
    root = dest / "tree"
    root.mkdir()
    with tarfile.open(archive) as tar:
        tar.extractall(root, filter="data")
    archive.unlink()


def count_lines(root: Path, files: list[str]) -> tuple[dict, list[dict]]:
    by_lang: Counter = Counter()
    sizes = []
    for name in files:
        ext = Path(name).suffix
        lang = "python" if ext in PY_EXT else "js" if ext in JS_EXT else "web" if ext in WEB_EXT else None
        if not lang:
            continue
        try:
            n = sum(1 for _ in (root / name).open(encoding="utf-8", errors="replace"))
        except OSError:
            continue
        by_lang[lang] += n
        sizes.append({"file": name, "lines": n})
    sizes.sort(key=lambda s: s["lines"], reverse=True)
    return dict(by_lang), sizes


def run_ruff(root: Path, py: list[str]) -> list[dict]:
    if not py:
        return []
    res = run(["uvx", RUFF, "check", "--isolated", "--no-cache", "--select", RUFF_RULES,
               "--config", f"lint.mccabe.max-complexity = {MAX_COMPLEXITY}",
               "--output-format", "json", "--exit-zero", *py], root)
    try:
        items = json.loads(res.stdout or "[]")
    except json.JSONDecodeError:
        die(f"ruff output was not JSON: {res.stderr.strip()[:400]}")
    return [{"rule": i["code"], "file": str(Path(i["filename"]).relative_to(root)),
             "line": i["location"]["row"], "message": i["message"]} for i in items]


# Called by a framework, never by name in the code: Flask/Quart routes and hooks, pytest fixtures, http.server handlers.
VULTURE_DECORATORS = ",".join(["@*.route", "@*.get", "@*.post", "@*.put", "@*.patch", "@*.delete", "@*.before_request",
                               "@*.after_request", "@*.errorhandler", "@*.context_processor", "@*.template_filter",
                               "@*.teardown_*", "@*.cli.command", "@*.fixture", "@*.tool", "@*.resource",
                               "@*.api_route", "@*.middleware", "@*.on_event", "@*.exception_handler", "@*.websocket"])
VULTURE_NAMES = "row_factory,do_GET,do_POST,do_PUT,do_DELETE,do_HEAD,log_message,redirect_request,setUp,tearDown,setUpClass,tearDownClass"
VULTURE_RE = re.compile(r"^(?P<file>.+?):(?P<line>\d+): (?P<message>.+?) \((?P<conf>\d+)% confidence")


def run_vulture(root: Path, py: list[str]) -> list[dict]:
    if not py:
        return []
    res = run(["uvx", "--from", VULTURE, "vulture", "--min-confidence", "60",
               "--ignore-decorators", VULTURE_DECORATORS, "--ignore-names", VULTURE_NAMES, *py], root)
    if res.returncode not in (0, 1, 3):
        die(f"vulture failed: {res.stderr.strip()[:400]}")
    out = []
    for line in res.stdout.splitlines():
        m = VULTURE_RE.match(line)
        if m:
            out.append({"file": m["file"], "line": int(m["line"]), "message": m["message"], "confidence": int(m["conf"])})
    return out


def run_jscpd(root: Path, work: Path) -> dict:
    out_dir = work / "jscpd"
    ignore = ",".join([f"**/{p}/**" for p in sorted(SKIP_PARTS)] + [f"**/*{s}" for s in SKIP_SUFFIXES])
    res = run(["npx", "-y", JSCPD, ".", "--silent", "--gitignore", "--reporters", "json", "--output", str(out_dir),
               "--min-lines", "10", "--min-tokens", "70", "--format", "javascript,typescript,python,css,markup",
               "--ignore", ignore], root)
    report = out_dir / "jscpd-report.json"
    if not report.exists():
        return {"error": (res.stderr or res.stdout).strip()[:400] or "no report written", "clones": [], "percentage": None}
    data = json.loads(report.read_text())
    clones = []
    for d in data.get("duplicates", []):
        a, b = d["firstFile"], d["secondFile"]
        clones.append({"lines": d.get("lines", 0), "format": d.get("format"),
                       "a": f"{a['name']}:{a['start']}-{a['end']}", "b": f"{b['name']}:{b['start']}-{b['end']}"})
    clones.sort(key=lambda c: c["lines"], reverse=True)
    total = data.get("statistics", {}).get("total", {})
    return {"clones": clones, "percentage": total.get("percentage"), "duplicated_lines": total.get("duplicatedLines")}


def run_knip(root: Path) -> dict:
    if not (root / "package.json").exists():
        return {"skipped": "no package.json at the repo root"}
    res = run(["npx", "-y", KNIP, "--reporter", "json", "--no-exit-code", "--no-progress"], root)
    try:
        data = json.loads(res.stdout)
    except json.JSONDecodeError:
        return {"error": (res.stderr or res.stdout).strip()[:400]}
    unused = {"files": list(data.get("files", []))}
    for issue in data.get("issues", []):
        for kind in ("dependencies", "devDependencies", "exports", "types"):
            for item in issue.get(kind, []) or []:
                unused.setdefault(kind, []).append(f"{issue['file']}:{item.get('line', '')} {item.get('name', '')}".strip())
    return unused


def is_test(name: str) -> bool:
    p = Path(name)
    return bool({"tests", "test"}.intersection(p.parts)) or p.name.startswith("test_") or p.name == "conftest.py"


def summarise(r: dict) -> dict:
    ruff = Counter(i["rule"] for i in r["ruff"])
    knip = r["knip"]
    # Test files are counted apart: pytest fixtures look like unused or redefined names to ruff and vulture.
    prod_ruff = Counter(i["rule"] for i in r["ruff"] if not is_test(i["file"]))
    prod_dead = [v for v in r["vulture"] if not is_test(v["file"])]
    return {
        "py_unused_imports": prod_ruff.get("F401", 0),
        "py_redefined": prod_ruff.get("F811", 0),
        "py_unused_variables": prod_ruff.get("F841", 0),
        "py_complex_functions": prod_ruff.get("C901", 0),
        "py_dead_code_high": sum(1 for v in prod_dead if v["confidence"] >= 90),
        "py_dead_code_maybe": sum(1 for v in prod_dead if v["confidence"] < 90),
        "test_lint_findings": sum(ruff.values()) - sum(prod_ruff.values()) + len(r["vulture"]) - len(prod_dead),
        "dup_blocks": len(r["jscpd"].get("clones", [])),
        "dup_lines": r["jscpd"].get("duplicated_lines") or 0,
        "big_files": sum(1 for s in r["sizes"] if s["lines"] >= BIG_FILE_LINES),
        "js_unused_files": len(knip.get("files", [])) if isinstance(knip, dict) else 0,
        "js_unused_exports": len(knip.get("exports", [])) if isinstance(knip, dict) else 0,
        "js_unused_deps": len(knip.get("dependencies", [])) + len(knip.get("devDependencies", [])) if isinstance(knip, dict) else 0,
    }


def write_md(r: dict, path: Path, delta: dict | None) -> None:
    s = r["summary"]
    L = [f"# Sprawl report: {r['repo']}", "", f"Source: `{r['source']}`. Lines: " +
         ", ".join(f"{k} {v:,}" for k, v in r["lines"].items()) +
         (f". Duplication: {r['jscpd']['percentage']}%." if r["jscpd"].get("percentage") is not None else "."), "",
         "| Measure | Count |" + (" Baseline |" if delta else ""), "|---|---|" + ("---|" if delta else "")]
    for k, v in s.items():
        L.append(f"| {k} | {v} |" + (f" {delta[k]['baseline']} ({delta[k]['change']:+d}) |" if delta and k in delta else (" — |" if delta else "")))
    L += ["", f"## Largest files (≥ {BIG_FILE_LINES} lines)", ""]
    L += [f"- `{x['file']}`: {x['lines']:,}" for x in r["sizes"] if x["lines"] >= BIG_FILE_LINES] or ["None."]
    L += ["", "## Largest duplicate blocks", ""]
    L += [f"- {c['lines']} lines ({c['format']}): `{c['a']}` ≈ `{c['b']}`" for c in r["jscpd"].get("clones", [])[:25]] or ["None."]
    if r["jscpd"].get("error"):
        L.append(f"\njscpd error: {r['jscpd']['error']}")
    L += ["", "## Dead Python code (vulture, ≥ 90% confidence)", ""]
    L += [f"- `{v['file']}:{v['line']}` {v['message']}" for v in r["vulture"] if v["confidence"] >= 90 and not is_test(v["file"])][:60] or ["None."]
    L += ["", "## Dead Python code (vulture, 60–89%: check before removing)", ""]
    L += [f"- `{v['file']}:{v['line']}` {v['message']} ({v['confidence']}%)" for v in r["vulture"] if v["confidence"] < 90 and not is_test(v["file"])][:80] or ["None."]
    L += ["", "## Ruff (production code)", ""]
    L += [f"- `{i['file']}:{i['line']}` {i['rule']} {i['message']}" for i in r["ruff"] if not is_test(i["file"])][:120] or ["None."]
    L += ["", f"Test files: {s['test_lint_findings']} more ruff/vulture findings, mostly pytest fixtures read as unused names. They are in report.json."]
    L += ["", "## JS (knip)", ""]
    knip = r["knip"]
    if "skipped" in knip or "error" in knip:
        L.append(f"Not run: {knip.get('skipped') or knip.get('error')}")
    else:
        for kind, items in knip.items():
            L += [f"- {kind}: `{i}`" for i in items[:40]]
    path.write_text("\n".join(L) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(description="Measure code sprawl in a git repo.")
    ap.add_argument("repo", type=Path)
    ap.add_argument("--ref", help="audit this commit or branch (e.g. origin/main) instead of the working tree")
    ap.add_argument("--out", type=Path, required=True, help="directory for report.json and report.md")
    ap.add_argument("--baseline", type=Path, help="baseline JSON to compare against")
    ap.add_argument("--write-baseline", type=Path, help="write the current counts to this file")
    a = ap.parse_args()

    repo = a.repo.expanduser().resolve()
    if not (repo / ".git").exists():
        die(f"{repo} is not a git repository")
    for tool in ("uvx", "npx", "git"):
        if not shutil.which(tool):
            die(f"{tool} not found on PATH")
    a.out.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="sprawl-") as tmp:
        work = Path(tmp).resolve()
        if a.ref:
            export_ref(repo, a.ref, work)
            root = work / "tree"
        else:
            root = repo
        files = tracked_files(repo, a.ref)
        py = [f for f in files if Path(f).suffix in PY_EXT]
        lines, sizes = count_lines(root, files)
        r = {"repo": repo.name, "source": a.ref or "working tree", "lines": lines, "sizes": sizes[:40],
             "ruff": run_ruff(root, py), "vulture": run_vulture(root, py),
             "jscpd": run_jscpd(root, work), "knip": run_knip(root)}
    r["summary"] = summarise(r)

    delta, worse = None, []
    if a.baseline:
        try:
            base = json.loads(a.baseline.read_text())["summary"]
        except (OSError, KeyError, json.JSONDecodeError) as e:
            die(f"cannot read baseline {a.baseline}: {e}")
        delta = {k: {"baseline": base[k], "change": v - base[k]} for k, v in r["summary"].items() if k in base}
        worse = [k for k, d in delta.items() if d["change"] > 0]
        r["delta"] = delta

    (a.out / "report.json").write_text(json.dumps(r, indent=1))
    write_md(r, a.out / "report.md", delta)
    if a.write_baseline:
        a.write_baseline.write_text(json.dumps({"source": r["source"], "summary": r["summary"]}, indent=1) + "\n")

    print(json.dumps(r["summary"]))
    print(f"report: {a.out / 'report.md'}")
    if worse and delta:
        print("rose above baseline: " + ", ".join(f"{k} {delta[k]['change']:+d}" for k in worse))
        sys.exit(1)


if __name__ == "__main__":
    main()
