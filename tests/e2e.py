#!/usr/bin/env python3
"""End-to-end test of the pocketcontext binary with synthetic notes.

Runs on Linux, macOS and Windows with the standard library only. Every run uses
a temporary project folder, home and cache, and a free loopback port.
"""
import argparse
from contextlib import closing
import hashlib
import http.server
import json
import os
from pathlib import Path
import socket
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

PASSWORD = 'synthetic test password'
# The sign-in name of every project's one account (bundle.LocalIdentity).
IDENTITY = 'me@pocketcontext.localhost'
# Schema migrations of releases before the single-user schema.
EARLIER_MIGRATIONS = ['1790300000_users.js', '1790300100_knowledge.js', '1791500000_spaces.js', '1792700100_space_management.js']
# The retired product name, assembled from parts so this file never contains it.
RETIRED = 'wi' + 'ki'
# Inherited variables of this program and of its predecessor must not leak into the test.
SCRUBBED_PREFIXES = ('POCKETCONTEXT_', RETIRED.upper() + 'CONTEXT_')


def isolated_env(home):
    """The inherited environment with a private home and cache and no product variables."""
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith(SCRUBBED_PREFIXES)}
    env.update(HOME=str(home), USERPROFILE=str(home), XDG_CACHE_HOME=str(home / 'cache'), XDG_CONFIG_HOME=str(home / 'config'),
               APPDATA=str(home / 'AppData' / 'Roaming'),
               LOCALAPPDATA=str(home / 'AppData' / 'Local'))
    return env


def user_cache(home):
    """os.UserCacheDir() for the isolated environment."""
    if sys.platform == 'win32':
        return home / 'AppData' / 'Local'
    if sys.platform == 'darwin':
        return home / 'Library' / 'Caches'
    return home / 'cache'


def retired_names(root):
    """Every file or directory below root (project, homes, caches, skills) named after the retired product."""
    return [str(path) for path in root.rglob('*') if RETIRED in path.name.lower()]


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class Project:
    def __init__(self, binary, root):
        self.binary, self.root = binary, root
        self.project = root / 'Cloud Drive' / 'PocketContext'
        self.project.mkdir(parents=True)
        self.db = self.project / 'pocketcontext.db'
        self.home = root / 'home'
        self.home.mkdir()
        self.env = isolated_env(self.home)
        self.port = free_port()
        self.url = f'http://127.0.0.1:{self.port}'

    def run(self, *args, stdin=None, expect=0):
        result = subprocess.run([str(self.binary), '--db', str(self.db), *args], input=stdin, capture_output=True,
                                text=True, encoding='utf-8', env=self.env, timeout=120)
        if result.returncode != expect:
            raise AssertionError(f'{args}: exit {result.returncode}, expected {expect}\n{result.stdout}\n{result.stderr}')
        return result

    def json(self, *args, **kwargs):
        return json.loads(self.run(*args, **kwargs).stdout)

    def http(self, method, path, body=None, headers=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.url + path, data=data, method=method,
                                         headers={'Content-Type': 'application/json', **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()


class Remote:
    """Another computer: its own home and cache, an empty working folder and no project."""

    def __init__(self, binary, root, url):
        self.binary, self.root, self.url = binary, root, url
        self.home = root / 'home'
        self.work = root / 'work'
        self.home.mkdir(parents=True)
        self.work.mkdir()
        self.env = isolated_env(self.home)

    def run(self, *args, stdin=None, expect=0, url=None, env=None):
        flags = [] if url is False else ['--url', url or self.url]
        result = subprocess.run([str(self.binary), *args, *flags], input='' if stdin is None else stdin,
                                capture_output=True, text=True, encoding='utf-8', env={**self.env, **(env or {})},
                                cwd=self.work, timeout=120)
        if expect is not None and result.returncode != expect:
            raise AssertionError(f'remote {args}: exit {result.returncode}, expected {expect}\n{result.stdout}\n{result.stderr}')
        return result

    def json(self, *args, **kwargs):
        return json.loads(self.run(*args, **kwargs).stdout)

    def session(self):
        sessions = [p for p in self.root.rglob('session.json') if p.parent.name.startswith('remote-')
                    and p.parent.parent == user_cache(self.home) / 'pocketcontext']
        if len(sessions) != 1:
            raise AssertionError(f'expected one remote session, found {sessions}')
        return sessions[0]


class Forward:
    """A loopback TCP forward from a different local port, like a tunnel on the wrong port."""

    def __init__(self, target):
        self.target = target
        self.listener = socket.socket()
        self.listener.bind(('127.0.0.1', 0))
        self.listener.listen(16)
        self.listener.settimeout(0.2)
        self.port = self.listener.getsockname()[1]
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        with self.listener:
            while not self.stopped.is_set():
                try:
                    client, _ = self.listener.accept()
                except socket.timeout:
                    continue
                except OSError:
                    return
                self.connect(client)

    def connect(self, client):
        client.settimeout(None)
        try:
            upstream = socket.create_connection(('127.0.0.1', self.target), timeout=10)
            upstream.settimeout(None)
        except OSError:
            client.close()
            return
        for src, dst in ((client, upstream), (upstream, client)):
            threading.Thread(target=self.pipe, args=(src, dst), daemon=True).start()

    @staticmethod
    def pipe(src, dst):
        try:
            while True:
                data = src.recv(65536)
                if not data:
                    break
                dst.sendall(data)
        except OSError:
            pass
        finally:
            for sock in (src, dst):
                try:
                    sock.close()
                except OSError:
                    pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.stopped.set()
        self.thread.join(timeout=5)


def http_status(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def listening(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=2):
            return True
    except OSError:
        return False


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print('ok -', message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True, type=Path)
    binary = parser.parse_args().binary.resolve()
    with tempfile.TemporaryDirectory(prefix='crew-e2e-') as temp:
        pc = Project(binary, Path(temp))
        try:
            scenario(pc)
            remote = Remote(binary, Path(temp) / 'other-computer', pc.url)
            remote_scenario(pc, remote)
            tunnel_scenario(pc, remote)
            codes_scenario(pc, remote)
            pc.json('stop')
            restored_default_scenario(pc)
            empty_database_scenario(binary, Path(temp) / 'empty')
            headless_collision_scenario(binary, Path(temp) / 'occupied-port')
            earlier_release_scenario(binary, Path(temp) / 'earlier')
        finally:
            subprocess.run([str(binary), '--db', str(pc.db), 'stop'], env=pc.env, capture_output=True, timeout=60)
    print('all Crew lifecycle end-to-end checks passed')


def token(pc):
    status, body = pc.http('POST', '/api/collections/users/auth-with-password', {'identity': IDENTITY, 'password': PASSWORD})
    assert status == 200, body
    return {'Authorization': json.loads(body)['token']}


def crew(pc, collection):
    status, body = pc.http('POST', '/api/crew/read', {'collection': collection}, token(pc))
    assert status == 200, body
    return json.loads(body)['items']


def scenario(pc):
    help_text = pc.run('help').stdout
    check('PocketContext Crew' in help_text and '--space' not in help_text, 'help describes Crew without spaces')
    for command in ('spaces', 'schema', 'query', 'create', 'batch', 'ingest', 'extract', 'stage', 'publish', 'page'):
        check('unknown command' in pc.run(command, expect=2).stderr, f'{command} is retired')
    check(pc.run('help', 'serve').stdout == pc.run('serve', '--help').stdout, 'command help agrees')
    saved_env = pc.env
    pc.env = {**saved_env, 'SSH_CONNECTION': 'synthetic-ssh-session'}
    try:
        skipped = pc.json('open')
        check(skipped['readerSkipped'] and 'signInLink' not in skipped and not pc.db.exists(), 'SSH reader setup does not create a database')
    finally:
        pc.env = saved_env
    init = pc.json('init', '--name', 'synthetic', '--port', str(pc.port), '--password-stdin', stdin=PASSWORD + '\n')
    check(init['accountCreated'] and init['url'] == pc.url and 'space' not in init, 'init creates a space-free Crew account')
    me = pc.json('whoami')
    check(me['name'] == 'synthetic' and me['signedIn'] and 'space' not in me, 'whoami describes the Crew instance')
    transport = pc.json('status')
    check(transport['headless'] and not transport['tcp'] and transport['socket'], 'local administration works without TCP')
    pc.json('open', '--no-browser')
    check(pc.json('status')['tcp'], 'open enables the reader')
    check(pc.http('GET', '/')[0] == 200, 'reader is served')
    check(pc.http('GET', '/api/bundle/instance', headers={'Host': f'attacker.example:{pc.port}'})[0] == 403, 'foreign Host is refused')
    for headers in (None, {'Authorization': 'forged'}):
        check(pc.http('POST', '/api/crew/read', {'collection': 'agents'}, headers)[0] == 401, 'Crew reads require authentication')
    check(pc.http('POST', '/api/bundle/token')[0] == 403, 'local tokens require the private key')
    auth = token(pc)
    check(pc.http('GET', '/api/collections/users/records', headers=auth)[0] == 403, 'owner account cannot be listed')
    for path in ('/api/context/query', '/api/context/search', '/api/spaces/default', '/api/pocketcontext/runs/aaaaaaaaaaaaaaa/check'):
        check(pc.http('POST' if path.endswith(('query','search')) else 'GET', path, {'sql':'SELECT 1'}, auth)[0] in (404,410), f'{path} is retired')
    status, body = pc.http('POST', '/api/crew/write', {'action':'bucket.create','data':{'name':'Lifecycle'}}, auth)
    check(status == 200, 'owner creates a bucket')
    bucket = json.loads(body)
    status, body = pc.http('POST', '/api/crew/write', {'action':'note.create','data':{'bucket':bucket['id'],'title':'Persistence','body':'Synthetic durable note ✓'}}, auth)
    check(status == 200, 'owner creates a note')
    note = json.loads(body)
    check(pc.http('PATCH', '/api/collections/crew_notes/records/' + note['id'], {'body':'Raw write'}, auth)[0] in (400,403), 'raw writes remain disabled')
    pc.json('stop')
    pc.json('ensure-running')
    pc.json('open', '--no-browser')
    check(crew(pc, 'notes')[0]['body'] == 'Synthetic durable note ✓', 'notes survive stop and restart')
    pc.json('stop')
    pc.db.with_name('pocketcontext.db.lease').write_text(json.dumps({'host':'other-laptop','pid':1,'heartbeat':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}))
    check('other-laptop' in pc.run('ensure-running', expect=1).stderr, 'foreign active lease prevents a second writer')
    pc.json('ensure-running', '--take-over')
    pc.json('open', '--no-browser')


def restored_default_scenario(pc):
    """A stopped complete backup retains Crew data and account credentials."""
    restored = Project(pc.binary, pc.root / 'restored')
    shutil.copy2(pc.db, restored.db)
    shutil.copy2(pc.project / 'pocketcontext.json', restored.project / 'pocketcontext.json')
    if (pc.project / 'storage').exists():
        shutil.copytree(pc.project / 'storage', restored.project / 'storage')
    try:
        result = restored.json('init', '--port', str(restored.port))
        check(not result['accountCreated'] and 'space' not in result, 'restore retains the account without spaces')
        restored.json('open', '--no-browser')
        check(crew(restored, 'notes')[0]['body'] == 'Synthetic durable note ✓', 'restored Crew notes retain their contents')
        check(restored.http('POST', '/api/collections/users/auth-with-password', {'identity':IDENTITY,'password':PASSWORD})[0] == 200, 'restored password works')
    finally:
        restored.run('stop')


def empty_database_scenario(binary, root):
    empty = Project(binary, root)
    with closing(sqlite3.connect(empty.db)) as db:
        db.execute('PRAGMA user_version=0')
    try:
        result = empty.json('init', '--port', str(empty.port), '--password-stdin', stdin=PASSWORD + '\n')
        empty.json('open', '--no-browser')
        check(result['accountCreated'] and crew(empty, 'buckets') == [], 'empty SQLite initializes as Crew')
    finally:
        empty.run('stop')


def headless_collision_scenario(binary, root):
    """Headless startup ignores unrelated TCP; failed serve never changes config."""
    class OtherService(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(404)
            self.end_headers()
        def log_message(self, *_):
            pass
    service = http.server.ThreadingHTTPServer(('127.0.0.1', 0), OtherService)
    worker = threading.Thread(target=service.serve_forever, daemon=True)
    worker.start()
    pc = Project(binary, root)
    pc.port = service.server_port
    pc.url = f'http://127.0.0.1:{pc.port}'
    try:
        pc.json('init', '--port', str(pc.port), '--password-stdin', stdin=PASSWORD + '\n')
        state = pc.json('status')
        check(state['running'] and state['headless'] and not state['tcp'], 'init works headless while an unrelated program owns the TCP port')
        pc.run('open', '--no-browser', expect=1)
        check(pc.json('status')['running'], 'failed reader activation leaves the headless server running')
        config = pc.project / 'pocketcontext.json'
        before = config.read_bytes()
        pc.run('serve', '--port', str(free_port()), expect=1)
        check(config.read_bytes() == before, 'serve --port against a running server leaves synced configuration unchanged')
        check(pc.json('whoami')['signedIn'], 'failed serve --port leaves local client access working')
        pc.json('stop')
        pc.json('ensure-running')
        check(pc.json('status')['headless'], 'ensure-running restarts headless while the TCP port stays occupied')
        pc.json('stop')
        lease = pc.db.with_name('pocketcontext.db.lease')
        lease.write_text(json.dumps({'host': 'other-laptop', 'pid': 1, 'heartbeat': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}))
        before = config.read_bytes()
        pc.run('serve', '--port', str(free_port()), expect=1)
        check(config.read_bytes() == before, 'serve --port refused by another computer lease leaves synced configuration unchanged')
        lease.unlink()
        pc.json('ensure-running')
    finally:
        pc.run('stop')
        service.shutdown()
        service.server_close()
        worker.join(timeout=5)


def earlier_release_scenario(binary, root):
    """A database created by an earlier release is refused and never changed."""
    earlier = Project(binary, root)
    with closing(sqlite3.connect(earlier.db)) as db:
        db.execute('CREATE TABLE _migrations (file TEXT PRIMARY KEY NOT NULL, applied INTEGER NOT NULL)')
        db.executemany('INSERT INTO _migrations VALUES (?, ?)', [('1640988000_init.go', 1)] + [(m, 2) for m in EARLIER_MIGRATIONS])
        db.execute('CREATE TABLE spaces (id TEXT PRIMARY KEY, kind TEXT, name TEXT)')
        db.execute("INSERT INTO spaces VALUES ('companyspace001', 'group', 'Company')")
        db.execute('CREATE TABLE space_members (id TEXT PRIMARY KEY, space TEXT, account TEXT, role TEXT)')
        db.commit()
    before = hashlib.sha256(earlier.db.read_bytes()).hexdigest()
    refused = earlier.run('init', '--port', str(earlier.port), '--password-stdin', stdin=PASSWORD + '\n', expect=1)
    check('earlier PocketContext release' in refused.stderr and 'does not open databases from earlier releases' in refused.stderr,
          f'init refuses a database from an earlier release with a clear message: {refused.stderr.strip()}')
    again = earlier.run('ensure-running', expect=1)
    check('earlier PocketContext release' in again.stderr, 'starting the server refuses it too')
    check(not earlier.json('status')['running'], 'no server runs for a refused database')
    check(hashlib.sha256(earlier.db.read_bytes()).hexdigest() == before, 'the refused database file is unchanged')
    leftovers = sorted(p.name for p in earlier.project.iterdir() if p.name.startswith('pocketcontext.db') and p.name != 'pocketcontext.db')
    check(not leftovers, f'no conflict copy, snapshot or lease is left beside a refused database: {leftovers}')


def remote_scenario(pc, r):
    instance = json.loads((pc.project / 'pocketcontext.json').read_text(encoding='utf-8'))['instance']
    local = pc.json('whoami')
    missing = r.run('whoami', expect=2)
    check('pocketcontext login' in missing.stderr, 'remote data commands require login')
    status = r.json('status')
    check(status['url'] == pc.url and status['reachable'] and not status['loggedIn'], 'remote status reports reachable and logged out')
    r.run('login', '--password-stdin', stdin='wrong password\n', expect=1)
    login = r.json('login', '--password-stdin', stdin=PASSWORD + '\n')
    check(login == {'url': pc.url, 'instance': instance, 'signedIn': True}, 'remote login with the project password reports the instance')
    session = r.session()
    check(session.parent.name == 'remote-' + hashlib.sha256(pc.url.encode()).hexdigest()[:16], 'the session is keyed by the URL')
    if os.name != 'nt':
        check(session.stat().st_mode & 0o777 == 0o600, 'the remote session is private')
    status = r.json('status')
    check(status['loggedIn'] and status['instance'] == instance and 'email' not in status, 'remote status reports the session')
    env_status = r.json('status', url=False, env={'POCKETCONTEXT_URL': pc.url})
    check(env_status['url'] == pc.url and env_status['loggedIn'], 'POCKETCONTEXT_URL selects remote mode')

    me = r.json('whoami')
    check(me['instance'] == local['instance'] and me['url'] == pc.url and 'db' not in me and me['signedIn'],
          'remote whoami reports the same instance without a database or space')
    check('space' not in me, 'remote identity has no space')

    for args in (['stop'], ['ensure-running'], ['flush'], ['recover'], ['init'], ['password', '--password-stdin'], ['login-code']):
        refused = r.run(*args, expect=2)
        check('not available with --url' in refused.stderr, f'{args[0]} is refused in remote mode')
    check(pc.json('status')['running'], 'the server keeps running after refused remote commands')
    check(r.run('whoami', '--db', str(pc.db), expect=None).returncode == 2, '--url with --db is refused')
    for url in ('http://example.com:8096', 'http://10.0.0.1:8096'):
        check(r.run('status', url=url, expect=None).returncode == 2, f'non-loopback URL {url} is refused')

    with Forward(pc.port) as forward:
        via = f'http://127.0.0.1:{forward.port}'
        check(http_status(via + '/api/bundle/instance') == 403, 'a forward on a different port fails the Host check')
        check(not r.json('status', url=via)['reachable'], 'remote status through a wrong-port forward is not reachable')
        check(r.run('whoami', url=via, expect=None).returncode == 1, 'remote whoami through a wrong-port forward fails')
        login = r.run('login', '--password-stdin', stdin=PASSWORD + '\n', url=via, expect=None)
        check(login.returncode == 1, 'remote login through a wrong-port forward fails')

    closed = free_port()
    unreachable = r.run('whoami', url=f'http://127.0.0.1:{closed}', expect=1)
    check('not reachable' in unreachable.stderr, 'an unreachable server is reported')
    check(not listening(closed), 'remote mode never starts a server')

    original = session.read_text(encoding='utf-8')
    forged = json.loads(original)
    forged['instance'] = 'f' * len(instance)
    session.write_text(json.dumps(forged), encoding='utf-8')
    other = r.run('whoami', expect=1)
    check('different' in other.stderr and 'sign in again' in other.stderr, 'a session for another instance is refused')
    session.write_text(original, encoding='utf-8')
    check(r.json('whoami')['instance'] == instance, 'the restored session works again')

    skills = r.root / 'skill'
    r.json('skill', '--dir', str(skills))
    text = (skills / 'SKILL.md').read_text(encoding='utf-8')
    check(pc.url in text and '--url' in text and '--db' not in text and 'ensure-running' not in text,
          'the remote skill names the URL and no local lifecycle')
    opened = r.json('open', '--no-browser')
    check(opened['url'] == pc.url and opened['signInLink'].startswith(pc.url + '/bundle/login#')
          and not opened['browserLaunchRequested'], 'remote open supplies a browser sign-in link without launching a browser')
    reader_code = opened['signInLink'].split('#', 1)[1]
    status, body = pc.http('POST', '/api/bundle/redeem', {'code': reader_code})
    check(status == 200 and json.loads(body)['record']['email'] == IDENTITY,
          'the remote reader handoff signs in the project account')
    status, _ = pc.http('POST', '/api/bundle/redeem', {'code': reader_code})
    check(status == 401, 'the remote reader handoff is single-use')
    check(r.json('whoami')['instance'] == instance, 'reader sign-in preserves the remote CLI session')
    check(reader_code not in session.read_text(encoding='utf-8'), 'the browser handoff code is not saved in the CLI session')

    check(r.json('logout') == {'url': pc.url, 'loggedOut': True}, 'remote logout ends the session')
    r.run('whoami', expect=2)
    r.run('open', '--no-browser', expect=2)
    check(not r.json('status')['loggedIn'], 'after logout the remote is logged out')

    leftovers = [p for p in r.root.rglob('*') if p.name in ('pocketcontext.db', 'pocketcontext.json', 'local.key') or p.suffix in ('.db', '.lease')]
    check(not leftovers, f'remote mode creates no database, project or key: {leftovers}')
    check(not list(r.work.iterdir()), 'remote mode writes nothing to the working folder')
    r.env.pop('POCKETCONTEXT_SPACE', None)


def tunnel_scenario(pc, r):
    """Offline checks of `tunnel`: its help and every refusal that comes before any network access."""
    help_text = r.run('tunnel', '--help', url=False).stdout
    check('tunnel serve' in help_text and 'tunnel forward' in help_text and '--address-stdin' in help_text, 'tunnel --help documents both sides')
    check('tunnel serve' in r.run('help', url=False).stdout, 'the overview lists the tunnel')
    for args, url in ((['tunnel', 'serve'], None), (['tunnel', 'forward', '--address-stdin', '--db', str(pc.db)], False),
                      (['tunnel', 'forward', '--address-stdin', '--new-address'], None), (['tunnel'], False), (['tunnel', 'open'], False)):
        r.run(*args, url=url, stdin='tcSyntheticButInvalid\n', expect=2)
    for text in ('tcSyntheticButInvalidSecret', 'not-an-address'):
        refused = r.run('tunnel', 'forward', '--address-stdin', stdin=text + '\n', expect=2)
        check('not a valid tailcat address' in refused.stderr and text not in refused.stderr + refused.stdout,
              'an invalid tunnel address is refused without being echoed')
    refused = r.run('tunnel', 'forward', 'tcSyntheticButInvalidSecret', url=False, expect=2)
    check('tcSyntheticButInvalidSecret' not in refused.stderr, 'an invalid address argument is not echoed')
    missing = r.run('tunnel', 'serve', '--db', str(r.work / 'none.db'), url=False, expect=2)
    check('no PocketContext database' in missing.stderr and not (r.work / 'none.db').exists(), 'tunnel serve never creates a database')
    check(not list(user_cache(r.home).rglob('tunnel.json')), 'refused tunnel commands keep no tunnel identity')


def codes_scenario(pc, r):
    """One-time sign-in codes for the project's account."""
    # Started first so the 30-second expiry overlaps the other checks.
    expiring = pc.json('login-code', '--ttl', '30')
    expiring_at = time.monotonic()
    check(expiring['code'] and expiring['expires'] and 'email' not in expiring,
          'login-code accepts the minimum lifetime of 30 seconds')

    issued = pc.json('login-code')
    check(issued['code'] and issued['expires'], 'login-code issues a code')
    instance = json.loads((pc.project / 'pocketcontext.json').read_text(encoding='utf-8'))['instance']
    login = r.json('login', '--code-stdin', stdin=issued['code'] + '\n')
    check(login == {'url': pc.url, 'instance': instance, 'signedIn': True}, 'remote login redeems a code')
    me = r.json('whoami')
    check(me['instance'] == pc.json('whoami')['instance'], 'the code signs in the same Crew instance')
    r.json('logout')
    reused = r.run('login', '--code-stdin', stdin=issued['code'] + '\n', expect=1)
    check('used or expired' in reused.stderr, 'a redeemed code cannot be reused')
    unknown = r.run('login', '--code-stdin', stdin='synthetic-unknown-code\n', expect=1)
    check('used or expired' in unknown.stderr, 'an unknown code is refused')
    check(not r.json('status')['loggedIn'], 'a refused code leaves the remote logged out')

    log = Path(pc.json('status')['log'])
    if log.exists():
        check(issued['code'] not in log.read_text(encoding='utf-8', errors='replace'), 'the server log does not contain the code')

    for ttl in ('10', '601'):
        pc.run('login-code', '--ttl', ttl, expect=2)
        check(True, f'login-code refuses --ttl {ttl}')

    opened = pc.json('open', '--no-browser')
    check(opened['signInLink'].startswith(pc.url + '/bundle/login#'), 'open --no-browser prints a sign-in link')
    code = opened['signInLink'].split('#', 1)[1]
    status, body = pc.http('POST', '/api/bundle/redeem', {'code': code})
    check(status == 200 and json.loads(body)['record']['email'] == IDENTITY, 'the open link signs in the project account')
    status, _ = pc.http('POST', '/api/bundle/redeem', {'code': code})
    check(status == 401, 'the open link is single-use')

    refused = r.run('login-code', expect=2)
    check('not available with --url' in refused.stderr, 'login-code is refused in remote mode')
    r.run('login', '--code-stdin', '--password-stdin', stdin=issued['code'] + '\n', expect=2)
    check(True, 'login refuses --code-stdin with --password-stdin')

    remaining = 31 - (time.monotonic() - expiring_at)
    if remaining > 0:
        time.sleep(remaining)
    expired = r.run('login', '--code-stdin', stdin=expiring['code'] + '\n', expect=1)
    check('used or expired' in expired.stderr, 'an expired code is refused')
    check(not r.json('status')['loggedIn'], 'an expired code leaves the remote logged out')


if __name__ == '__main__':
    try:
        main()
    except AssertionError as error:
        print('FAIL -', error)
        sys.exit(1)
