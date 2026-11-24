"""describe() moved out of ~/.claude/hooks/localai-progress.py; it must behave exactly as that function did."""
import importlib.util
from pathlib import Path

import pytest

from home_mcp.mission.labels import describe, short_path

CASES = [
    ("Bash", {"description": "Run the tests", "command": "rm -rf /"}, ("Run the tests", "")),
    ("Bash", {"command": "ls"}, ("Ran a command", "")),
    ("PowerShell", {}, ("Ran a command", "")),
    ("Read", {"file_path": "/Users/a/dev/pi-hub/hub/app.py"}, ("Read hub/app.py", "")),
    ("Edit", {"file_path": "C:\\code\\x\\y.js"}, ("Edited x/y.js", "")),
    ("Write", {"file_path": "single.txt"}, ("Wrote single.txt", "")),
    ("Write", {}, ("Wrote ", "")),
    ("NotebookEdit", {"notebook_path": "/a/b/c.ipynb"}, ("Edited notebook b/c.ipynb", "")),
    ("Grep", {"path": "/a/b/c", "pattern": "secret"}, ("Searched files", "b/c")),
    ("Glob", {}, ("Searched files", "")),
    ("WebFetch", {"url": "https://example.com/a/b?q=1"}, ("Fetched example.com", "")),
    ("WebFetch", {"url": "nonsense"}, ("Fetched a page", "")),
    ("WebSearch", {"query": "private"}, ("Web search", "")),
    ("Agent", {"description": "Review the diff", "prompt": "long"}, ("Agent: Review the diff", "")),
    ("Task", {}, ("Agent: subtask", "")),
    ("Skill", {"skill": "fix"}, ("Skill: fix", "")),
    ("Skill", {}, ("Skill: ", "")),
    ("Artifact", {"action": "read"}, ("Artifact read", "")),
    ("Artifact", {}, ("Artifact publish", "")),
    ("mcp__home__pi_health", {}, ("pi health", "home")),
    ("mcp__plugin_x_y__do_thing", {"a": 1}, ("do thing", "plugin_x_y")),
    ("mcp__broken", {}, ("broken", "")),
    ("TodoWrite", {}, ("TodoWrite", "")),
    ("Bash", None, ("Ran a command", "")),
    ("Read", "not a dict", ("Read ", "")),
]
HOOK = Path.home() / ".claude/hooks/localai-progress.py"


@pytest.mark.parametrize("tool,inp,expected", CASES)
def test_describe_matches_the_existing_hook(tool, inp, expected):
    assert describe(tool, inp) == expected


@pytest.mark.skipif(not HOOK.is_file(), reason="the Mac's hook isn't installed here")
def test_describe_agrees_with_the_installed_hook_function():
    spec = importlib.util.spec_from_file_location("localai_progress_hook", HOOK)
    hook = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hook)  # main() is guarded by __name__, so importing runs nothing
    for tool, inp, _ in CASES:
        assert describe(tool, inp) == hook.describe(tool, inp)
    assert short_path("/a/b/c") == hook.short_path("/a/b/c")
