"""Run the real deploy-repo guard (deploy/pi-hub-pre-receive) on a temporary bare repo: only a merged pull request's
commit can become main, unless the owner pushes with -o allow-direct."""
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]


@pytest.fixture
def repos(tmp_path):
    bare, work = tmp_path / "deploy.git", tmp_path / "work"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    shutil.copy(ROOT / "deploy/pi-hub-pre-receive", bare / "hooks/pre-receive")
    (bare / "hooks/pre-receive").chmod(0o755)
    subprocess.run(["git", "-C", str(bare), "config", "receive.advertisePushOptions", "true"], check=True)
    subprocess.run(["git", "init", "-q", "-b", "main", str(work)], check=True)

    def commit(subject):
        subprocess.run([*GIT, "-C", str(work), "commit", "-q", "--allow-empty", "-m", subject], check=True)

    def push(*options, ref="main"):
        args = [arg for o in options for arg in ("-o", o)]
        return subprocess.run([*GIT, "-C", str(work), "push", *args, str(bare), ref],
                              capture_output=True, text=True)

    return commit, push, bare


def test_a_squash_merged_pr_goes_through(repos):
    commit, push, _ = repos
    commit("feat(lab): /lab?p= opens a given project (platform step 6, PR 6.1) (#73)")
    assert push().returncode == 0


def test_a_merge_commit_from_a_pr_goes_through(repos):
    commit, push, _ = repos
    commit("Merge pull request #70 from azmusgb/feat/lock-camera-8091")
    assert push().returncode == 0


def test_a_commit_made_straight_on_main_is_refused(repos):
    commit, push, bare = repos
    commit("feat(caddy): reverse proxy /ai/ directly to Local AI under Pi Hub origin")
    result = push()
    assert result.returncode != 0
    assert "must be a merged pull request" in result.stderr
    assert subprocess.run(["git", "-C", str(bare), "rev-parse", "-q", "--verify", "main"],
                          capture_output=True).returncode != 0


def test_a_pr_number_inside_the_subject_is_not_enough(repos):
    commit, push, _ = repos
    commit("fix: follow-up to (#76) made on main")
    assert push().returncode != 0
    commit("fix: the Merge pull request #76 follow-up")
    assert push().returncode != 0


def test_the_owner_can_push_directly_on_purpose(repos):
    commit, push, _ = repos
    commit("docs: a hand fix")
    result = push("allow-direct")
    assert result.returncode == 0
    assert "without a pull request (allow-direct)" in result.stderr


def test_another_push_option_is_not_an_exception(repos):
    commit, push, _ = repos
    commit("docs: a hand fix")
    assert push("something-else").returncode != 0


def test_other_branches_are_not_checked(repos):
    commit, push, _ = repos
    commit("wip")
    assert push(ref="main:refs/heads/scratch").returncode == 0
