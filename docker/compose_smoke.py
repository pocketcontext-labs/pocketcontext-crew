#!/usr/bin/env python3
"""Rehearse public Compose templates with synthetic settings, no public DNS/email."""
import http.client
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]

def main():
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
        init = base + ['-f', str(folder / 'compose.init.yaml')]
        def run(command, check=True):
            result = subprocess.run(command, cwd=folder, text=True, capture_output=True)
            if check and result.returncode:
                raise AssertionError('Synthetic command failed: ' + ' '.join(command[:5]) + '\n' + result.stderr)
            return result
        def request(path):
            code = "import urllib.request,urllib.error; r=urllib.request.Request('http://127.0.0.1" + path + "', headers={'Host':'synthetic.example.test'});\ntry:\n s=urllib.request.urlopen(r); print(s.status); print(s.read().decode())\nexcept urllib.error.HTTPError as e: print(e.code)"
            return run(base + ['exec', '-T', 'crew', 'python3', '-c', code]).stdout
        try:
            run(base + ['config', '--quiet'])
            run(base + ['run', '--rm', '--no-deps', 'caddy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile'])
            run(init + ['up', '-d', '--wait', '--wait-timeout', '120', 'crew'])
            assert '200' in request('/up')
            assert 'email' in request('/api/bundle/auth-mode')
            assert request('/api/context/schema').strip() in ('401', '403')
            assert request('/mcp').strip() in ('401', '403')
            assert '200' in request('/.well-known/oauth-authorization-server')
            run(base + ['exec', '-T', 'crew', 'sh', '-c', 'printf "Synthetic Compose evidence.\\n" > /tmp/compose-note.txt'])
            run(base + ['exec', '-T', 'crew', 'pocketcontext', 'ingest', '/tmp/compose-note.txt', '--title', 'Compose persistence'])
            run(init + ['stop', 'crew'])
            cid = run(base + ['ps', '-a', '-q', 'crew']).stdout.strip()
            assert run(['docker', 'inspect', '--format', '{{.State.ExitCode}}', cid]).stdout.strip() == '0'
            run(base + ['up', '-d', '--wait', '--wait-timeout', '120', 'crew'])
            assert 'Compose persistence' in run(base + ['exec', '-T', 'crew', 'pocketcontext', 'sql', 'SELECT title FROM sources']).stdout
            cid = run(base + ['ps', '-q', 'crew']).stdout.strip()
            state = json.loads(run(['docker', 'inspect', '--format', '{{json .HostConfig.PortBindings}}', cid]).stdout)
            assert not state, state
            run(base + ['restart', 'crew'])
            run(base + ['up', '-d', '--wait', '--wait-timeout', '120', 'crew'])
            assert 'Compose persistence' in run(base + ['exec', '-T', 'crew', 'pocketcontext', 'sql', 'SELECT title FROM sources']).stdout
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
