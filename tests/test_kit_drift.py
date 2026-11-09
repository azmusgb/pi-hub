"""deploy/kit-drift.sh prints the kit copy's drift line, or "unavailable", and fails only when KIT_DRIFT_ENFORCE=1."""
import os
import stat
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "deploy", "kit-drift.sh")
LINE = "pi-hub\tbehind\t2.9.0 is behind 2.10.0 (stub)"


def run(env=None, drift_exit=None, stub_git=True):
    """Runs the script. With drift_exit set, a fake git "clones" a kit whose drift.mjs prints LINE and exits so."""
    tmp = tempfile.mkdtemp()
    bin_dir = os.path.join(tmp, "bin")
    os.mkdir(bin_dir)
    full = dict(os.environ, KIT_DRIFT_ENFORCE="")
    if stub_git:
        fake = os.path.join(bin_dir, "git")
        with open(fake, "w") as f:
            f.write('#!/bin/bash\nmkdir -p "${@: -1}/scripts"\n'
                    + ("" if drift_exit is None else
                       'printf "console.log(%s);process.exit(%d)\\n" "\'$KIT_STUB_LINE\'" "$KIT_STUB_EXIT" > "${@: -1}/scripts/drift.mjs"\n'))
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IEXEC)
        full.update(PATH=bin_dir + os.pathsep + full["PATH"], KIT_STUB_LINE=LINE.replace("\t", "\\t"),
                    KIT_STUB_EXIT=str(drift_exit or 0))
    full.update(env or {})
    return subprocess.run(["bash", SCRIPT], capture_output=True, text=True, env=full)


def test_unreachable_kit_is_unavailable_and_passes():
    r = run(env={"KIT_DRIFT_URL": "/nonexistent/appliance-ui"}, stub_git=False)
    assert r.returncode == 0, r.stdout + r.stderr
    assert r.stdout.startswith("kit drift check unavailable: could not clone"), r.stdout


def test_a_kit_without_drift_is_unavailable_and_passes():
    r = run(env={"KIT_DRIFT_ENFORCE": "1"})
    assert r.returncode == 0, r.stdout + r.stderr
    assert "kit drift check unavailable: scripts/drift.mjs is not on the kit's main yet" in r.stdout


def test_a_clean_line_is_printed_and_passes():
    r = run(drift_exit=0)
    assert r.returncode == 0 and LINE in r.stdout, r.stdout + r.stderr


def test_drift_failure_only_warns_by_default():
    r = run(drift_exit=1)
    assert r.returncode == 0 and LINE in r.stdout, r.stdout + r.stderr


def test_enforce_turns_drift_failure_into_a_failure():
    r = run(env={"KIT_DRIFT_ENFORCE": "1"}, drift_exit=1)
    assert r.returncode == 1 and LINE in r.stdout, r.stdout + r.stderr
