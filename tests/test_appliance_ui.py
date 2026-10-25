"""One home, step 5: the hub wears the appliance-ui kit; amber stays only on the printer band."""
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "hub", "static")
AMBER = ["#b26a00", "#8f5300", "#f5b04a", "#ffc670", "178,106,0", "245,176,74"]


def verify(folder):
    return subprocess.run([sys.executable, os.path.join(folder, "verify.py"), folder], capture_output=True, text=True)


def test_the_kit_copy_is_untouched():
    r = verify(os.path.join(STATIC, "ui"))
    assert r.returncode == 0, r.stdout + r.stderr


def test_an_edited_kit_copy_fails():
    tmp = os.path.join(tempfile.mkdtemp(), "ui")
    shutil.copytree(os.path.join(STATIC, "ui"), tmp)
    with open(os.path.join(tmp, "tokens.css"), "a") as f:
        f.write("/* edited */")
    assert verify(tmp).returncode != 0


def test_the_page_loads_the_kit_before_its_own_styles():
    html = open(os.path.join(STATIC, "index.html")).read()
    tokens, comps, app = (html.find(x) for x in ("/static/ui/tokens.css", "/static/ui/components.css", "/static/app.css"))
    assert 0 <= tokens < comps < app, (tokens, comps, app)


def test_amber_only_on_the_printer_band():
    found = []
    for path in glob.glob(os.path.join(STATIC, "*.css")):
        for n, line in enumerate(open(path), 1):
            if "--band-accent" in line:
                continue
            flat = re.sub(r"\s+", "", line.lower())
            found += [f"{os.path.basename(path)}:{n} {a}" for a in AMBER if a in flat]
    assert found == []


def test_the_app_shell_caches_the_kit():
    sw = open(os.path.join(STATIC, "sw.js")).read()
    assert "/static/ui/tokens.css" in sw and "/static/ui/components.css" in sw
    assert "pi-hub-shell-v89" in sw
