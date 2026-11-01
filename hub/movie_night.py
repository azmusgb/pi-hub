"""A persistent household shortlist, with one vote per signed-in session."""
import hashlib
import json
import re
import time

from . import auth, db, plex

SCHEMA = """
CREATE TABLE IF NOT EXISTS movie_shortlist (
 movie_key TEXT PRIMARY KEY, metadata TEXT NOT NULL, added INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS movie_night_choice (id INTEGER PRIMARY KEY CHECK(id=1), movie_key TEXT);
CREATE TABLE IF NOT EXISTS movie_votes (
 movie_key TEXT NOT NULL, voter TEXT NOT NULL, created INTEGER NOT NULL,
 PRIMARY KEY(movie_key, voter)
);
"""


def ready():
    db.conn().executescript(SCHEMA)


def voter(token):
    session = auth.session(token)
    if not session:
        return None
    return "session:" + hashlib.sha256(token.encode()).hexdigest()


def movie(key):
    key = str(key)
    if not re.fullmatch(r"\d{1,12}", key):
        raise ValueError("Choose a movie from the library.")
    stats = plex.library_stats() or {}
    item = next((m for m in stats.get('_unwatched', []) if m['key'] == key), None)
    if item is None:
        try:
            raw = plex._json(f"/library/metadata/{key}")['MediaContainer']['Metadata'][0]
            if raw.get('type') != 'movie':
                raise ValueError("Choose a movie, rather than an episode.")
            item = {**plex._item(raw), 'content_rating': raw.get('contentRating')}
        except (KeyError, IndexError, OSError) as e:
            raise ValueError("Plex could not find that movie. Try again when the library is available.") from e
    return {k: item.get(k) for k in ('key', 'title', 'year', 'minutes', 'thumb', 'summary', 'content_rating', 'rating')}


def add(key):
    ready()
    item = movie(key)
    with db.transaction():
        if not db.one("SELECT movie_key FROM movie_shortlist WHERE movie_key = ?", item['key']) and \
           db.one("SELECT COUNT(*) AS n FROM movie_shortlist")['n'] >= 12:
            raise ValueError("Keep tonight's shortlist to 12 films. Remove one first.")
        db.run("INSERT INTO movie_shortlist VALUES (?, ?, ?) ON CONFLICT(movie_key) DO UPDATE SET metadata=excluded.metadata",
               item['key'], json.dumps(item), int(time.time()))
    return item


def vote(key, identity, on):
    ready()
    if not identity:
        raise ValueError("Sign in to vote.")
    with db.transaction():
        if not db.one("SELECT movie_key FROM movie_shortlist WHERE movie_key = ?", key):
            raise ValueError("That movie is no longer on the shortlist.")
        if not isinstance(on, bool):
            raise ValueError("Choose whether to vote for this movie.")
        if on:
            db.run("INSERT OR IGNORE INTO movie_votes VALUES (?, ?, ?)", key, identity, int(time.time()))
        else:
            db.run("DELETE FROM movie_votes WHERE movie_key = ? AND voter = ?", key, identity)


def remove(key):
    ready()
    with db.transaction():
        db.run("DELETE FROM movie_votes WHERE movie_key = ?", key)
        db.run("DELETE FROM movie_shortlist WHERE movie_key = ?", key)
        db.run("DELETE FROM movie_night_choice WHERE movie_key = ?", key)


def choose(key):
    ready()
    with db.transaction():
        if not db.one("SELECT movie_key FROM movie_shortlist WHERE movie_key = ?", key):
            raise ValueError("Choose a film from the shortlist.")
        db.run("INSERT INTO movie_night_choice VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET movie_key=excluded.movie_key", key)


def view(identity=None, minutes=0, kids=False):
    ready()
    if minutes not in (0, 60, 90, 120, 150, 180):
        raise ValueError("Choose a time budget from the list.")
    rows = db.rows("SELECT s.*, COUNT(v.voter) AS votes, MAX(CASE WHEN v.voter = ? THEN 1 ELSE 0 END) AS voted "
                   "FROM movie_shortlist s LEFT JOIN movie_votes v ON v.movie_key=s.movie_key "
                   "GROUP BY s.movie_key ORDER BY votes DESC, s.added, s.movie_key", identity)
    shortlist = [{**json.loads(r['metadata']), 'votes': r['votes'], 'voted': bool(r['voted'])} for r in rows]
    stats = plex.library_stats()
    pool = (stats or {}).get('_unwatched', [])
    suggestions = []
    for item in pool:
        if any(s['key'] == item['key'] for s in shortlist):
            continue
        if kids and item.get('content_rating') not in ('G', 'PG', 'TV-G', 'TV-Y', 'TV-Y7', 'TV-PG'):
            continue
        if minutes and (not item.get('minutes') or item['minutes'] > minutes):
            continue
        reasons = ['Unwatched']
        if minutes:
            reasons.append(f"{minutes - item['minutes']} min inside your time budget")
        if kids:
            reasons.append(f"Rated {item['content_rating']}; check suitability for your family")
        suggestions.append({**{k: item.get(k) for k in ('key','title','year','minutes','thumb','summary','content_rating')},
                            'reasons': reasons})
        if len(suggestions) == 6:
            break
    choice = (db.one('SELECT movie_key FROM movie_night_choice WHERE id=1') or {}).get('movie_key')
    return {'shortlist': shortlist, 'suggestions': suggestions, 'library_available': stats is not None,
            'chosen': choice if any(s['key'] == choice for s in shortlist) else None,
            'leader': shortlist[0]['key'] if shortlist and shortlist[0]['votes'] > 0 else None,
            'signed_in': identity is not None}
