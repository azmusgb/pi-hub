"""Fresh look review, 25 Oct (after the colour triples started to render): readable notes and poster titles, no warm
leftovers, link-buttons that look like buttons, a full-width search, honest spool bars, one printer row in Needs you."""
import glob
import os
import re

from hub import needs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "hub", "static")


def css(name):
    return open(os.path.join(STATIC, name)).read()


def rule(text, selector):
    i = text.index(selector + " {") if selector + " {" in text else text.index(selector + "{")
    return text[i:text.index("}", i)]


def test_notes_on_a_warning_tint_use_body_text():
    # --warn-ink is for text on a solid warning fill; on a 10% tint it was white-on-beige / black-on-brown.
    assert "--warn-ink" not in rule(css("pages.css"), ".note")
    assert "var(--text)" in rule(css("pages.css"), ".note")
    home = css("home.css")
    assert "--warn-ink" not in rule(home, ".out-alert") and "--warn-ink" not in rule(home, ".wx-alert strong")


def test_poster_titles_over_the_artwork_are_white():
    m = css("movies.css")
    over = rule(m, ".poster-card .poster-meta,\n.poster-card .poster-title")
    assert "color: #fff" in over


def test_no_warm_leftovers():
    found = [f"{os.path.basename(p)}: {w}" for p in glob.glob(os.path.join(STATIC, "*.css"))
             for w in ("#cfae6e", "#dcbd80", "#1b1a16", "rgba(10,8,5", "rgba(10, 8, 5", "#f1ede4") if w in open(p).read()]
    assert found == []


def test_a_lit_light_uses_the_accent_not_amber():
    assert "var(--accent)" in rule(css("home.css"), ".kiosk-light-toggle-btn.is-on")
    assert "--warn" not in rule(css("home.css"), ".kiosk-light-toggle-btn.is-on")
    now = open(os.path.join(STATIC, "js", "now.js")).read()
    assert "light.on ? 'var(--warn)'" not in now and "isOn ? 'var(--warn)'" not in now


def test_link_buttons_are_not_underlined():
    assert "text-decoration: none" in rule(css("components.css"), "\n.btn")


def test_movie_search_fills_its_row():
    assert "width: 100%" in rule(css("movies.css"), "\n.movie-search")


def test_an_unweighed_spool_has_no_full_bar():
    ws = open(os.path.join(STATIC, "js", "workshop.js")).read()
    assert re.search(r"s\.measured \? h\(\"span\", \{ class: \"meter\" \}", ws), "the meter only for weighed spools"


def test_the_printer_shows_once_in_needs_you():
    feed = {"cards": [{"kind": "watch", "title": "Heads up", "text": "The printer stopped with an error", "tone": "attention"},
                      {"kind": "needs", "title": "Needs you", "text": "Approve the E-009 print.", "tone": "attention"}]}
    issues = [{"what": "Bambu X2D", "say": "Check the printer's screen.", "tone": "bad"}]
    events = [{"ts": 1_800_000_000 - 600, "kind": "print_failed", "detail": "at 24%"}]
    n = needs.build(events, feed, 1_800_000_000, issues)
    titles = [i["title"] for i in n["items"]]
    assert titles == ["The print failed", "Needs you"], titles
    # Without a print event, the most urgent printer row stays (still only one).
    n = needs.build([], feed, 1_800_000_000, issues)
    assert [i["title"] for i in n["items"]] == ["Bambu X2D", "Needs you"]


def test_side_by_side_tool_links_have_room():
    assert re.search(r"\.tool-link \+ \.tool-link \{[^}]*margin-left: 1rem", css("home.css"))
