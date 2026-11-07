#!/usr/bin/env python3
"""Rehearse public Compose templates with synthetic settings, no public DNS/email."""
import argparse
import http.client
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', help='Override the Crew image to validate a local release candidate')
    args = parser.parse_args()
    name = 'crew-compose-test-' + uuid.uuid4().hex[:10]
    with tempfile.TemporaryDirectory(prefix=name) as temp:
        folder = Path(temp)
        for path in (ROOT / 'deploy/compose').iterdir():
            if path.is_file():
                shutil.copy(path, folder / path.name)
        (folder / '.env').write_text('CREW_DOMAIN=synthetic.example.test\n')
        fixture = (folder / 'crew.env.example').read_text().replace('owner@example.com', 'owner@example.test')
        fixture = fixture.replace('https://REPLACE_WITH_S3_ENDPOINT', 'https://backup.example.invalid')
        (folder / 'crew.env').write_text(fixture)
        base = ['docker', 'compose', '-p', name, '-f', str(folder / 'compose.yaml')]
        if args.image:
            (folder / 'candidate.yaml').write_text('services:\n  crew:\n    image: ' + json.dumps(args.image) + '\n')
            base += ['-f', str(folder / 'candidate.yaml')]
        init = base + ['-f', str(folder / 'compose.init.yaml')]
        def run(command, check=True, input=None):
            result = subprocess.run(command, cwd=folder, text=True, capture_output=True, input=input)
            if check and result.returncode:
                raise AssertionError('Synthetic command failed: ' + ' '.join(command[:5]) + '\n' + result.stderr)
            return result
        def request(path, body=None, authenticated=False):
            # Credentials stay inside this synthetic container. Use the same
            # private local-key exchange as the runtime; exercise public HTTP
            # with an owner token and never print that token or its local key.
            code = """import glob,http.client,json,pathlib,socket,sys
args=json.load(sys.stdin)
headers={'Host':'synthetic.example.test','Content-Type':'application/json'}
if args['authenticated']:
 path=glob.glob('/storage/private/cache/pocketcontext/*/local.key')[0]
 key=pathlib.Path(path).read_text()
 sock=socket.socket(socket.AF_UNIX);sock.connect(str(pathlib.Path(path).with_name('server.sock')))
 c=http.client.HTTPConnection('pocketcontext.internal');c.sock=sock
 c.request('POST','/api/bundle/token','{}',{'Host':'pocketcontext.internal','X-PocketContext-Local-Key':key,'Content-Type':'application/json'})
 r=c.getresponse();assert r.status==200
 headers['Authorization']='Bearer '+json.loads(r.read())['token'];c.close()
c=http.client.HTTPConnection('127.0.0.1',timeout=10)
c.request('GET' if args['body'] is None else 'POST',args['path'],None if args['body'] is None else json.dumps(args['body']),headers)
r=c.getresponse();print(json.dumps([r.status,r.read().decode()]));c.close()
"""
            status, text = json.loads(run(base + ['exec', '-T', 'crew', 'python3', '-c', code], input=json.dumps({'path': path, 'body': body, 'authenticated': authenticated})).stdout)
            try:
                result = json.loads(text)
            except json.JSONDecodeError:
                result = text
            return status, result
        def write(action, data):
            status, row = request('/api/crew/write', {'action': action, 'data': data}, True)
            assert status == 200, (status, row)
            return row
        def verify_note(note):
            status, result = request('/api/crew/read', {'collection': 'notes', 'id': note['id']}, True)
            assert status == 200 and len(result['items']) == 1, (status, result)
            assert result['items'][0]['body'] == 'Synthetic Compose memory.'
        try:
            run(base + ['config', '--quiet'])
            run(base + ['run', '--rm', '--no-deps', 'caddy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile'])
            run(init + ['up', '-d', '--wait', '--wait-timeout', '120', 'crew'])
            assert request('/up')[0] == 200
            assert request('/api/bundle/auth-mode') == (200, {'mode': 'email'})
            assert request('/api/crew/read', {'collection': 'notes'})[0] in (401, 403)
            assert request('/api/context/schema', authenticated=True)[0] == 404
            assert request('/mcp')[0] in (401, 403)
            assert request('/.well-known/oauth-authorization-server')[0] == 200
            bucket = write('bucket.create', {'name': 'COMPOSE'})
            note = write('note.create', {'bucket': bucket['id'], 'title': 'Compose persistence', 'body': 'Synthetic Compose memory.'})
            run(init + ['stop', 'crew'])
            cid = run(base + ['ps', '-a', '-q', 'crew']).stdout.strip()
            assert run(['docker', 'inspect', '--format', '{{.State.ExitCode}}', cid]).stdout.strip() == '0'
            run(base + ['up', '-d', '--wait', '--wait-timeout', '120', 'crew'])
            verify_note(note)
            cid = run(base + ['ps', '-q', 'crew']).stdout.strip()
            state = json.loads(run(['docker', 'inspect', '--format', '{{json .HostConfig.PortBindings}}', cid]).stdout)
            assert not state, state
            run(base + ['restart', 'crew'])
            run(base + ['up', '-d', '--wait', '--wait-timeout', '120', 'crew'])
            verify_note(note)
            # Use the shipped proxy directive with synthetic HTTP (no public ACME).
            caddyfile = (folder / 'Caddyfile').read_text().replace('{$CREW_DOMAIN}', 'http://{$CREW_DOMAIN}')
            (folder / 'Caddyfile').write_text(caddyfile)
            (folder / 'proxy-test.yaml').write_text('services:\n  caddy:\n    ports: !override\n      - "127.0.0.1::80"\n')
            proxy = base + ['-f', str(folder / 'proxy-test.yaml')]
            run(proxy + ['up', '-d', '--wait', '--wait-timeout', '120'])
            port = int(run(proxy + ['port', 'caddy', '80']).stdout.strip().rsplit(':', 1)[1])
            for path, expected in [('/api/bundle/auth-mode', 200), ('/mcp', 401)]:
                conn = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
                conn.request('GET', path, headers={'Host': 'synthetic.example.test'})
                response = conn.getresponse()
                assert response.status == expected, response.status
                body = response.read()
                if expected == 200:
                    assert b'email' in body
                conn.close()
            print('Compose template init, clean handover, private backend, auth, MCP discovery, persistence and restart passed; Caddy config and actual HTTP proxy Host/auth routing passed. Public TLS/email not exercised.')
        finally:
            # Only this script's random, synthetic project is removed.
            run(base + ['down', '-v'], check=False)

if __name__ == '__main__':
    main()
