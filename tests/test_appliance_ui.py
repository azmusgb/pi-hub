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
    tokens, comps, needs, app = (html.find(x) for x in (
        "/static/ui/tokens.css", "/static/ui/components.css", "/static/ui/needs.css", "/static/app.css"))
    assert 0 <= tokens < comps < needs < app, (tokens, comps, needs, app)


def test_needs_js_is_a_classic_script_before_the_modules():
    html = open(os.path.join(STATIC, "index.html")).read()
    m = re.search(r'<script\s+src="/static/ui/needs\.js"\s*>\s*</script>', html)
    assert m, "needs.js should be a classic <script src>"
    assert m.start() < html.find('type="module"')


def test_the_app_shell_caches_the_needs_files():
    sw = open(os.path.join(STATIC, "sw.js")).read()
    assert "/static/ui/needs.css" in sw and "/static/ui/needs.js" in sw


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
    assert "pi-hub-shell-v110" in sw


def test_the_app_shell_caches_every_page_module():
    sw = open(os.path.join(STATIC, "sw.js")).read()
    missing = [f"/static/js/{os.path.basename(p)}" for p in sorted(glob.glob(os.path.join(STATIC, "js", "*.js")))
               if f"/static/js/{os.path.basename(p)}" not in sw]
    assert missing == []


def _kit():
    import json
    return json.load(open(os.path.join(STATIC, "ui", "tokens.json")))["color"]


def _rgb(hexv):
    return " ".join(str(int(hexv[i:i + 2], 16)) for i in (1, 3, 5))


def test_no_amber_or_old_status_literals_in_the_page_code():
    found = [f"{os.path.basename(p)}: {a}" for p in glob.glob(os.path.join(STATIC, "js", "*.js"))
             for a in ("#d49b20", "#f2c45c", "#b26a00", "#f5b04a") if a in open(p).read().lower()]
    assert found == []


def test_the_printer_accent_and_progress_line_work_outside_the_band_too():
    css = open(os.path.join(STATIC, "home.css")).read()
    assert re.search(r"(^|\n):root\s*\{[^}]*--band-accent:\s*#b26a00", css), "--band-accent on :root"
    assert re.search(r"(^|\n)\.line-bead\s*\{[^}]*var\(--band-accent\)", css), "an unscoped .line-bead rule"


def test_warning_states_use_the_warning_colour():
    for f, sel in (("enhance.css", '.fix-result[data-tone="warn"]'), ("household-features.css", '.project-card[data-warning="true"]')):
        css = open(os.path.join(STATIC, f)).read()
        rule = css[css.index(sel):css.index("}", css.index(sel))]
        assert "var(--warn)" in rule and "--accent" not in rule, (f, rule)


def test_the_status_triples_follow_the_kit():
    kit, css = _kit(), re.sub(r"[ \t]+", " ", open(os.path.join(STATIC, "app.css")).read())
    for mode in ("light", "dark"):
        for name, token in (("ok", "ok"), ("warn", "warn"), ("bad", "bad"), ("pei", "accent"), ("ink", "text")):
            assert f"--{name}-rgb: {_rgb(kit[token][mode])};" in css, (mode, name, kit[token][mode])


def test_browser_chrome_colours_follow_the_kit():
    kit = _kit()
    html = open(os.path.join(STATIC, "index.html")).read().lower()
    main = open(os.path.join(STATIC, "js", "main.js")).read().lower()
    for mode in ("light", "dark"):
        assert kit["bg"][mode] in html and kit["bg"][mode] in main, mode
    assert "#f4f1ea" not in html and "#0a0c0f" not in html


def test_shadows_are_the_kits_ink_not_warm_brown():
    # Light-mode shadows are the kit's text colour (cool ink); the old warm brown (32,27,20) and the kiosk's yellow
    # glow are gone, and a lit kiosk light uses the warning colour like the Now page's shop light.
    ink = _rgb(_kit()["text"]["light"])
    found = []
    for path in glob.glob(os.path.join(STATIC, "*.css")):
        flat = re.sub(r"\s+", "", open(path).read())
        found += [f"{os.path.basename(path)}: {w}" for w in ("32,27,20", "242,196,92", "#f2c45c") if w in flat
                  and not (w != "32,27,20" and os.path.basename(path) == "home.css" and _only_weather(path, w))]
    assert found == []
    css = re.sub(r"[ \t]+", " ", open(os.path.join(STATIC, "app.css")).read())
    assert f"--shade-rgb: {ink};" in css
    assert "--shadow-1: 0 1px 2px rgb(var(--shade-rgb) / .05)" in css and "rgba(15, 12, 9" not in css


def _only_weather(path, w):
    # The weather icons are drawn yellow on purpose; only they may use it.
    return all(".wx-" in line for line in open(path) if w in re.sub(r"\s+", "", line))


def test_colour_triples_are_space_separated():
    # rgb(var(--x-rgb) / .1) only works with "r g b"; a comma triple there makes the whole colour invalid, and the
    # tint, border or shadow silently disappears.
    bad = [f"{os.path.basename(p)}: {m}" for p in glob.glob(os.path.join(STATIC, "*.css"))
           for m in re.findall(r"--[a-z-]+-rgb:\s*[^;]*,[^;]*;", open(p).read())]
    assert bad == []


def test_meter_fill_starts_at_3_to_1_on_the_well():
    # The fill's light end is the status colour at 85% over white: at 70% it was 2.95 on the light well (3:1 needed).
    css = open(os.path.join(STATIC, "enhance.css")).read()
    for tone, var in (("ok", "ok"), ("warn", "warn"), ("danger", "danger")):
        rule = re.search(r"\.meter--%s \.meter-bar::after\s*\{([^}]*)\}" % tone, css).group(1)
        assert f"color-mix(in srgb, var(--{var}) 85%, white)" in rule, tone
