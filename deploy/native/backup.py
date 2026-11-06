#!/usr/bin/env python3
"""Snapshot a cleanly stopped native Crew project. Run as its dedicated OS user."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import tempfile
import uuid


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def regular_tree(path):
    if path.is_symlink():
        raise ValueError('Symlinks are not permitted in native snapshots')
    mode = path.stat().st_mode
    if stat.S_ISREG(mode):
        return [path]
    if not stat.S_ISDIR(mode):
        raise ValueError('Only regular files and directories may be backed up')
    files = []
    for child in path.iterdir():
        files.extend(regular_tree(child))
    return files


def validate_project(project):
    with sqlite3.connect((project / 'pocketcontext.db').as_uri() + '?mode=ro', uri=True) as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('Snapshot database failed integrity check')
        row = db.execute("SELECT id FROM _collections WHERE name='sources'").fetchone()
        if not row:
            raise ValueError('Snapshot has no sources collection')
        for record, original, checksum in db.execute('SELECT id, original, sha256 FROM sources'):
            parts = (row[0], record, original)
            if any(not p or '/' in p or chr(92) in p or p in ('.', '..') for p in parts):
                raise ValueError('Invalid original file reference')
            path = project / 'storage' / row[0] / record / original
            if not re.fullmatch('[0-9a-f]{64}', checksum) or not path.is_file() or path.is_symlink() or digest(path) != checksum:
                raise ValueError('Original source is missing or corrupt')


def snapshot(project, destination):
    """Caller must hold the service stopped for this whole operation."""
    project, destination = Path(project), Path(destination)
    if not project.is_absolute() or not destination.is_absolute():
        raise ValueError('Use absolute project and backup paths')
    if project.is_symlink() or destination.is_symlink():
        raise ValueError('Project and destination must not be symlinks')
    project, destination = project.resolve(), destination.resolve()
    if project == destination or project in destination.parents or destination in project.parents:
        raise ValueError('Backup destination must be separate from the project')
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    if stat.S_IMODE(destination.stat().st_mode) & 0o077:
        raise ValueError('Backup destination must be private (chmod 700)')
    required = ['pocketcontext.db', 'pocketcontext.json', 'pocketcontext-crew']
    for name in required:
        if not (project / name).is_file() or (project / name).is_symlink():
            raise ValueError('Required project file is absent or not regular: ' + name)
    members = required + (['storage'] if (project / 'storage').exists() else [])
    if (project / 'storage').is_symlink():
        raise ValueError('Storage must not be a symlink')
    for name in members:
        regular_tree(project / name)
    with (destination / '.backup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        staging = Path(tempfile.mkdtemp(prefix='.incomplete-', dir=destination))
        try:
            data = staging / 'project'
            data.mkdir(mode=0o700)
            for name in members:
                source, target = project / name, data / name
                if source.is_dir():
                    shutil.copytree(source, target, symlinks=True)
                else:
                    shutil.copy2(source, target, follow_symlinks=False)
            copied = regular_tree(data)
            validate_project(data)
            hashes = {p.relative_to(data).as_posix(): digest(p) for p in copied}
            for name, checksum in hashes.items():
                if digest(project / name) != checksum:
                    raise ValueError('Project changed during backup')
            manifest = {'format': 1, 'kind': 'crew-native-project', 'sha256': hashes,
                        'excluded': ['machine-local OAuth, certificates, caches and profiles']}
            (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            for file in regular_tree(staging):
                with file.open('rb') as stream:
                    os.fsync(stream.fileno())
            for directory in sorted([staging, *[p for p in staging.rglob('*') if p.is_dir()]], key=lambda p: len(p.parts), reverse=True):
                fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
            name = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8]
            result = destination / name
            staging.rename(result)
            directory_fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            return result
        finally:
            if staging.exists():
                shutil.rmtree(staging)


def verify(snapshot_path):
    root = Path(snapshot_path).resolve()
    regular_tree(root)
    manifest = json.loads((root / 'manifest.json').read_text())
    if manifest.get('format') != 1 or manifest.get('kind') != 'crew-native-project':
        raise ValueError('Unsupported native snapshot manifest')
    actual = {p.relative_to(root / 'project').as_posix(): digest(p)
              for p in regular_tree(root / 'project')}
    if actual != manifest.get('sha256'):
        raise ValueError('Snapshot files do not match their recorded hashes')
    validate_project(root / 'project')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', metavar='SNAPSHOT')
    parser.add_argument('--project')
    parser.add_argument('--destination')
    parser.add_argument('--service')
    args = parser.parse_args()
    os.umask(0o077)
    if args.verify:
        verify(args.verify)
        print('Native snapshot hashes and database verified')
        return
    if not all([args.project, args.destination, args.service]):
        parser.error('backup requires --project, --destination and --service')
    if os.geteuid() == 0:
        raise SystemExit('Run the snapshot helper as the dedicated Crew OS user, not root')
    state = subprocess.run(['systemctl', 'show', args.service, '--property=ActiveState,Result,ExecMainStatus'],
                           check=True, capture_output=True, text=True).stdout
    values = dict(line.split('=', 1) for line in state.splitlines() if '=' in line)
    if values != {'ActiveState': 'inactive', 'Result': 'success', 'ExecMainStatus': '0'}:
        raise SystemExit('Crew must be cleanly stopped before a snapshot; nothing copied')
    result = snapshot(args.project, args.destination)
    print('Verified native project backup: ' + str(result))


if __name__ == '__main__':
    main()
