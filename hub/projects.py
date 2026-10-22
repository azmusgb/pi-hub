"""Workshop planning, deliberately separate from printer control and filament accounting."""
import math
import os
import re
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from . import db, filament

STAGES = {'idea': 'Ideas', 'ready': 'Ready to print', 'printing': 'Printing', 'finished': 'Finished'}
EXTENSIONS = {'.stl', '.3mf', '.step', '.stp', '.obj', '.gcode', '.bgcode', '.pdf'}
MAX_FILE = 25 * 1024 * 1024
MAX_STORAGE = 250 * 1024 * 1024
SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
 id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
 stage TEXT NOT NULL DEFAULT 'idea', material TEXT NOT NULL DEFAULT '', spool_id INTEGER,
 grams INTEGER, minutes INTEGER, created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project_files (
 id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, stored_name TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL
);
"""


def ready():
    filament.ready()
    db.conn().executescript(SCHEMA)


def folder():
    return Path(os.environ.get('HUB_PROJECT_FILES', '/var/lib/pi-hub/project-files'))


def exists(project_id):
    row = db.one('SELECT * FROM projects WHERE id=?', project_id)
    if not row:
        raise ValueError('That project no longer exists. Refresh the board.')
    return row


def clean(b, partial=False):
    if not isinstance(b, dict):
        raise ValueError("Supply the project fields as an object.")
    out = {}
    for key, limit in [('title',100),('notes',2000),('material',30),('link',1000)]:
        if key in b or (key == 'title' and not partial):
            value = str(b.get(key) or '').strip()[:limit]
            if key == 'title' and not value:
                raise ValueError('Give the project a name.')
            if key == 'link' and value:
                parsed = urlsplit(value)
                if parsed.scheme not in ('http','https') or not parsed.netloc or parsed.username or parsed.password:
                    raise ValueError('Use a complete http or https link without a password.')
            if key == 'material' and value and value not in filament.MATERIALS:
                raise ValueError('Choose a material from the list.')
            out[key] = value
    if 'stage' in b:
        if not isinstance(b['stage'], str) or b['stage'] not in STAGES:
            raise ValueError('Choose a project stage.')
        out['stage'] = b['stage']
    for key, upper in [('grams',5000),('minutes',10080),('spool_id',2**31-1)]:
        if key in b:
            if b[key] in ('',None):
                out[key] = None
                continue
            try:
                number = float(b[key])
                if not math.isfinite(number) or number != int(number) or not 1 <= number <= upper:
                    raise ValueError()
                out[key] = int(number)
            except (TypeError,ValueError,OverflowError):
                raise ValueError(f'Enter a whole number for {key.replace("_", " ")} between 1 and {upper}.')
    if out.get('spool_id') and not db.one('SELECT id FROM spools WHERE id=? AND finished IS NULL', out['spool_id']):
        raise ValueError('Choose an active spool from the filament shelf.')
    return out


def add(body):
    ready()
    values = clean(body)
    stamp = int(time.time())
    with db.transaction():
        if db.one('SELECT COUNT(*) AS n FROM projects')['n'] >= 100:
            raise ValueError('The board holds 100 projects. Remove an old one first.')
        columns = [*values, 'created', 'updated']
        return db.run(f'INSERT INTO projects ({", ".join(columns)}) VALUES ({", ".join("?" for _ in columns)})',
                      *values.values(), stamp, stamp).lastrowid


def update(project_id, body):
    ready()
    values = clean(body, partial=True)
    with db.transaction():
        exists(project_id)
        if values:
            db.run(f'UPDATE projects SET {", ".join(k + "=?" for k in values)}, updated=? WHERE id=?',
                   *values.values(), int(time.time()), project_id)


def delete(project_id):
    ready()
    with db.transaction():
        exists(project_id)
        files = db.rows('SELECT stored_name FROM project_files WHERE project_id=?', project_id)
        db.run('DELETE FROM project_files WHERE project_id=?', project_id)
        db.run('DELETE FROM projects WHERE id=?', project_id)
    for item in files:
        (folder() / item['stored_name']).unlink(missing_ok=True)


def attach(project_id, name, temp_path, size):
    ready()
    name = Path(str(name).replace('\\','/')).name
    name = re.sub(r'[^\w. ()-]', '_', name)[:120]
    if Path(name).suffix.lower() not in EXTENSIONS:
        raise ValueError('Use an STL, 3MF, STEP, OBJ, G-code or PDF file.')
    if not 0 < size <= MAX_FILE:
        raise ValueError('Choose a nonempty file up to 25 MB.')
    destination = folder() / (uuid.uuid4().hex + Path(name).suffix.lower())
    folder().mkdir(parents=True, exist_ok=True)
    try:
        with db.transaction():
            exists(project_id)
            if db.one('SELECT COUNT(*) AS n FROM project_files WHERE project_id=?', project_id)['n'] >= 5:
                raise ValueError('Each project holds five files. Remove one before adding another.')
            used = db.one('SELECT COALESCE(SUM(size),0) AS n FROM project_files')['n']
            if used + size > MAX_STORAGE:
                raise ValueError('Project files have reached 250 MB. Remove files you no longer need.')
            os.replace(temp_path, destination)
            return db.run('INSERT INTO project_files (project_id,stored_name,name,size,created) VALUES (?,?,?,?,?)',
                          project_id,destination.name,name,size,int(time.time())).lastrowid
    except BaseException:
        destination.unlink(missing_ok=True)
        raise


def file(file_id):
    ready()
    item = db.one('SELECT * FROM project_files WHERE id=?', file_id)
    if not item or not (folder() / item['stored_name']).is_file():
        raise ValueError('That file is no longer available.')
    return item, folder() / item['stored_name']


def remove_file(file_id):
    ready()
    item, path = file(file_id)
    db.run('DELETE FROM project_files WHERE id=?', item['id'])
    path.unlink(missing_ok=True)


def view():
    ready()
    spools = {s['id']: s for s in filament.spools()}
    projects = db.rows('SELECT * FROM projects ORDER BY updated DESC,id DESC')
    files = db.rows('SELECT id,project_id,name,size FROM project_files ORDER BY id')
    reserved = {}
    for p in projects:
        if p['stage'] in ('ready','printing') and p['spool_id'] and p['grams']:
            reserved[p['spool_id']] = reserved.get(p['spool_id'],0) + p['grams']
    for p in projects:
        spool = spools.get(p['spool_id'])
        warnings = []
        if p['spool_id'] and not spool:
            warnings.append('The selected spool is no longer available.')
        if spool:
            if p['material'] and p['material'] != spool['material']:
                warnings.append(f"This project needs {p['material']}; the selected spool is {spool['material']}.")
            if p['grams'] and p['grams'] > spool['grams_left']:
                warnings.append(f"Needs {p['grams'] - spool['grams_left']} g more than this spool has left.")
            if reserved.get(spool['id'],0) > spool['grams_left']:
                warnings.append(f"Ready/printing projects plan {reserved[spool['id']]} g against {spool['grams_left']} g left on this spool.")
        if p['stage'] in ('ready','printing') and (not p['grams'] or not spool):
            warnings.append('Choose a spool and add a filament estimate before printing.')
        if p['stage'] == 'finished':
            warnings = []
        p.update(files=[f for f in files if f['project_id']==p['id']], warnings=warnings,
                 spool_name=f"{spool['colour']} {spool['material']}" if spool else None,
                 estimated_cost=round(p['grams'] * spool['price']/spool['grams_total'],2)
                 if spool and p['grams'] and spool['price'] and spool['grams_total'] else None)
    return {'projects': projects, 'stages': STAGES, 'spools': list(spools.values()),
            'materials': filament.MATERIALS, 'storage_used': sum(f['size'] for f in files),
            'storage_limit': MAX_STORAGE}
