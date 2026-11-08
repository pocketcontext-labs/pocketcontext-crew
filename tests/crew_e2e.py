#!/usr/bin/env python3
"""Synthetic Crew workflow and API-boundary checks; no production data."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from e2e import Project, PASSWORD, IDENTITY


def scenario(pc):
    pc.json('init', '--port', str(pc.port), '--password-stdin', stdin=PASSWORD + '\n')
    pc.json('open', '--no-browser')
    status, body = pc.http('POST', '/api/collections/users/auth-with-password', {'identity': IDENTITY, 'password': PASSWORD})
    assert status == 200, (status, body)
    headers = {'Authorization': json.loads(body)['token']}

    def request(path, body, expected=200):
        status, data = pc.http('POST', path, body, headers)
        assert status == expected, (path, body, status, data)
        return json.loads(data)

    def write(action, data=None, record=None, agent=True, expected=200, key=None):
        body = {'action': action, 'data': data or {}, 'reported_agent': 'Network', 'reason': 'Synthetic workflow'}
        if key:
            body['idempotency_key'] = key
        if record:
            body.update(id=record['id'], expected_revision=record['revision'])
        return request('/api/crew/agent-write' if agent else '/api/crew/write', body, expected)

    def read(collection, **kwargs):
        return request('/api/crew/read', {'collection': collection, **kwargs})['items']

    def current(collection, record, archived=False):
        rows = read(collection, id=record['id'], archived=archived)
        assert len(rows) == 1, (collection, record['id'], rows)
        return rows[0]

    for path in ['/api/crew/read', '/api/crew/write', '/api/crew/agent-write']:
        assert pc.http('POST', path, {'collection': 'notes'})[0] in (401, 403), path

    assert pc.http('POST', '/api/context/query', {'sql': 'SELECT id FROM crew_notes'}, headers)[0] >= 400
    request('/api/crew/agent-write', {'action': 'agent.create', 'data': {'name': 'Forged'}, 'actor': 'owner:forged'}, 400)

    network = write('agent.create', {'name': 'Network', 'brief': 'Maintain NETWORK; propose changes elsewhere.'})
    design = write('agent.create', {'name': 'Design'})
    bucket = write('bucket.create', {'name': 'NETWORK', 'purpose': 'Voice and audience', 'responsible_agent': network['id']})
    note = write('note.create', {'bucket': bucket['id'], 'title': 'Launch voice', 'body': 'Write for independent founders.', 'links': []})
    first = read('note_revisions', parent=note['id'])[0]
    assert first['body'] == note['body'] and first['revision'] == 1
    assert first['reported_agent'] == 'Network' and first['actor'].startswith('mcp:')
    assert read('notes', query='independent')[0]['id'] == note['id']
    edited = write('note.update', {'body': 'Use concrete examples.'}, note)
    write('note.update', {'body': 'Stale overwrite'}, note, expected=409)
    restored = write('note.restore', {'revision_id': first['id']}, edited)
    assert restored['body'] == note['body'] and restored['revision'] == 3
    assert len(read('note_revisions', parent=note['id'])) == 3
    linked = write('note.create', {'bucket': bucket['id'], 'title': 'Audience', 'body': 'Founders', 'links': [note['id']]})
    other = read('note_revisions', parent=linked['id'])[0]
    linked = write('note.restore', {'revision_id': other['id']}, linked)
    assert linked['links'] == [note['id']]
    write('note.restore', {'revision_id': other['id']}, restored, expected=400)
    archived = write('note.update', {'archived': True}, restored)
    assert not read('notes', id=note['id'])
    assert read('notes', id=note['id'], archived=True)[0]['archived_at']
    assert current('notes', linked)['links'] == [note['id']]
    unarchived = write('note.restore', {'revision_id': first['id']}, archived)
    assert not unarchived['archived_at'] and current('notes', note)['id'] == note['id']

    write('bucket.update', {'archived': True}, bucket, expected=403)
    # Assignment is metadata, with the same concurrency/audit contract on both paths.
    assert current('buckets', bucket)['responsible_agent_details'] == {'id': network['id'], 'name': 'Network'}
    prior = bucket
    bucket = write('bucket.assign', {'agent': 'Design'}, bucket)
    assert bucket['responsible_agent'] == design['id'] and bucket['revision'] == prior['revision'] + 1
    assert read('buckets', responsible_agent='Design')[0]['id'] == bucket['id']
    assert read('buckets', responsible_agent=design['id'])[0]['id'] == bucket['id']
    write('bucket.assign', {'agent': network['id']}, prior, expected=409)
    count = len(read('events', parent=bucket['id']))
    for invalid in ['Missing agent', 'a' * 15, 3, [], {}]:
        write('bucket.assign', {'agent': invalid}, bucket, expected=400)
    write('bucket.assign', {}, bucket, expected=400)
    write('bucket.assign.extra', {'agent': network['id']}, bucket, expected=400)
    write('bucket.assign', {'agent': network['id'], 'archived': True}, bucket, expected=403)
    write('bucket.assign', {'agent': network['id'], 'unexpected': True}, bucket, expected=400)
    write('note.assign', {'agent': network['id']}, note, expected=400)
    assert len(read('events', parent=bucket['id'])) == count
    write('agent.create', {'name': 'Duplicate'})
    duplicate = write('agent.create', {'name': 'Duplicate'})
    write('agent.create', {'name': network['id']})
    write('bucket.assign', {'agent': 'Duplicate'}, bucket, expected=400)
    duplicate = write('agent.update', {'archived': True}, duplicate, agent=False)
    write('bucket.assign', {'agent': duplicate['id']}, bucket, expected=400)
    write('bucket.assign', {'agent': 'Duplicate'}, bucket, expected=400)
    bucket = write('bucket.update', {'responsible_agent': None}, bucket)
    assert bucket['responsible_agent'] == '' and bucket['responsible_agent_details'] is None
    assert read('buckets', responsible_agent='')[0]['id'] == bucket['id']
    bucket = write('bucket.update', {'responsible_agent': 'Network'}, bucket)
    bucket = write('bucket.assign', {'agent': ''}, bucket)
    bucket = write('bucket.assign', {'agent': network['id']}, bucket)
    assert bucket['responsible_agent'] == network['id'], 'IDs must take precedence over exact names'
    bucket = write('bucket.assign', {'agent': None}, bucket)
    bucket = write('bucket.update', {'responsible_agent': design['id']}, bucket)
    assignment_events = read('events', parent=bucket['id'])
    assert any(e['action'] == 'bucket.assign' and e['changes']['responsible_agent'] == {'old': network['id'], 'new': design['id']} for e in assignment_events)
    assert any(e['action'] == 'bucket.update' and e['changes']['responsible_agent'] == {'old': design['id'], 'new': ''} for e in assignment_events)
    assert all(e['reported_agent'] == 'Network' and e['reason'] == 'Synthetic workflow' and e['actor'].startswith('mcp:') for e in assignment_events)
    # Reported Network can still write to a bucket assigned to Design.
    shared = write('note.create', {'bucket': bucket['id'], 'title': 'Shared writes', 'body': 'Still allowed'})
    shared = write('note.update', {'body': 'Changed by another reported agent'}, shared)
    write('note.update', {'archived': True}, shared)
    bucket = write('bucket.update', {'archived': True}, bucket, agent=False)
    assert not read('notes') and len(read('notes', archived=True)) == 3
    write('note.update', {'body': 'Blocked by ancestor archive'}, unarchived, expected=400)
    write('note.create', {'bucket': bucket['id'], 'title': 'Blocked'}, expected=400)
    bucket = write('bucket.update', {'archived': False}, bucket, agent=False)
    assert len(read('notes')) == 2
    write('agent.update', {'archived': True}, network, expected=403)
    historical = write('task.create', {'title': 'Existing assignment', 'assigned_agent': design['id']})
    design = write('agent.update', {'archived': True}, design, agent=False)
    # An unchanged historical assignment stays editable, but cannot be newly assigned.
    bucket = write('bucket.update', {'purpose': 'Updated purpose', 'responsible_agent': design['id']}, bucket)
    bucket = write('bucket.assign', {'agent': design['id']}, bucket)
    bucket = write('bucket.assign', {'agent': None}, bucket)
    write('bucket.assign', {'agent': design['id']}, bucket, expected=400)
    bucket = write('bucket.assign', {'agent': network['id']}, bucket)
    historical = current('tasks', historical)  # Deactivation invalidates old wake generations.
    historical = write('task.update', {'title': 'Still editable', 'assigned_agent': design['id']}, historical)
    long_note = write('note.create', {'bucket': bucket['id'], 'title': 'Long synthetic note', 'body': 'x' * 90000, 'links': []})
    assert len(long_note['body']) == 90000
    write('note.update', {'archived': True}, long_note)
    write('task.create', {'title': 'Inactive assignee', 'assigned_agent': design['id']}, expected=400)

    task = write('task.create', {'title': 'Launch post', 'description': 'Draft from the brief', 'labels': ['Network'], 'links': [note['id']]})
    assert task['status'] == 'todo' and task['created_by_agent'] == 'Network'
    for label in ['Human', 'human', 'HUMAN']:
        write('task.update', {'labels': [label]}, task, expected=400)
    # Two callers with the same read cannot both claim the task.
    payload = {'action': 'task.claim', 'id': task['id'], 'expected_revision': task['revision'], 'reported_agent': 'Network', 'data': {'assigned_agent': network['id']}}
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: pc.http('POST', '/api/crew/agent-write', payload, headers)[0], range(2)))
    assert sorted(outcomes) == [200, 409], outcomes
    task = current('tasks', task)
    assert task['assigned_agent'] == network['id'] and task['status'] == 'in_progress'
    write('task.comment', {'body': 'Research complete.'}, task)
    assert any(e['action'] == 'task.comment' and e['body'] == 'Research complete.' for e in read('events', parent=task['id']))
    task = write('task.update', {'draft': 'Draft one'}, task)
    review = write('review.request', record=task)
    assert review['draft'] == 'Draft one' and review['status'] == 'pending'
    task = current('tasks', task)
    assert task['status'] == 'needs_review'
    write('review.decide', {'decision': 'approved'}, review, expected=403)
    write('task.update', {'status': 'done'}, task, expected=400)
    write('task.update', {'status': 'todo'}, task, expected=400)
    write('task.update', {'draft': 'Attempted review bypass', 'status': 'done'}, task, expected=400)
    assert current('tasks', task)['draft'] == 'Draft one'
    assert current('reviews', review)['status'] == 'pending'
    write('review.request', record=task, expected=409)
    task = write('task.update', {'draft': 'Draft two'}, task)
    assert current('reviews', review)['status'] == 'withdrawn'
    write('review.decide', {'decision': 'approved'}, current('reviews', review), agent=False, expected=400)
    review = write('review.request', record=task)
    approved = write('review.decide', {'decision': 'approved', 'note': 'Ready for me to publish.'}, review, agent=False)
    assert approved['draft'] == 'Draft two' and approved['status'] == 'approved'
    assert approved['decided_by'].startswith('owner:') and approved['decided_at']
    assert current('tasks', task)['status'] != 'done', 'Approval must not complete external action'
    write('review.decide', {'decision': 'rejected'}, approved, agent=False, expected=400)
    task = current('tasks', task)
    task = write('task.update', {'status': 'done'}, task)
    assert task['status'] == 'done'

    # Archive closes a pending review and restoring does not revive it.
    task = write('task.update', {'draft': 'Draft three', 'status': 'in_progress'}, task)
    pending = write('review.request', record=task)
    task = write('task.update', {'archived': True}, current('tasks', task))
    assert not read('tasks', id=task['id'])
    assert current('reviews', pending)['status'] == 'withdrawn'
    task = write('task.update', {'archived': False}, task)
    assert current('reviews', pending)['status'] == 'withdrawn'
    assert current('reviews', approved)['status'] == 'approved'

    # Shared-MCP webhook setup is idempotent and redacts credentials. Keep the
    # synthetic receiver disabled: this test must make no outbound requests.
    build = write('agent.ensure', {'name': 'Webhook synthetic', 'brief': 'Test only'}, key='setup-agent')
    assert write('agent.ensure', {'name': 'Webhook synthetic', 'brief': 'Test only'}, key='setup-agent') == build
    write('agent.ensure', {'name': 'Different'}, key='setup-agent', expected=409)
    reused = write('agent.ensure', {'name': 'Webhook synthetic'}, key='reuse-agent')
    assert reused['id'] == build['id']
    secret = 'synthetic-webhook-secret-not-a-real-credential'
    config = next(c for c in read('webhook_configs') if c['scope'] == 'global')
    assert not config['enabled'] and not config['secret_configured']
    write('webhook.create', {'agent': build['id']}, key='legacy', expected=400)
    config = write('webhook.integration.update', {'agent': build['id']}, config)
    credential_data = {'url': 'https://93.184.216.34/crew-test', 'secret': secret}
    write('webhook.credentials.update', credential_data, config, expected=403)
    original = config
    config = write('webhook.credentials.update', credential_data, original, agent=False, key='manual-credentials')
    assert write('webhook.credentials.update', credential_data, original, agent=False, key='manual-credentials') == config
    write('webhook.credentials.update', credential_data, original, key='manual-credentials', expected=403)
    assert config['enabled'] is False and config['secret_configured'] is True and 'url' not in config
    for collection in ['webhook_configs', 'webhook_deliveries', 'webhook_attempts', 'webhook_routing']:
        output = json.dumps(read(collection))
        assert secret not in output and 'secret_ciphertext' not in output and '/crew-test' not in output, collection
    assert secret not in json.dumps(read('events', parent=config['id']))
    request('/api/crew/read', {'collection': 'webhook_idempotency'}, expected=400)
    for url in ['http://example.com', 'https://127.0.0.1/', 'https://[::1]/',
                'https://169.254.169.254/', 'https://user:password@example.com/',
                'https://10.0.0.1/', 'https://[::ffff:127.0.0.1]/']:
        write('webhook.credentials.update', {'url': url}, config, agent=False, expected=400)
    write('webhook.enable', {}, config, expected=400)
    mapping = request('/api/crew/agent-write', {'action':'webhook.mapping.update','expected_revision':0,'data':{'agent':build['id'],'bot_ref':'synthetic-grok-build'}})
    config = current('webhook_configs',config)
    write('webhook.enable', {}, config, expected=400)
    write('webhook.instructions.sync', {'instruction_revision':config['instruction_revision'],'status':'verified','routine_ref':'synthetic-routine','instructions':'wrong'},config,expected=409)
    changed = write('webhook.instructions.sync', {'instruction_revision':config['instruction_revision'],'status':'reported','routine_ref':'synthetic-routine'},config)
    assert changed['sync_status'] == 'reported' and not changed['enabled']
    changed = write('webhook.integration.update', {'subscriptions':['ready']},changed)
    write('webhook.integration.update', {'subscriptions':['assigned']},config,expected=409)
    changed = write('webhook.credentials.update', {'url':'https://93.184.216.34/new-path'},changed,agent=False)
    assert not changed['secret_configured'], 'New URL cannot inherit old receiver credential'
    changed = write('webhook.credentials.update', {'secret':'synthetic-replacement'},changed,agent=False)
    changed = write('webhook.credentials.update', {'clear_secret':True},changed,agent=False)
    assert not changed['secret_configured']
    write('webhook.enable', {}, changed, expected=400)
    changed = write('webhook.integration.update', {'instructions':changed['instructions'].replace('<!-- crew-dispatch:end -->', 'Stop on unknown inputs.\n<!-- crew-dispatch:end -->')},changed)
    assert changed['sync_status'] == 'unverified' and not changed['enabled']
    assert not read('webhook_deliveries'), 'Saving configuration must not send'

    # Readiness/generation invalidates already delivered wakes independently of
    # configuration. Each task mutation increments its revision only once.
    waiting = write('task.create', {'title': 'Waiting webhook work', 'assigned_agent': build['id']})
    assert waiting['readiness'] == 'waiting' and waiting['wake_generation'] == 0
    ready = write('task.update', {'readiness': 'ready'}, waiting)
    assert ready['wake_generation'] == 1 and ready['revision'] == waiting['revision'] + 1
    edited = write('task.update', {'description': 'Ordinary edit'}, ready)
    assert edited['wake_generation'] == ready['wake_generation']
    blocked = write('task.update', {'readiness': 'waiting', 'waiting_reason': 'Needs input'}, edited)
    assert blocked['wake_generation'] == edited['wake_generation'] + 1
    ready = write('task.update', {'readiness': 'ready', 'draft': 'Synthetic draft'}, blocked)
    rev = write('review.request', record=ready)
    reviewed = current('tasks', ready)
    assert reviewed['wake_generation'] == ready['wake_generation'] + 1
    withdrawn = write('task.update', {'draft': 'Changed draft'}, reviewed)
    assert withdrawn['readiness'] == 'waiting'
    assert withdrawn['wake_generation'] > reviewed['wake_generation']
    assert current('reviews', rev)['status'] == 'withdrawn'
    ready = write('task.update', {'readiness': 'ready'}, withdrawn)
    done = write('task.update', {'status': 'done'}, ready)
    assert done['wake_generation'] == ready['wake_generation'] + 1
    reopened = write('task.update', {'status': 'todo'}, done)
    assert reopened['wake_generation'] == done['wake_generation'] + 1
    archived_task = write('task.update', {'archived': True}, reopened)
    assert archived_task['wake_generation'] == reopened['wake_generation'] + 1
    routing = read('webhook_routing')[0]
    assert routing['epoch'] and routing['instance_id']
    old_epoch = routing['epoch']

    # Generic REST and batch cannot create decisions or modify immutable history.
    for collection, record in [('crew_notes', note), ('crew_note_revisions', first), ('crew_reviews', approved), ('crew_events', read('events', parent=task['id'])[0])]:
        base = '/api/collections/' + collection + '/records'
        for method, path, data in [('POST', base, {'draft': 'Forged', 'status': 'approved'}), ('PATCH', base + '/' + record['id'], {'body': 'Forged', 'status': 'approved'}), ('DELETE', base + '/' + record['id'], None)]:
            status, _ = pc.http(method, path, data, headers)
            assert status in (400, 403, 404), (collection, method, status)
        status, _ = pc.http('POST', '/api/batch', {'requests': [{'method': 'PATCH', 'url': base + '/' + record['id'], 'body': {'status': 'approved', 'body': 'Forged'}}]}, headers)
        assert status >= 400, (collection, 'batch', status)
    assert current('reviews', pending)['status'] == 'withdrawn'
    assert current('notes', note)['body'] == 'Write for independent founders.'
    pc.json('stop')
    pc.json('ensure-running')
    pc.json('open', '--no-browser')
    assert current('reviews', approved)['status'] == 'approved'
    assert len(read('note_revisions', parent=note['id'])) == 5
    assert read('webhook_routing')[0]['epoch'] == old_epoch, 'Ordinary restart preserves delivery epoch'
    assert current('webhook_configs', changed)['secret_configured'] is False
    print('Crew end-to-end workflow, conflicts, archive/restore and authorization checks passed.')


def cli_scenario(pc):
    """The agent CLI commands against the running synthetic project (local key)."""
    def cli(command, payload=None, stdin=None, expect=0):
        args = [command] if payload is None else [command, json.dumps(payload)]
        if stdin is not None:
            args = [command, '-']
            stdin = json.dumps(stdin)
        result = pc.run(*args, stdin=stdin, expect=expect)
        return json.loads(result.stdout) if expect == 0 else result.stderr

    def write(action, data, record=None, expect=0, **extra):
        body = {'action': action, 'reported_agent': 'CLI agent', 'reason': 'Synthetic CLI workflow', 'data': data, **extra}
        if record:
            body.update(id=record['id'], expected_revision=record['revision'])
        return cli('write', body, expect=expect)

    agent = write('agent.create', {'name': 'CLI agent', 'brief': 'Synthetic CLI checks'})
    bucket = write('bucket.create', {'name': 'CLI', 'responsible_agent': agent['id']})
    note = cli('write', stdin={'action': 'note.create', 'reported_agent': 'CLI agent',
                               'data': {'bucket': bucket['id'], 'title': 'Semaphore towers', 'body': 'Optical telegraph relay notes.'}})
    task = write('task.create', {'title': 'Survey semaphore towers', 'assigned_agent': agent['id'], 'draft': 'Synthetic CLI draft', 'readiness': 'ready'})
    hits = cli('search', {'query': 'semaphore', 'collections': ['notes']})['items']
    assert [h['id'] for h in hits] == [note['id']], hits
    rows = cli('read', {'collection': 'tasks', 'assigned_agent': agent['id'], 'fields': ['title']})['items']
    assert rows == [{'id': task['id'], 'revision': task['revision'], 'title': 'Survey semaphore towers'}], rows
    assert 'tasks' in json.dumps(cli('schema'))
    counted = cli('query', {'sql': "SELECT count(*) FROM tasks WHERE archived = 0 AND assigned_agent = '%s'" % agent['id']})
    assert counted['rows'] == [[1]], counted
    review = write('review.request', {}, task)
    assert review['status'] == 'pending' and review['draft'] == 'Synthetic CLI draft'
    assert 'HTTP 403' in write('review.decide', {'decision': 'approved'}, review, expect=1)
    assert 'HTTP 403' in write('bucket.update', {'archived': True}, bucket, expect=1)
    assert 'HTTP 403' in write('agent.update', {'archived': True}, agent, expect=1)
    assert cli('read', {'collection': 'reviews', 'id': review['id']})['items'][0]['status'] == 'pending'
    write('note.update', {'body': 'Changed by the CLI.'}, note)
    stale = write('note.update', {'body': 'Stale overwrite'}, note, expect=4)
    assert 'another request changed the record first' in stale, stale
    assert 'unknown' in cli('read', {'collection': 'notes', 'unknown': True}, expect=2)
    assert 'not valid JSON' in pc.run('write', '{"action":', expect=2).stderr
    print('Crew CLI commands, agent-route refusals and conflicts passed.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True, type=Path)
    binary = parser.parse_args().binary.resolve()
    with tempfile.TemporaryDirectory(prefix='crew-e2e-') as temp:
        pc = Project(binary, Path(temp))
        try:
            scenario(pc)
            cli_scenario(pc)
        finally:
            subprocess.run([str(binary), '--db', str(pc.db), 'stop'], env=pc.env, capture_output=True, timeout=60)


if __name__ == '__main__':
    main()
