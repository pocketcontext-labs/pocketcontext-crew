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


def validate_archive_anchor(db_path, project):
    with sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True) as db:
        exists = db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='_crew_legacy_archive'").fetchone()[0]
        if not exists:
            return
        anchors = db.execute("SELECT id, archive, manifest_sha256 FROM _crew_legacy_archive").fetchall()
        if len(anchors) != 1 or anchors[0][0] != 1:
            raise ValueError("Invalid legacy archive anchor")
        _, archive, manifest_hash = anchors[0]
        if not re.fullmatch(r"[0-9a-f]{64}", archive) or not re.fullmatch(r"[0-9a-f]{64}", manifest_hash):
            raise ValueError("Invalid legacy archive anchor hashes")
        root = project / "legacy-knowledge"
        if root.is_symlink() or not root.is_dir():
            raise ValueError("Required legacy archive is missing")
        pointer = root / "current.json"
        if pointer.is_symlink() or json.loads(pointer.read_text()).get("archive") != archive:
            raise ValueError("Required legacy archive pointer does not match")
        manifest = root / archive / "manifest.json"
        if manifest.is_symlink() or not manifest.is_file() or digest(manifest) != manifest_hash:
            raise ValueError("Required legacy archive manifest does not match")


def validate_legacy_archives(project):
    root = project / "legacy-knowledge"
    if not root.exists():
        return
    if root.is_symlink():
        raise ValueError("Legacy archive root must not be a symlink")
    current = json.loads((root / "current.json").read_text()).get("archive", "")
    if not re.fullmatch(r"[0-9a-f]{64}", current) or not (root / current).is_dir():
        raise ValueError("Legacy archive pointer is invalid")
    for archive in root.iterdir():
        if archive.name == "current.json":
            continue
        if archive.is_symlink() or not archive.is_dir() or not re.fullmatch(r"[0-9a-f]{64}", archive.name):
            raise ValueError("Unexpected legacy archive entry")
        manifest = json.loads((archive / "manifest.json").read_text())
        files = manifest.get("files", {})
        if manifest.get("format") != 1 or not files.get("pocketcontext.db") or not files.get("pocketcontext.json"):
            raise ValueError("Invalid legacy archive manifest")
        actual = {}
        for directory, dirs, names in os.walk(archive, followlinks=False):
            for name in dirs:
                if (Path(directory) / name).is_symlink():
                    raise ValueError("Symlink in legacy archive")
            for name in names:
                path = Path(directory) / name
                if path.is_symlink() or not path.is_file():
                    raise ValueError("Non-regular legacy archive file")
                if path != archive / "manifest.json":
                    actual[path.relative_to(archive).as_posix()] = digest(path)
        if actual != files or files["pocketcontext.db"] != archive.name:
            raise ValueError("Legacy archive hashes do not match")
        with sqlite3.connect((archive / "pocketcontext.db").as_uri() + "?mode=ro", uri=True) as db:
            if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise ValueError("Legacy archive database is corrupt")


def validate_project(project):
    validate_archive_anchor(project / "pocketcontext.db", project)
    validate_legacy_archives(project)
    with sqlite3.connect((project / 'pocketcontext.db').as_uri() + '?mode=ro', uri=True) as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('Snapshot database failed integrity check')
        row = db.execute("SELECT id FROM _collections WHERE name='sources'").fetchone()
        if not row:
            required = {'crew_agents', 'crew_buckets', 'crew_notes', 'crew_note_revisions', 'crew_tasks', 'crew_events', 'crew_reviews'}
            present = {r[0] for r in db.execute('SELECT name FROM _collections')}
            if not required.issubset(present):
                raise ValueError('Snapshot is missing Crew collections')
            return
        for record, original, checksum in db.execute('SELECT id, original, sha256 FROM sources'):
            parts = (row[0], record, original)
            if any(not p or '/' in p or chr(92) in p or p in ('.', '..') for p in parts):
                raise ValueError('Invalid original file reference')
            path = project / 'storage' / row[0] / record / original
            if not re.fullmatch('[0-9a-f]{64}', checksum) or not path.is_file() or path.is_symlink() or digest(path) != checksum:
                raise ValueError('Original source is missing or corrupt')


def webhook_key_path(project):
    # Matches Go Resolve on native Linux; this helper is Linux/systemd only.
    database = str(Path(project).resolve() / 'pocketcontext.db')
    identity = hashlib.sha256(database.encode()).hexdigest()[:16]
    cache = Path(os.environ.get('XDG_CACHE_HOME', str(Path.home() / '.cache')))
    return cache / 'pocketcontext' / identity / 'crew-webhook.key'


def requires_webhook_key(project):
    with sqlite3.connect((project / 'pocketcontext.db').as_uri() + '?mode=ro', uri=True) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        secrets = 'crew_webhook_configs' in tables and db.execute("SELECT count(*) FROM crew_webhook_configs WHERE secret_ciphertext != ''").fetchone()[0]
        idempotency = 'crew_webhook_idempotency' in tables and db.execute("SELECT count(*) FROM crew_webhook_idempotency").fetchone()[0]
        return bool(secrets or idempotency)


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
    members = required + [name for name in ('storage', 'legacy-knowledge') if (project / name).exists()]
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
            private_hashes = {}
            key = webhook_key_path(project)
            if key.exists():
                if key.is_symlink() or not key.is_file() or key.stat().st_size != 32:
                    raise ValueError('Webhook key is not a regular 32-byte key')
                private = staging / 'private'
                private.mkdir(mode=0o700)
                shutil.copy2(key, private / 'crew-webhook.key', follow_symlinks=False)
                (private / 'crew-webhook.key').chmod(0o600)
                private_hashes['crew-webhook.key'] = digest(private / 'crew-webhook.key')
                if private_hashes['crew-webhook.key'] != digest(key):
                    raise ValueError('Webhook key changed during backup')
            elif requires_webhook_key(project):
                raise ValueError('Configured webhook credentials require their private key for backup')
            manifest = {'format': 1, 'kind': 'crew-native-project', 'sha256': hashes,
                        'private_sha256': private_hashes,
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
    private = root / 'private'
    private_hashes = {p.relative_to(private).as_posix(): digest(p) for p in regular_tree(private)} if private.exists() else {}
    if private_hashes != manifest.get('private_sha256', {}) or set(private_hashes) - {'crew-webhook.key'}:
        raise ValueError('Private webhook key does not match its recorded hash')
    if private_hashes and (private / 'crew-webhook.key').stat().st_size != 32:
        raise ValueError('Invalid webhook key size')
    if requires_webhook_key(root / 'project') and not private_hashes:
        raise ValueError('Snapshot is missing its webhook credential key')
    validate_project(root / 'project')


def restore(snapshot_path, project):
    """Restore to a new project; caller fences the original writer first."""
    verify(snapshot_path)
    root, project = Path(snapshot_path).resolve(), Path(project)
    if not project.is_absolute() or project.exists() or project.is_symlink():
        raise ValueError('Restore requires a new absolute project path')
    key = webhook_key_path(project)
    if key.exists():
        raise ValueError('Restore destination already has a private webhook key')
    project.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.crew-restore-', dir=project.parent))
    copied_key = False
    try:
        shutil.copytree(root / 'project', staging / 'project')
        # Consumed before serving; invalidates payloads from the old incarnation.
        (staging / 'project/crew-restore.json').write_text('{"version":1}\n')
        source_key = root / 'private/crew-webhook.key'
        if source_key.exists():
            key.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with key.open('xb') as stream:
                stream.write(source_key.read_bytes())
            key.chmod(0o600)
            copied_key = True
        (staging / 'project').rename(project)
    except Exception:
        if copied_key:
            key.unlink()
        raise
    finally:
        shutil.rmtree(staging)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', metavar='SNAPSHOT')
    parser.add_argument('--restore', metavar='SNAPSHOT')
    parser.add_argument('--project')
    parser.add_argument('--destination')
    parser.add_argument('--service')
    args = parser.parse_args()
    os.umask(0o077)
    if args.restore:
        if not args.project:
            parser.error('restore requires --project pointing to a new destination')
        restore(args.restore, args.project)
        print('Native snapshot restored; webhook delivery will remain disabled')
        return
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
