#!/usr/bin/env python3
"""Real-binary native snapshot and restored Crew history rehearsal, synthetic only."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
from e2e import Project, PASSWORD, IDENTITY
from crew_e2e import scenario

spec = importlib.util.spec_from_file_location('native_backup', Path(__file__).resolve().parents[1] / 'deploy/native/backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True, type=Path)
    binary = parser.parse_args().binary.resolve()
    with tempfile.TemporaryDirectory(prefix='crew-native-') as temp:
        root = Path(temp)
        original = Project(binary, root / 'original')
        restored = None
        try:
            scenario(original)
            evidence = root / 'synthetic-original.txt'
            evidence.write_text('Native backup synthetic original.\n')
            original.json('ingest', str(evidence), '--title', 'Native backup synthetic evidence')
            original.json('stop')
            shutil.copy2(binary, original.project / 'pocketcontext-crew')
            result = backup.snapshot(original.project, root / 'backups')
            backup.verify(result)
            with sqlite3.connect(original.db.as_uri() + '?mode=ro', uri=True) as db:
                expected = {table: db.execute('SELECT count(*) FROM ' + table).fetchone()[0]
                            for table in ['crew_notes', 'crew_note_revisions', 'crew_tasks', 'crew_reviews', 'crew_events']}
            restored = Project(binary, root / 'restored')
            restored.project.rmdir()
            shutil.copytree(result / 'project', restored.project)
            restored.binary = restored.project / 'pocketcontext-crew'
            restored.json('ensure-running')
            restored.json('open', '--no-browser')
            # Saved port is part of the restored project configuration.
            restored.port = original.port
            restored.url = original.url
            status, body = restored.http('POST', '/api/collections/users/auth-with-password', {'identity': IDENTITY, 'password': PASSWORD})
            assert status == 200
            headers = {'Authorization': json.loads(body)['token']}
            for table, count in expected.items():
                collection = table.removeprefix('crew_')
                if collection in ('note_revisions', 'events'):
                    continue
                status, body = restored.http('POST', '/api/crew/read', {'collection': collection, 'archived': True}, headers)
                assert status == 200
            restored.json('stop')
            with sqlite3.connect(restored.db.as_uri() + '?mode=ro', uri=True) as db:
                for table, count in expected.items():
                    assert db.execute('SELECT count(*) FROM ' + table).fetchone()[0] == count
            print('Native real-binary Crew workflow, stopped snapshot, hashes, fresh-cache restore, password login and immutable history passed. Public TLS/systemd/MCP client not exercised.')
        finally:
            for pc in [original, restored]:
                if pc is not None:
                    subprocess.run([str(pc.binary), '--db', str(pc.db), 'stop'], env=pc.env, capture_output=True, timeout=60)

if __name__ == '__main__':
    main()
