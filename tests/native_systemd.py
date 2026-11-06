#!/usr/bin/env python3
"""Optional disposable real-systemd handover checks; needs noninteractive sudo."""
from pathlib import Path
import pwd
import os
import shutil
import sqlite3
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]

def run(*args, check=True):
    return subprocess.run(args, check=check, text=True, capture_output=True)

def main():
    name = 'crew-native-test-' + uuid.uuid4().hex[:10]
    backup_name = name + '-backup'
    user = pwd.getpwuid(os.getuid()).pw_name
    with tempfile.TemporaryDirectory(prefix=name) as temp:
        root = Path(temp)
        project, dest = root / 'project', root / 'backups'
        project.mkdir()
        dest.mkdir(mode=0o700)
        with sqlite3.connect(project / 'pocketcontext.db') as db:
            db.execute('CREATE TABLE _collections(id TEXT, name TEXT)')
            db.execute("INSERT INTO _collections VALUES('source_id', 'sources')")
            db.execute('CREATE TABLE sources(id TEXT, original TEXT, sha256 TEXT)')
        (project / 'pocketcontext.json').write_text('{}')
        (project / 'pocketcontext-crew').write_text('synthetic service fixture')
        sleeper = root / 'server.py'
        sleeper.write_text('import signal,sys,time\nsignal.signal(signal.SIGTERM, lambda *a:sys.exit(0))\ntime.sleep(3600)\n')
        app_unit = root / (name + '.service')
        app_unit.write_text(f'[Service]\nUser={user}\nExecStart=/usr/bin/python3 {sleeper}\nTimeoutStopSec=20\n')
        b = (ROOT / 'deploy/native/pocketcontext-crew-backup.service').read_text()
        b = b.replace('pocketcontext-crew.service', name + '.service')
        b = b.replace('/run/pocketcontext-crew-backup', '/run/' + backup_name)
        b = b.replace('RuntimeDirectory=pocketcontext-crew-backup', 'RuntimeDirectory=' + backup_name)
        b = b.replace('/usr/local/lib/pocketcontext-crew', str(ROOT / 'deploy/native'))
        b = b.replace('/var/lib/pocketcontext-crew/project', str(project))
        b = b.replace('/var/backups/pocketcontext-crew', str(dest))
        b = b.replace('/var/lib/pocketcontext-crew', str(root))
        b = b.replace('-u pocketcontext-crew', '-u ' + user)
        backup_unit = root / (backup_name + '.service')
        backup_unit.write_text(b)
        try:
            for unit in [app_unit, backup_unit]:
                run('sudo', '-n', 'install', '-m', '644', str(unit), '/run/systemd/system/' + unit.name)
            run('sudo', '-n', 'systemctl', 'daemon-reload')
            run('sudo', '-n', 'systemctl', 'start', name)
            run('sudo', '-n', 'systemctl', 'start', backup_name)
            assert run('systemctl', 'is-active', name).stdout.strip() == 'active'
            snapshots = [p for p in dest.iterdir() if p.is_dir()]
            assert len(snapshots) == 1
            run('python3', str(ROOT / 'deploy/native/backup.py'), '--verify', str(snapshots[0]))
            # A copy failure must fail the job and bring the previously active app back.
            dest.chmod(0o500)
            assert run('sudo', '-n', 'systemctl', 'start', backup_name, check=False).returncode != 0
            assert run('systemctl', 'is-active', name).stdout.strip() == 'active'
            dest.chmod(0o700)
            # A manually stopped app stays stopped when the timer's unit is invoked.
            run('sudo', '-n', 'systemctl', 'stop', name)
            run('sudo', '-n', 'systemctl', 'start', backup_name)
            assert run('systemctl', 'is-active', name, check=False).stdout.strip() == 'inactive'
            assert len([p for p in dest.iterdir() if p.is_dir()]) == 1
            print('Real disposable systemd backup: active stop/copy/restart, copy-failure recovery, inactive skip passed.')
        finally:
            dest.chmod(0o700)
            for unit in [backup_name, name]:
                run('sudo', '-n', 'systemctl', 'stop', unit, check=False)
                run('sudo', '-n', 'rm', '-f', '/run/systemd/system/' + unit + '.service', check=False)
            run('sudo', '-n', 'systemctl', 'daemon-reload', check=False)
            run('sudo', '-n', 'systemctl', 'reset-failed', name, backup_name, check=False)

if __name__ == '__main__':
    main()
