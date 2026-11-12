#!/usr/bin/env python3
"""Rehearse coexistence, upgrade and full-backup rollback with synthetic projects.

Runs on Linux, macOS and Windows using only the standard library. By default it
fetches the pinned 0.1.1 executable and verifies the release archive checksum.
Pass --previous-binary to use an already verified local release instead.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import shutil
import sqlite3
from contextlib import closing
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

from e2e import isolated_env, free_port, PASSWORD

PREVIOUS = '0.1.1'


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _api_asset(name, timeout):
    """Fetch through the REST API; the token never follows the storage redirect."""
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'crew-upgrade-test'}
    if os.environ.get('GITHUB_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
    repository = f'https://api.github.com/repos/pocketcontext-labs/pocketcontext-crew/releases/tags/v{PREVIOUS}'
    with urllib.request.urlopen(urllib.request.Request(repository, headers=headers), timeout=timeout) as response:
        asset = next(a for a in json.load(response)['assets'] if a['name'] == name)
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(urllib.request.Request(asset['url'], headers={**headers, 'Accept': 'application/octet-stream'}), timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as redirect:
        if redirect.code not in (301, 302, 307) or not redirect.headers.get('Location'):
            raise
        location = redirect.headers['Location']
    with urllib.request.urlopen(location, timeout=timeout) as response:
        return response.read()


def fetch_release_file(base, name, timeout):
    """Download a release file, surviving download-endpoint outages. The caller
    still verifies the archive against the release checksum."""
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(f'{base}/{name}', timeout=timeout) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError) as error:
            last = error
            if isinstance(error, urllib.error.HTTPError) and error.code < 500:
                raise
        try:
            return _api_asset(name, timeout)
        except (urllib.error.URLError, TimeoutError, StopIteration) as error:
            last = error
        time.sleep(10 * (attempt + 1))
    raise AssertionError(f'could not download {name}: {last}')


def download_previous(destination):
    system = {'Linux': 'linux', 'Darwin': 'darwin', 'Windows': 'windows'}[platform.system()]
    arch = {'aarch64': 'arm64', 'arm64': 'arm64', 'AMD64': 'amd64', 'x86_64': 'amd64'}[platform.machine()]
    if system == 'windows':
        arch = 'amd64'
    extension = 'zip' if system == 'windows' else 'tar.gz'
    archive = f'pocketcontext-crew_{PREVIOUS}_{system}_{arch}.{extension}'
    base = f'https://github.com/pocketcontext-labs/pocketcontext-crew/releases/download/v{PREVIOUS}'
    checksums = fetch_release_file(base, 'checksums.txt', 120).decode('utf-8')
    expected = [line.split()[0] for line in checksums.splitlines() if len(line.split()) == 2 and line.split()[1] == archive]
    if len(expected) != 1:
        raise AssertionError('previous archive must have exactly one release checksum')
    data = fetch_release_file(base, archive, 180)
    if hashlib.sha256(data).hexdigest() != expected[0]:
        raise AssertionError('previous release archive checksum mismatch')
    name = 'pocketcontext-crew.exe' if system == 'windows' else 'pocketcontext-crew'
    destination.mkdir()
    binary = destination / name
    if system == 'windows':
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            if package.namelist().count(name) != 1:
                raise AssertionError('previous archive has duplicate or absent executable')
            binary.write_bytes(package.read(name))
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as package:
            members = [member for member in package.getmembers() if member.name == name]
            if len(members) != 1 or not members[0].isfile():
                raise AssertionError('previous archive executable must be one regular file')
            binary.write_bytes(package.extractfile(members[0]).read())
    binary.chmod(0o755)
    return binary


def replace_binary(source, destination):
    stage = destination.with_name(destination.name + '.next')
    shutil.copy2(source, stage)
    for attempt in range(50):
        try:
            os.replace(stage, destination)
            return
        except PermissionError:
            if attempt == 49:
                raise
            time.sleep(0.1)


CREW_TABLES = ('crew_agents', 'crew_buckets', 'crew_notes', 'crew_note_revisions', 'crew_tasks', 'crew_reviews', 'crew_events')
LEGACY_TABLES = ('spaces', 'settings', 'sources', 'renditions', 'passages', 'pages', 'ingestion_runs', 'page_revisions', 'citations', 'page_links', 'publications', 'audit_log')


def table_rows(path, names):
    # Call only after the writer has stopped, or against an immutable archive.
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
        assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
        return {name: db.execute('SELECT * FROM "' + name + '" ORDER BY id').fetchall() for name in names}


def rehearse(target, previous, root):
    home = root / 'home'
    home.mkdir()
    env = isolated_env(home)
    executable = 'pocketcontext-crew.exe' if os.name == 'nt' else 'pocketcontext-crew'
    alpha = root / 'Old project'
    beta = root / 'New project'
    for folder, source in ((alpha, previous), (beta, target)):
        folder.mkdir()
        shutil.copy2(source, folder / executable)

    def run(folder, *args, binary=None, stdin=None, expect=0):
        result = subprocess.run([str(binary or folder / executable), '--db', str(folder / 'pocketcontext.db'), *args],
            input=stdin, capture_output=True, text=True, encoding='utf-8', env=env, timeout=120)
        if result.returncode != expect:
            raise AssertionError(f'{args}: exit {result.returncode}, expected {expect}\n{result.stdout}\n{result.stderr}')
        return result

    def data(folder, *args, **kwargs):
        return json.loads(run(folder, *args, **kwargs).stdout)

    def release(binary):
        return subprocess.check_output([str(binary), '--version'], text=True, encoding='utf-8', env=env).split()[1]

    def owner(folder):
        opened = data(folder, 'open', '--no-browser')
        url, code = opened['signInLink'].split('/bundle/login#')
        request = urllib.request.Request(url + '/api/bundle/redeem', data=json.dumps({'code':code}).encode(), headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request, timeout=10) as response:
            return url, json.load(response)['token']

    def call(session, path, body):
        url, token = session
        request = urllib.request.Request(url + path, data=json.dumps(body).encode(), headers={'Content-Type':'application/json', 'Authorization':token})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)

    old_version, new_version = release(previous), release(target)
    assert old_version == PREVIOUS and old_version != new_version, (old_version, new_version)
    stopped = set()
    try:
        ports = [free_port(), free_port()]
        while ports[0] == ports[1]: ports[1] = free_port()
        for folder, name, port in ((alpha, 'Older', ports[0]), (beta, 'Current', ports[1])):
            data(folder, 'init', '--name', name, '--port', str(port), '--password-stdin', stdin=PASSWORD + '\n')
        session = owner(alpha)
        def write(action, fields, row=None):
            return call(session, '/api/crew/write', {'action':action, 'reported_agent':'Synthetic upgrade', 'reason':'migration fixture', 'data':fields,
                **({'id':row['id'], 'expected_revision':row['revision']} if row else {})})
        agent = write('agent.create', {'name':'Build', 'brief':'Synthetic brief'})
        bucket = write('bucket.create', {'name':'BUILD', 'responsible_agent':agent['id']})
        note = write('note.create', {'bucket':bucket['id'],'title':'Durable note','body':'Before revision'})
        note = write('note.update', {'body':'After revision ✓'}, note)
        task = write('task.create', {'title':'Migration task','draft':'Exact draft','assigned_agent':agent['id'], 'links':[note['id']]})
        review = write('review.request', {}, task)
        archived = write('agent.create', {'name':'Archived'})
        write('agent.update', {'archived':True}, archived)
        text = root / 'synthetic.txt'
        text.write_text('Synthetic legacy evidence: the lighthouse is green.\n', encoding='utf-8')
        source = data(alpha, 'ingest', str(text), '--title', 'Upgrade evidence')['source']
        image = root / 'synthetic.png'
        image.write_bytes(b'\x89PNG\r\n\x1a\nsynthetic migration original\x00')
        data(alpha, 'ingest', str(image))
        assert data(alpha, 'status')['version'] == old_version
        assert data(beta, 'status')['version'] == new_version
        mismatch = run(alpha, 'ensure-running', binary=target, expect=1)
        assert 'earlier' in mismatch.stderr and old_version in mismatch.stderr
        assert data(alpha, 'status', binary=target)['compatible'] is False
        run(alpha, 'stop', binary=target)
        stopped.add(alpha)
        backup = root / 'Complete backup'
        shutil.copytree(alpha, backup)
        old_db = alpha / 'pocketcontext.db'
        before_hash = hashlib.sha256(old_db.read_bytes()).hexdigest()
        before = table_rows(old_db, CREW_TABLES + LEGACY_TABLES)
        identity = json.loads((alpha / 'pocketcontext.json').read_text())['instance']
        replace_binary(target, alpha / executable)
        assert hashlib.sha256(old_db.read_bytes()).hexdigest() == before_hash
        stopped.discard(alpha)
        run(alpha, 'ensure-running')
        session = owner(alpha)
        assert data(alpha, 'whoami')['instance'] == identity
        assert 'space' not in data(alpha, 'whoami')
        notes = call(session, '/api/crew/read', {'collection':'notes'})['items']
        assert len(notes) == 1 and notes[0]['id'] == note['id'] and notes[0]['body'] == 'After revision ✓'
        reviews = call(session, '/api/crew/read', {'collection':'reviews'})['items']
        assert len(reviews) == 1 and reviews[0]['id'] == review['id'] and reviews[0]['draft'] == 'Exact draft' and reviews[0]['status'] == 'pending'
        run(alpha, 'stop')
        stopped.add(alpha)
        after = table_rows(old_db, CREW_TABLES)
        # Added task fields are intentional; every preexisting column and immutable
        # history row must still be byte-for-byte equivalent.
        with closing(sqlite3.connect((backup / 'pocketcontext.db').as_uri()+'?mode=ro',uri=True)) as old, closing(sqlite3.connect(old_db.as_uri()+'?mode=ro',uri=True)) as current:
            for name in CREW_TABLES:
                columns = [row[1] for row in old.execute('PRAGMA table_info("' + name + '")')]
                projection = ','.join('"' + column + '"' for column in columns)
                rows = current.execute('SELECT ' + projection + ' FROM "' + name + '" ORDER BY id').fetchall()
                assert rows == before[name], ('Crew rows/history changed during migration', name)
            assert current.execute("SELECT count(*) FROM crew_tasks WHERE readiness != 'waiting' OR wake_generation != 0").fetchone() == (0,)
            assert current.execute('SELECT count(*) FROM crew_webhook_deliveries').fetchone() == (0,)
            # 0.18.0: every existing agent is a bot and no task carries a claim.
            assert current.execute("SELECT kind, count(*) FROM crew_agents GROUP BY kind").fetchall() == [('bot', 2)]
            assert current.execute("SELECT count(*) FROM crew_tasks WHERE claimed_by != '' OR claim_until != ''").fetchone() == (0,)
            # 0.19.0: tasks keep their status and gain an empty release and approval;
            # status accepts wont_do.
            assert current.execute("SELECT status, release, review_mode, approved_by, approved_at FROM crew_tasks").fetchall() == [('needs_review', '', '', '', '')]
            fields = json.loads(current.execute("SELECT fields FROM _collections WHERE name='crew_tasks'").fetchone()[0])
            status_field = next(f for f in fields if f['name'] == 'status')
            assert status_field['values'] == ['todo', 'in_progress', 'needs_review', 'done', 'wont_do'], status_field
            assert {f['name']: f['type'] for f in fields if f['name'] in ('release', 'review_mode', 'approved_by', 'approved_at')} == {
                'release': 'text', 'review_mode': 'select', 'approved_by': 'text', 'approved_at': 'date'}
            assert current.execute("SELECT count(*) FROM _migrations WHERE file='1801200000_crew_task_release.js'").fetchone() == (1,)
            assert current.execute("SELECT count(*) FROM _migrations WHERE file='1801300000_crew_review_choices.js'").fetchone() == (1,)
            # 0.20.0 freezes legacy hold time and preserves old reviews.
            assert current.execute("SELECT count(*) FROM crew_tasks WHERE readiness='waiting' AND status NOT IN ('done','wont_do') AND held_since != updated").fetchone() == (0,)
            assert current.execute("SELECT count(*) FROM crew_tasks WHERE claimed_at != ''").fetchone() == (0,)
            assert current.execute("SELECT count(*) FROM crew_reviews WHERE options IS NOT NULL OR option_decisions IS NOT NULL").fetchone() == (0,)
            # Current managed instructions, opt-in comment wakes and the default handoff limit.
            instructions, subscriptions, enabled, managed_hash = current.execute(
                "SELECT instructions, subscriptions, enabled, managed_hash FROM crew_webhook_configs WHERE scope='global'").fetchone()
            assert 'id:"execution"' in instructions and 'capabilities_digest' in instructions and not enabled
            assert managed_hash == hashlib.sha256(instructions.encode('utf-8')).hexdigest()
            assert 'comment' not in json.loads(subscriptions or '[]')
            assert current.execute("SELECT max_bot_handoffs FROM crew_webhook_routing").fetchall() == [(4,)]
            assert current.execute('SELECT count(*) FROM crew_tasks WHERE bot_handoffs != 0 OR handoff_limited OR comment_wake_generation != 0').fetchone() == (0,)
        with closing(sqlite3.connect(old_db.as_uri()+'?mode=ro',uri=True)) as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            assert not tables.intersection(LEGACY_TABLES)
        archive_root = alpha / 'legacy-knowledge'
        archive = archive_root / json.loads((archive_root / 'current.json').read_text())['archive']
        manifest = json.loads((archive / 'manifest.json').read_text())
        for path, digest in manifest['files'].items():
            assert hashlib.sha256((archive / path).read_bytes()).hexdigest() == digest, path
        assert set(manifest['tables']) == set(LEGACY_TABLES)
        assert table_rows(archive / 'pocketcontext.db', CREW_TABLES + LEGACY_TABLES) == before
        originals = [path for path in manifest['files'] if path.startswith('storage/') and not path.endswith('.attrs')]
        assert len(originals) >= 2 and any((archive/path).read_bytes() == image.read_bytes() for path in originals)
        # A previous executable must refuse the newer migration history without touching the database.
        migrated_hash = hashlib.sha256(old_db.read_bytes()).hexdigest()
        refused = run(alpha, 'ensure-running', binary=previous, expect=1)
        assert 'migration' in refused.stderr.lower() or 'newer' in refused.stderr.lower(), refused.stderr
        assert hashlib.sha256(old_db.read_bytes()).hexdigest() == migrated_hash
        # Restart and a complete upgraded backup restore retain Crew state and its legacy archive.
        upgraded_backup = root / 'Migrated backup'
        shutil.copytree(alpha, upgraded_backup)
        run(alpha, 'ensure-running'); stopped.discard(alpha)
        run(alpha, 'stop'); stopped.add(alpha)
        assert table_rows(old_db, CREW_TABLES) == after
        shutil.rmtree(alpha); shutil.copytree(upgraded_backup, alpha)
        run(alpha, 'ensure-running'); stopped.discard(alpha)
        run(alpha, 'stop'); stopped.add(alpha)
        assert table_rows(old_db, CREW_TABLES) == after
        # Roll back the complete pre-upgrade project and exact matching binary.
        shutil.rmtree(alpha); shutil.copytree(backup, alpha)
        assert hashlib.sha256(old_db.read_bytes()).hexdigest() == before_hash
        assert release(alpha / executable) == old_version
        run(alpha, 'ensure-running'); stopped.discard(alpha)
        assert data(alpha, 'sql', "SELECT title FROM sources WHERE id = '"+source+"'")['rows'] == [['Upgrade evidence']]
        run(alpha, 'stop'); stopped.add(alpha)
        assert table_rows(old_db, CREW_TABLES + LEGACY_TABLES) == before
        # A fresh current installation never creates legacy knowledge tables or an archive.
        run(beta, 'stop'); stopped.add(beta)
        with closing(sqlite3.connect((beta/'pocketcontext.db').as_uri()+'?mode=ro',uri=True)) as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            assert set(CREW_TABLES).issubset(tables) and not tables.intersection(LEGACY_TABLES)
        assert not (beta/'legacy-knowledge').exists()
        print(f'PASS: Crew {old_version} -> {new_version}; rows/history preserved, legacy archive verified, downgrade refused, restart/restore/rollback verified')
    finally:
        for folder in (alpha, beta):
            if folder not in stopped:
                result = subprocess.run([str(folder / executable), '--db', str(folder / 'pocketcontext.db'), 'stop'], env=env, capture_output=True, timeout=60)
                if result.returncode:
                    raise AssertionError(f'could not stop synthetic project {folder.name}: {result.stderr.decode(errors="replace")}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--previous-binary', type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='pocketcontext-upgrades-') as directory:
        root = Path(directory)
        previous = args.previous_binary.resolve() if args.previous_binary else download_previous(root / 'previous-release')
        rehearse(args.binary.resolve(), previous, root)


if __name__ == '__main__':
    main()
