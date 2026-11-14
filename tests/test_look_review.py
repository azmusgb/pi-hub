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
    note = rule(css("pages.css"), ".note")
    assert "color: var(--text)" in note or "color: var(--ui-text)" in note  # the kit's name since step 13, H11
    home = css("home.css")
    assert "--warn-ink" not in rule(home, ".out-alert")
    # Weather's warnings are the kit's ui-notice since A7 H3: no local colour on them at all.
    assert ".wx-alert strong" not in home


def test_poster_titles_sit_under_the_artwork_in_the_theme_colours():
    # A10 plan decision 15 replaced the white titles over the photo, which failed contrast on light posters.
    m = css("movies.css")
    assert ".poster-card .poster-meta,\n.poster-card .poster-title" not in m
    title = rule(m, ".poster-title")
    assert "var(--text)" in title or "var(--ui-text)" in title


def test_no_warm_leftovers():
    found = [f"{os.path.basename(p)}: {w}" for p in glob.glob(os.path.join(STATIC, "*.css"))
             for w in ("#cfae6e", "#dcbd80", "#1b1a16", "rgba(10,8,5", "rgba(10, 8, 5", "#f1ede4") if w in open(p).read()]
    assert found == []


def test_a_lit_light_uses_the_accent_not_amber():
    lit = rule(css("home.css"), ".kiosk-light-toggle-btn.is-on")
    assert "var(--accent)" in lit or "var(--ui-accent)" in lit  # the kit's name since step 13, H16
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
    from hub import records
    from tests.helpers_records import PI, bud, records_from
    feed = {"cards": [{"kind": "watch", "title": "Heads up", "text": "The printer stopped with an error", "tone": "attention"},
                      {"kind": "needs", "title": "Needs you", "text": "Approve the E-009 print.", "tone": "attention"}]}
    quiet = dict(PI, mirror={"last_ok": 1_800_000_000})
    failed = records.problems(records_from(quiet, bud("FAILED", progress=24, awaiting=True), now=1_800_000_000))
    n = needs.build([], feed, 1_800_000_000, failed)
    titles = [i["title"] for i in n["items"]]
    # the hub's own printer record wins over Local AI's echo of it (it was the hub's print event before the records)
    assert titles == ["Bambu X2D", "Needs you"], titles
    # Without a printer record, Local AI's row about the printer stays (still only one).
    n = needs.build([], feed, 1_800_000_000, [])
    assert [i["title"] for i in n["items"]] == ["Heads up", "Needs you"]


def test_side_by_side_tool_links_have_room():
    # 1rem is the kit's --ui-s-4 since step 13, H16.
    assert re.search(r"\.tool-link \+ \.tool-link \{[^}]*margin-left: (1rem|var\(--ui-s-4\))", css("home.css"))
