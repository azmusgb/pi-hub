import shutil
import subprocess

import pytest


def test_lab_evidence_module():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    subprocess.run(
        [node, "tests/test_lab_evidence.mjs"],
        check=True,
        text=True,
    )
