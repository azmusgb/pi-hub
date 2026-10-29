import shutil
import subprocess

import pytest


def test_lab_v2_module():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    subprocess.run(
        [node, "tests/test_lab_v2.mjs"],
        check=True,
        text=True,
    )
