#!/usr/bin/env python3
"""Synthetic Crew workflow and API-boundary checks; no production data."""
import argparse
import base64
import hashlib
import http.client
import json
from pathlib import Path
import struct
import uuid
import zlib
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from e2e import Project, PASSWORD, IDENTITY


def synthetic_png(width, height):
    """A valid RGB PNG built with the standard library."""
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    raw = b''.join(b'\x00' + b''.join(bytes((x % 256, y % 256, 90)) for x in range(width)) for y in range(height))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def multipart(fields, files):
    boundary = 'crew' + uuid.uuid4().hex
    body = b''
    for name, value in fields.items():
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode() + value.encode() + b'\r\n'
    for name, data in files:
        body += (f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\n'
                 'Content-Type: application/octet-stream\r\n\r\n').encode() + data + b'\r\n'
    return f'multipart/form-data; boundary={boundary}', body + f'--{boundary}--\r\n'.encode()


def raw_http(pc, method, path, body=None, headers=None):
    connection = http.client.HTTPConnection('127.0.0.1', pc.port, timeout=10)
    try:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


def attachment_scenario(pc, headers, write, read):
    """Attach, list and read files over HTTP; upload links; SQL and search."""
    task = write('task.create', {'title': 'Synthetic attachment bug'})
    shot, log = synthetic_png(64, 40), b'synthetic log line\n'
    content_type, body = multipart({'@jsonPayload': json.dumps({'action': 'attachment.add', 'reported_agent': 'Network',
                                                                'data': {'task': task['id']}})},
                                   [('screenshot.png', shot), ('run.log', log)])
    status, _, data = raw_http(pc, 'POST', '/api/crew/write', body, {**headers, 'Content-Type': content_type})
    assert status == 200, (status, data)
    added = json.loads(data)['attachments']
    image, text = added
    assert image['image'] is True and image['width'] == 64 and image['sha256'] == hashlib.sha256(shot).hexdigest(), image
    assert text['image'] is False and text['media_type'] == 'text/plain', text
    assert [a['id'] for a in read('attachments', parent=task['id'])] == [image['id'], text['id']]
    # Bytes need sign-in; non-images download with nosniff.
    assert raw_http(pc, 'GET', '/api/crew/attachment?id=' + image['id'])[0] == 401
    status, got, data = raw_http(pc, 'GET', '/api/crew/attachment?id=' + image['id'], headers=headers)
    assert status == 200 and data == shot and got['Content-Type'] == 'image/png', (status, got)
    status, got, data = raw_http(pc, 'GET', '/api/crew/attachment?id=' + text['id'], headers=headers)
    assert status == 200 and data == log and got['Content-Disposition'].startswith('attachment') and got['X-Content-Type-Options'] == 'nosniff', got
    status, _, data = raw_http(pc, 'POST', '/api/crew/attachment-read', json.dumps({'id': text['id'], 'variant': 'text'}).encode(),
                               {**headers, 'Content-Type': 'application/json'})
    assert status == 200 and json.loads(data)['text'] == log.decode(), (status, data)
    status, _, data = raw_http(pc, 'POST', '/api/crew/attachment-read', json.dumps({'id': image['id'], 'variant': 'card'}).encode(),
                               {**headers, 'Content-Type': 'application/json'})
    assert status == 200 and base64.b64decode(json.loads(data)['content_base64']) == shot, status
    # Work clients attach base64 JSON; task.create resolves placeholders.
    agent = write('attachment.add', {'task': task['id'], 'files': [{'name': 'agent.md', 'content_base64': base64.b64encode(b'# Agent').decode()}]})
    assert agent['attachments'][0]['actor'].startswith('mcp:')
    content_type, body = multipart({'@jsonPayload': json.dumps({'action': 'task.create', 'reported_agent': 'Network',
                                                                'data': {'title': 'Created with a screenshot', 'description': 'Step\n\n![shot](attachment:new-1)'}})},
                                   [('step.png', shot)])
    status, _, data = raw_http(pc, 'POST', '/api/crew/write', body, {**headers, 'Content-Type': content_type})
    created = json.loads(data)
    assert status == 200 and created['description'] == 'Step\n\n![shot](attachment:%s)' % created['attachments'][0]['id'], (status, data)
    write('task.update', {'description': '![foreign](attachment:%s)' % image['id']}, created, expected=400)
    # Comments carry files too: the reader sends them with the comment (multipart,
    # attachment:new-N) or references a file already on the task.
    content_type, body = multipart({'@jsonPayload': json.dumps({'action': 'task.comment', 'reported_agent': 'Network', 'id': task['id'],
                                                                'expected_revision': current_revision(read, task),
                                                                'data': {'body': 'Repro ![now](attachment:new-1)'}})},
                                   [('now.png', shot)])
    status, _, data = raw_http(pc, 'POST', '/api/crew/write', body, {**headers, 'Content-Type': content_type})
    commented = json.loads(data)
    assert status == 200 and len(commented['attachments']) == 1, (status, data)
    comment = [e for e in read('events', parent=task['id']) if e['action'] == 'task.comment'][0]
    assert comment['body'] == 'Repro ![now](attachment:%s)' % commented['attachments'][0]['id'], comment
    write('task.comment', {'body': 'Same as ![before](attachment:%s)' % image['id']}, {'id': task['id'], 'revision': current_revision(read, task)}, agent=False)
    write('task.comment', {'body': '![x](attachment:new-1)'}, {'id': task['id'], 'revision': current_revision(read, task)}, expected=400)
    archived = write('attachment.archive', {}, text)
    assert archived['archived'] and read('attachments', parent=task['id'], archived=True)[0]['id'] == text['id']
    # Upload links: reader only; the token uploads once and reads nothing.
    write('upload_link.create', {'task': task['id']}, expected=403)
    link = write('upload_link.create', {'task': task['id'], 'max_files': 2}, agent=False)
    link_header = {'X-Crew-Upload-Token': link['token']}
    status, _, data = raw_http(pc, 'POST', '/api/crew/upload-link/info', b'{}', {**link_header, 'Content-Type': 'application/json'})
    assert status == 200 and json.loads(data)['title'] == 'Synthetic attachment bug', (status, data)
    # One batch fits a 90 MiB request (under Cloudflare's 100 MB) with 1 MiB of room.
    assert json.loads(data)['max_request_bytes'] == 89 * 1024 * 1024, data
    # Only multipart reaches the upload handler; the body is refused unread.
    assert raw_http(pc, 'POST', '/api/crew/upload-link/upload', b'{}', {**link_header, 'Content-Type': 'application/json'})[0] == 415
    content_type, body = multipart({}, [('phone.png', shot)])
    status, _, data = raw_http(pc, 'POST', '/api/crew/upload-link/upload', body, {**link_header, 'Content-Type': content_type})
    assert status == 200 and json.loads(data)['added'] == 1, (status, data)
    content_type, body = multipart({}, [('again.png', shot)])
    assert raw_http(pc, 'POST', '/api/crew/upload-link/upload', body, {**link_header, 'Content-Type': content_type})[0] == 410
    assert raw_http(pc, 'POST', '/api/crew/read', json.dumps({'collection': 'tasks'}).encode(),
                    {'Content-Type': 'application/json', 'Authorization': link['token']})[0] == 401
    phone = [a for a in read('attachments', parent=task['id']) if a['name'] == 'phone.png']
    assert phone and phone[0]['actor'] == 'upload_link:' + link['id'], phone
    # Metadata only in SQL; names in search.
    rows = request_json(pc, headers, '/api/crew/query', {'sql': "SELECT name, size FROM attachments WHERE parent = '%s' ORDER BY position" % task['id']})['rows']
    assert ['screenshot.png', len(shot)] in rows, rows
    assert raw_http(pc, 'POST', '/api/crew/query', json.dumps({'sql': 'SELECT file FROM attachments'}).encode(), {**headers, 'Content-Type': 'application/json'})[0] == 400
    hits = request_json(pc, headers, '/api/crew/search', {'query': 'screenshot'})['items']
    assert task['id'] in [h['id'] for h in hits], hits
    print('Crew attachments: multipart and base64 add, protected reads, placeholders, upload link, SQL and search passed.')


def current_revision(read, record):
    return [t for t in read('tasks') if t['id'] == record['id']][0]['revision']


def request_json(pc, headers, path, body):
    status, data = pc.http('POST', path, body, headers)
    assert status == 200, (path, status, data)
    return json.loads(data)


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

    # Work clients archive and restore buckets like the reader.
    bucket = write('bucket.update', {'archived': True}, bucket)
    assert bucket['archived'] and bucket['archived_by'].startswith('mcp:')
    bucket = write('bucket.update', {'archived': False}, bucket)
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
    write('bucket.assign', {'agent': network['id'], 'archived': True}, bucket, expected=400)
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
    network = write('agent.update', {'archived': True}, network)
    network = write('agent.update', {'archived': False}, network)
    assert not network['archived']
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
    # A decision the owner delegated, recorded by a work client.
    approved = write('review.decide', {'decision': 'approved', 'note': 'Owner reviewed it and asked me to record approval.'}, review)
    assert approved['draft'] == 'Draft two' and approved['status'] == 'approved'
    assert approved['decided_by'].startswith('mcp:') and approved['reported_agent'] == 'Network' and approved['decided_at']
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
    assert withdrawn['readiness'] == 'waiting' and withdrawn['waiting_reason'] == 'Draft edited', withdrawn
    assert withdrawn['wake_generation'] > reviewed['wake_generation']
    assert current('reviews', rev)['status'] == 'withdrawn'
    ready = write('task.update', {'readiness': 'ready'}, withdrawn)
    assert ready['waiting_reason'] == '', 'Going Ready clears the hold reason'
    held = write('task.update', {'readiness': 'on_hold'}, ready)
    assert held['readiness'] == 'waiting' and held['wake_generation'] == ready['wake_generation'] + 1, held
    ready = write('task.update', {'readiness': 'ready'}, held)
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
    attachment_scenario(pc, headers, write, read)
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
    # The work-client route has the reader's operations except credential entry.
    decided = write('review.decide', {'decision': 'approved'}, review)
    assert decided['status'] == 'approved' and decided['decided_by'].startswith('mcp:'), decided
    bucket = write('bucket.update', {'archived': False}, write('bucket.update', {'archived': True}, bucket))
    agent = write('agent.update', {'archived': False}, write('agent.update', {'archived': True}, agent))
    assert not bucket['archived'] and not agent['archived']
    config = next(c for c in cli('read', {'collection': 'webhook_configs'})['items'] if c['scope'] == 'global')
    assert 'HTTP 403' in write('webhook.credentials.update', {'secret': 'synthetic-never-save'}, config, expect=1)
    write('note.update', {'body': 'Changed by the CLI.'}, note)
    stale = write('note.update', {'body': 'Stale overwrite'}, note, expect=4)
    assert 'another request changed the record first' in stale, stale
    assert 'unknown' in cli('read', {'collection': 'notes', 'unknown': True}, expect=2)
    assert 'not valid JSON' in pc.run('write', '{"action":', expect=2).stderr
    cli_attachment_scenario(pc)
    print('Crew CLI commands, work-client route, credential refusal and conflicts passed.')


def cli_attachment_scenario(pc):
    """attach, write --file and a verified attachment download round trip."""
    files = pc.root / 'cli files'
    files.mkdir()
    shot = synthetic_png(1800, 30)
    (files / 'step 1.png').write_bytes(shot)
    log = ''.join('synthetic line %d \u00e9\n' % i for i in range(300000)).encode()  # several MiB: paged download
    (files / 'run.log').write_bytes(log)
    created = json.loads(pc.run('write', '--file', str(files / 'step 1.png'), '-', stdin=json.dumps(
        {'action': 'task.create', 'reported_agent': 'CLI agent', 'data': {'title': 'CLI screenshot bug', 'description': '![step 1](attachment:new-1)'}})).stdout)
    image = created['attachments'][0]
    assert created['description'] == '![step 1](attachment:%s)' % image['id'] and image['name'] == 'step 1.png', created
    attached = pc.json('attach', str(files / 'run.log'), '--task', created['id'], '--reported-agent', 'CLI agent')
    assert attached['saved'] == 1 and attached['results'][0]['ok'], attached
    log_id = attached['results'][0]['id']
    out = pc.root / 'downloads'
    out.mkdir()
    got = pc.json('attachment', log_id, '--out', str(out / 'copy.log'))
    assert got['verified'] and (out / 'copy.log').read_bytes() == log and got['sha256'] == hashlib.sha256(log).hexdigest(), got
    assert 'already exists' in pc.run('attachment', log_id, '--out', str(out / 'copy.log'), expect=2).stderr
    named = pc.json('attachment', image['id'], '--out', str(out))
    assert Path(named['path']).name == 'step 1.png' and Path(named['path']).read_bytes() == shot, named
    preview = pc.json('attachment', image['id'], '--out', str(out / 'preview.png'), '--variant', 'preview')
    assert not preview['verified'] and (out / 'preview.png').read_bytes()[:8] == b'\x89PNG\r\n\x1a\n', preview
    assert not [p for p in out.iterdir() if p.suffix == '.part']
    commented = json.loads(pc.run('write', '--file', str(files / 'step 1.png'), '-', stdin=json.dumps(
        {'action': 'task.comment', 'reported_agent': 'CLI agent', 'id': created['id'], 'expected_revision': created['revision'],
         'data': {'body': 'Still there: ![again](attachment:new-1)'}})).stdout)
    assert len(commented['attachments']) == 1 and commented['revision'] == created['revision'], commented
    assert 'missing.txt' in pc.run('attach', str(files / 'missing.txt'), '--task', created['id'], '--reported-agent', 'CLI agent', expect=2).stderr
    print('Crew CLI attach, write --file and verified attachment download passed.')


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
