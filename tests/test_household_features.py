import os
os.environ['HUB_NO_SAMPLER'] = '1'

import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import time

import pytest
from fastapi.testclient import TestClient
from hub import auth, db, events, filament, homecontrol, movie_night, plex
from hub import app as hub_app

SAME={'Origin':'http://testserver'}
POOL=[{'key':'1','title':'Up','year':2009,'minutes':80,'content_rating':'PG','thumb':None,'summary':'An adventure.'},
      {'key':'2','title':'Alien','year':1979,'minutes':117,'content_rating':'R','thumb':None},
      {'key':'3','title':'Unknown runtime','minutes':None,'content_rating':'PG','thumb':None}]


@pytest.fixture(autouse=True)
def isolated(monkeypatch,tmp_path):
    monkeypatch.setenv('HUB_DB',str(tmp_path/'hub.db'))
    monkeypatch.setenv('HUB_PROJECT_FILES',str(tmp_path/'files'))
    monkeypatch.setattr(plex,'library_stats',lambda:{'_unwatched':POOL})
    monkeypatch.setattr(homecontrol,'accessories',lambda:[])
    auth._tries.clear()


def test_preview_has_no_execution_or_real_run_side_effects(monkeypatch):
    events.ready()
    stamp=int(time.time())
    db.run('INSERT INTO events VALUES (?,?,?)',stamp,'print_finished','Test print')
    monkeypatch.setattr(events,'execute',lambda *a:pytest.fail('Preview executed'))
    monkeypatch.setattr(events,'push',lambda *a,**k:pytest.fail('Preview sent a message'))
    monkeypatch.setattr(events,'topic_ready',lambda:True)
    monkeypatch.setattr(events,'quiet_now',lambda *a:False)
    before=len(events.rules())
    result=events.preview({'trigger':'print_finished','action':'notify'}, {})
    assert result['matches']==result['would_run']==1
    assert result['samples'][0]['status']=='would_run'
    assert not events.history() and len(events.rules())==before


def test_preview_explains_quiet_hours_urgent_bypass_and_unavailable_target(monkeypatch):
    monkeypatch.setattr(events,'quiet_now',lambda *a:True)
    monkeypatch.setattr(events,'topic_ready',lambda:True)
    draft={'trigger':'print_finished','action':'notify'}
    assert events.preview(draft,{})['now']['status']=='skipped'
    assert events.preview({**draft,'trigger':'weather_alert'}, {})['now']['status']=='would_run'
    assert events.preview({**draft,'enabled':False},{})['now']['status']=='skipped'
    assert events.preview({'trigger':'print_finished','action':'turn_on','target':'missing'}, {})['now']['status']=='blocked'
    monkeypatch.setattr(events,'topic_ready',lambda:False)
    assert events.preview({**draft,'trigger':'weather_alert'}, {})['now']['status']=='blocked'
    with pytest.raises(ValueError):events.preview({'trigger':'bad','action':'notify'})


def test_history_records_success_failure_disabled_and_preserves_deleted_rule(monkeypatch):
    events.ready()
    db.run('DELETE FROM rules')
    good=events.add_rule('print_finished','notify')
    off=events.add_rule('print_finished','restart_plex')
    db.run('UPDATE rules SET enabled=0 WHERE id=?',off)
    monkeypatch.setattr(events,'quiet_now',lambda *a:False)
    monkeypatch.setattr(events,'push',lambda *a,**k:'Sent.')
    events.fire('print_finished','Plate done')
    rows={r['rule_id']:r for r in events.history()}
    assert rows[good]['status']=='succeeded' and rows[off]['status']=='skipped'
    monkeypatch.setattr(events,'push',lambda *a,**k:"The phone message didn't go out.")
    events.fire('print_finished')
    assert next(r for r in events.history() if r['rule_id']==good)['status']=='failed'
    db.run('DELETE FROM rules WHERE id=?',good)
    assert any(r['rule_id']==good and 'print finishes' in r['rule_text'] for r in events.history())


def test_movie_votes_are_idempotent_per_identity_and_persist_when_plex_down(monkeypatch):
    movie_night.add('1');movie_night.add('1')
    movie_night.vote('1','person:1',True);movie_night.vote('1','person:1',True)
    movie_night.vote('1','person:2',True)
    movie_night.choose('1')
    monkeypatch.setattr(plex,'library_stats',lambda:None)
    result=movie_night.view('person:1')
    assert len(result['shortlist'])==1 and result['shortlist'][0]['votes']==2
    assert result['shortlist'][0]['voted'] and result['chosen']=='1'
    assert not result['library_available']
    movie_night.vote('1','person:1',False)
    assert movie_night.view('person:1')['shortlist'][0]['votes']==1
    movie_night.remove('1')
    assert not movie_night.view()['shortlist'] and not db.rows('SELECT * FROM movie_votes')
    with pytest.raises(ValueError):movie_night.vote('1','person:1',True)


def test_movie_time_and_rating_filters_explain_matches():
    result=movie_night.view(minutes=90,kids=True)
    assert [m['key'] for m in result['suggestions']]==['1']
    assert '10 min' in result['suggestions'][0]['reasons'][1]
    with pytest.raises(ValueError):movie_night.view(minutes=-1)
    with pytest.raises(ValueError):movie_night.add('../../settings')


def test_named_person_voter_is_shared_across_sessions_without_exposing_token(monkeypatch):
    monkeypatch.setattr(auth,'session',lambda token:{'person_id':7} if token!='shared' else {'person_id':None})
    assert movie_night.voter('first')==movie_night.voter('second')=='person:7'
    assert movie_night.voter('shared').startswith('session:') and 'shared' not in movie_night.voter('shared')


def test_feature_routes_enforce_roles(monkeypatch):
    c=TestClient(hub_app.app)
    assert c.post('/api/rules/preview',json={'trigger':'print_finished','action':'notify'},headers=SAME).status_code==401
    assert c.post('/api/movie-night',json={'key':'1'},headers=SAME).status_code==401
    # Projects and spools live in Bambuddy since 24 Oct 2026; the hub has no routes that change them.
    assert c.post('/api/projects',json={'title':'Model'},headers=SAME).status_code==405
    assert c.post('/api/filament',json={'material':'PLA','colour':'Red'},headers=SAME).status_code in (404,405)


def test_real_child_can_vote_but_cannot_choose(monkeypatch,tmp_path):
    code=tmp_path/'setup';code.write_text('ABCD-1234')
    monkeypatch.setenv('HUB_SETUP_CODE_FILE',str(code))
    auth.setup('ABCD-1234','strong password','123456')
    auth.add_person('Kid','kid','222222')
    c=TestClient(hub_app.app)
    assert c.post('/api/signin',json={'pin':'222222'},headers=SAME).status_code==200
    assert c.post('/api/movie-night',json={'key':'1'},headers=SAME).status_code==200
    assert c.post('/api/movie-night/1/vote',json={'vote':True},headers=SAME).status_code==200
    assert c.post('/api/movie-night/1/choose',headers=SAME).status_code==403
    assert c.post('/api/rules/preview',json={'trigger':'print_finished','action':'notify'},headers=SAME).status_code==403


def test_backup_snapshot_contains_database_and_only_referenced_files(tmp_path):
    # Files attached to the hub's old project board (before Bambuddy held projects) are still backed up.
    files_dir=Path(os.environ['HUB_PROJECT_FILES']);files_dir.mkdir(parents=True,exist_ok=True)
    db.conn().executescript("CREATE TABLE IF NOT EXISTS project_files (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, "
                            "stored_name TEXT NOT NULL UNIQUE, name TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL)")
    db.run("INSERT INTO project_files (project_id, stored_name, name, size, created) VALUES (1, 'kept.stl', 'model.stl', 13, 0)")
    (files_dir/'kept.stl').write_bytes(b'restore model')
    (files_dir/'.upload-incomplete').write_bytes(b'not finished')
    script=(Path(__file__).resolve().parents[1]/'deploy/pi-hub-backup.sh').read_text()
    block=script.split("<<'PYBACKUP'\n",1)[1].split('\nPYBACKUP',1)[0]
    block=block.replace('/var/lib/pi-hub/hub.db',os.environ['HUB_DB']).replace('/var/lib/pi-hub/project-files',str(files_dir))
    destination=tmp_path/'snapshot';destination.mkdir()
    result=subprocess.run([sys.executable,'-c',block,str(destination/'hub.db')],capture_output=True,text=True,timeout=10)
    assert result.returncode==0,result.stderr
    restored=sqlite3.connect(destination/'hub.db')
    assert restored.execute('SELECT name FROM project_files').fetchone()[0]=='model.stl'
    files=destination/'var/lib/pi-hub/project-files'
    assert (files/'kept.stl').read_bytes()==b'restore model'
    assert not (files/'.upload-incomplete').exists()


def test_parallel_first_requests_migrate_each_column_once():
    from concurrent.futures import ThreadPoolExecutor
    from hub import reminders
    # Each thread has its own SQLite connection, as concurrent API requests do.
    db.conn()
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: (reminders.ready(), filament.ready(), auth._ready()), range(16)))
    assert {'due','repeat','reminded'} <= {row['name'] for row in db.rows('PRAGMA table_info(items)')}
    assert 'person_id' in {row['name'] for row in db.rows('PRAGMA table_info(sessions)')}


def test_unknown_device_readings_do_not_trigger_automations(monkeypatch):
    from hub import records
    from tests.helpers_records import bud, inputs
    records._reset_memory()
    events._last.clear()
    fired=[]
    monkeypatch.setattr(events,'fire',lambda kind,*a,**k:fired.append(kind))
    good=inputs(bambuddy=bud('RUNNING',50))
    events.on_changes(records.refresh(1000,inputs=good),first=True)
    unknown=inputs(bambuddy=None,netmon={'status':'ok'},
                   pi_status={'drive_state':'Unknown','services':{},'ai_state':'Unknown','x2d_state':'No status'})
    for stamp in (1030,1060,2000):
        events.on_changes(records.refresh(stamp,inputs=unknown),first=False)
    assert fired==[]
    assert records.get('printer')['state']=='printing'
    events.on_changes(records.refresh(2030,inputs=inputs(bambuddy=bud('IDLE',0))),first=False)
    assert fired==['print_failed']


def test_search_nomination_can_add_an_already_watched_movie(monkeypatch):
    paths=[]
    def metadata(path):
        paths.append(path)
        return {'MediaContainer':{'Metadata':[{'ratingKey':'99','type':'movie','title':'A film to revisit','duration':5400000,'contentRating':'PG'}]}}
    monkeypatch.setattr(plex,'_json',metadata)
    item=movie_night.add('99')
    assert item['title']=='A film to revisit' and item['minutes']==90
    assert paths==['/library/metadata/99']
    assert movie_night.view()['shortlist'][0]['key']=='99'
