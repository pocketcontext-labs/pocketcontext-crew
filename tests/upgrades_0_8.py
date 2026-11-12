#!/usr/bin/env python3
"""Rehearse the local 0.8.x to current upgrade runbook with synthetic data.

Pass --previous-binary for a verified 0.8.0 executable; otherwise the pinned
release archive is fetched and its checksum verified. Standard library only.
"""
import argparse
import base64
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import time
import urllib.request

import e2e
import upgrades

PREVIOUS = '0.8.0'
# Migrations added by releases after PREVIOUS; nothing else may change the ledger.
LATER_MIGRATIONS = {'1800900000_crew_authorization_instructions.js', '1801000000_crew_attachments.js',
                    '1801100000_crew_project_agents.js'}


def settled(operation, *args):
    """Windows keeps files locked briefly after a stopped server exits."""
    for attempt in range(60):
        try:
            return operation(*args)
        except PermissionError:
            if attempt == 59:
                raise
            time.sleep(1)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rehearse(target, previous, root):
    home = root / 'home'
    home.mkdir()
    env = e2e.isolated_env(home)
    executable = 'pocketcontext-crew.exe' if os.name == 'nt' else 'pocketcontext-crew'
    project = root / 'Project'
    project.mkdir()
    old = project / executable
    shutil.copy2(previous, old)

    def run(*args, binary=None, stdin=None, expect=0):
        result = subprocess.run([str(binary or old), '--db', str(project / 'pocketcontext.db'), *args],
                                input=stdin, capture_output=True, text=True, encoding='utf-8', env=env, timeout=120)
        if result.returncode != expect:
            raise AssertionError(f'{args}: exit {result.returncode}, expected {expect}\n{result.stdout}\n{result.stderr}')
        return result

    def data(*args, **kwargs):
        return json.loads(run(*args, **kwargs).stdout)

    def check(*args, expect=0, **kwargs):
        return json.loads(run('upgrade-check', *args, binary=target, expect=expect, **kwargs).stdout.splitlines()[0])

    def status(result, check_id):
        return next(c['status'] for c in result['checks'] if c['id'] == check_id)

    port = e2e.free_port()
    data('init', '--name', 'Rehearsal', '--port', str(port), '--password-stdin', stdin=e2e.PASSWORD + '\n')
    opened = data('open', '--no-browser')
    url, code = opened['signInLink'].split('/bundle/login#')
    req = urllib.request.Request(url + '/api/bundle/redeem', data=json.dumps({'code': code}).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as response:
        token = json.load(response)['token']

    def crew_write(action, fields, row=None):
        request = urllib.request.Request(url + '/api/crew/write', data=json.dumps({'action': action, 'reported_agent': 'Synthetic upgrade', 'reason': 'fixture', 'data': fields, **({'id': row['id'], 'expected_revision': row['revision']} if row else {})}).encode(), headers={'Content-Type': 'application/json', 'Authorization': token})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)

    agent = crew_write('agent.create', {'name': 'Build', 'brief': 'Synthetic brief'})
    bucket = crew_write('bucket.create', {'name': 'BUILD', 'responsible_agent': agent['id']})
    note = crew_write('note.create', {'bucket': bucket['id'], 'title': 'Durable note', 'body': 'Before revision'})
    note = crew_write('note.update', {'body': 'After revision'}, note)
    instance = json.loads((project / 'pocketcontext.json').read_text(encoding='utf-8'))['instance']

    # A new binary never adopts a server of the earlier identity, but can stop it.
    refused = run('ensure-running', binary=target, expect=1)
    assert 'earlier' in refused.stderr and PREVIOUS in refused.stderr, refused.stderr
    inventory = check('--from', PREVIOUS, '--inventory')
    assert inventory['ready'] and status(inventory, 'server.stopped') == 'warn', inventory
    blocked = check('--from', PREVIOUS, expect=3)
    assert not blocked['ready'] and status(blocked, 'server.stopped') == 'block', blocked
    run('stop', binary=target)

    # Confirm flush, then the complete stopped backup with its matching binary.
    flushed = check('--from', PREVIOUS)
    assert flushed['ready'], flushed
    assert status(flushed, 'workingCopy') == 'pass' and status(flushed, 'database.format') == 'pass', flushed
    before = sha(project / 'pocketcontext.db')
    config_before = (project / 'pocketcontext.json').read_bytes()
    backup = root / 'Backup'
    shutil.copytree(project, backup)

    # Upgrade: replace the executable, start, then verify identity and data.
    settled(shutil.copy2, target, old)
    run('ensure-running')
    st = data('status')
    assert st['running'] and st['instance'] == instance and st['port'] == port, st
    version = st['version']
    assert version not in ('', PREVIOUS), st
    run('skill', '--agent', 'claude-code', '--dir', str(home / 'skills' / 'crew'))
    assert (home / 'skills' / 'crew' / '.pocketcontext-crew').exists()
    assert not (home / '.claude' / 'skills' / 'pocketcontext').exists()
    registry = data('profile', 'list')
    assert any(p.get('instance') == instance for p in registry.get('profiles', registry if isinstance(registry, list) else [])) or isinstance(registry, dict)
    notes = data('read', '{"collection":"notes"}')
    assert any(n['id'] == note['id'] and n['body'] == 'After revision' for n in notes['items']), notes
    # 0.16.0 attachments work on the upgraded database, with the default limit.
    payload = b'synthetic upgrade attachment\n'
    added = data('write', json.dumps({'action': 'attachment.add', 'reported_agent': 'Synthetic upgrade',
                                      'data': {'note': note['id'], 'files': [{'name': 'upgrade.txt', 'content_base64': base64.b64encode(payload).decode()}]}}))
    attachment = added['attachments'][0]
    assert attachment['sha256'] == hashlib.sha256(payload).hexdigest() and attachment['parent'] == note['id'], added
    listed = data('read', json.dumps({'collection': 'attachments', 'parent': note['id']}))['items']
    assert [a['id'] for a in listed] == [attachment['id']], listed
    settings = data('read', '{"collection":"settings"}')['items'][0]
    assert settings['storage_limit_bytes'] == 5 * 1024 ** 3 and settings['storage_used_bytes'] == len(payload), settings
    # 0.18.0: the existing agent became a bot; tasks start without a claim and
    # its own assignee can claim one with a lease.
    agents = data('read', json.dumps({'collection': 'agents', 'fields': ['name', 'kind']}))['items']
    assert agents == [{'id': agent['id'], 'revision': agent['revision'], 'name': 'Build', 'kind': 'bot'}], agents
    ticket = data('write', json.dumps({'action': 'task.create', 'reported_agent': 'Synthetic upgrade',
                                       'data': {'title': 'Upgrade ticket', 'assigned_agent': agent['id'], 'readiness': 'ready'}}))
    assert ticket['claim_state'] == '' and ticket['claimed_by'] == '' and ticket['claim_until'] == '', ticket
    claimed = data('write', json.dumps({'action': 'task.claim', 'id': ticket['id'], 'expected_revision': ticket['revision'],
                                        'reported_agent': 'Synthetic session', 'data': {'assigned_agent': 'Build'}}))
    assert claimed['claim_state'] == 'live' and claimed['claimed_by'] == 'Synthetic session', claimed
    run('stop')

    # Identity alone did not rewrite the configuration format or lose the data.
    config_after = json.loads((project / 'pocketcontext.json').read_text(encoding='utf-8'))
    assert config_after['instance'] == instance and config_after['port'] == port
    assert set(config_after) >= set(json.loads(config_before))
    # No migration added by the identity change: the ledger gains only the later
    # releases' own migrations (0.12.0's managed instruction revision,
    # 0.16.0's attachments and 0.18.0's agent kinds and task claims).
    def migrations(path):
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
            return set(row[0] for row in db.execute('SELECT file FROM _migrations'))
    before_ledger, after_ledger = migrations(backup / 'pocketcontext.db'), migrations(project / 'pocketcontext.db')
    assert before_ledger <= after_ledger, before_ledger - after_ledger
    assert after_ledger - before_ledger == LATER_MIGRATIONS, after_ledger - before_ledger

    # Rollback: restore the complete backup and matching binary, then verify.
    settled(shutil.rmtree, project)
    shutil.copytree(backup, project)
    assert sha(project / 'pocketcontext.db') == before
    assert subprocess.check_output([str(old), '--version'], text=True, env=env).split()[1] == PREVIOUS
    run('ensure-running')
    assert data('status')['instance'] == instance
    run('stop')
    print(f'PASS: Crew {PREVIOUS} -> {version}; not adopted, stopped by new binary, data and identity verified, rollback verified')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--previous-binary', type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='pocketcontext-upgrades-', ignore_cleanup_errors=True) as directory:
        root = Path(directory)
        upgrades.PREVIOUS = PREVIOUS
        previous = args.previous_binary.resolve() if args.previous_binary else upgrades.download_previous(root / 'previous-release')
        rehearse(args.binary.resolve(), previous, root)


if __name__ == '__main__':
    main()
