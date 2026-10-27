"""The iPad as a Home Screen app (27 Oct screenshot): iPadOS blurs whatever sits under its see-through status bar, and
Pi Hub's title and the rail's name sat there. Installed as an app, both keep their usual spacing plus the status bar."""
import os
import re

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "hub", "static")


def standalone(name):
    text = open(os.path.join(STATIC, name)).read()
    m = re.search(r"@media \(display-mode: standalone\) \{(.*?)\n\}", text, re.S)
    return m.group(1) if m else ""


def test_the_page_title_clears_the_status_bar_on_top_of_its_usual_spacing():
    block = standalone("pages.css")
    top = re.search(r"\.top \{([^}]*)\}", block)
    assert top, "the installed app sets the header's top spacing"
    assert "calc(" in top.group(1) and "env(safe-area-inset-top)" in top.group(1) and "+" in top.group(1)
    assert "max(18px" not in top.group(1)  # replacing the spacing put the title under the status bar


def test_the_rails_name_clears_the_status_bar():
    block = standalone("pages.css")
    rail = re.search(r"\.rail \{([^}]*)\}", block)
    assert rail and "env(safe-area-inset-top)" in rail.group(1)


def test_the_status_bar_is_solid_so_nothing_sits_under_it():
    # Spacing alone didn't clear iPadOS's blur, which fades well below the bar (27 Oct, still fuzzy): a solid status bar
    # gives the page its own strip below it, so nothing of Pi Hub is ever under the bar.
    html = open(os.path.join(STATIC, "index.html")).read()
    m = re.search(r'name="apple-mobile-web-app-status-bar-style"\s+content="([^"]+)"', html)
    assert m and m.group(1) == "default"
