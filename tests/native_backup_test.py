#!/usr/bin/env python3
"""Native stopped-project backup failure and restore-integrity checks."""
import importlib.util
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('native_backup', Path(__file__).resolve().parents[1] / 'deploy/native/backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

class NativeBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.project = self.root / 'project'
        self.project.mkdir()
        self.destination = self.root / 'backups'
        with sqlite3.connect(self.project / 'pocketcontext.db') as db:
            db.execute('CREATE TABLE crew_notes(id TEXT, body TEXT)')
            db.execute('CREATE TABLE _collections(id TEXT, name TEXT)')
            db.execute("INSERT INTO _collections VALUES('sources_id', 'sources')")
            db.execute('CREATE TABLE sources(id TEXT, original TEXT, sha256 TEXT)')
            db.execute('INSERT INTO crew_notes VALUES(?,?)', ('synthetic', 'durable decision'))
        (self.project / 'pocketcontext.json').write_text('{}')
        (self.project / 'pocketcontext-crew').write_bytes(b'synthetic binary')
        (self.project / 'storage').mkdir()
        (self.project / 'storage/source.txt').write_text('synthetic original')
    def tearDown(self):
        self.temp.cleanup()
    def test_snapshot_restore_and_tamper(self):
        result = backup.snapshot(self.project, self.destination)
        backup.verify(result)
        restored = self.root / 'restored'
        shutil.copytree(result / 'project', restored)
        with sqlite3.connect(restored / 'pocketcontext.db') as db:
            self.assertEqual(db.execute('SELECT body FROM crew_notes').fetchone()[0], 'durable decision')
        (result / 'project/storage/source.txt').write_text('tampered')
        with self.assertRaises(ValueError):
            backup.verify(result)
    def test_failed_copy_never_publishes_snapshot(self):
        with patch.object(backup.shutil, 'copy2', side_effect=OSError('synthetic disk failure')):
            with self.assertRaises(OSError):
                backup.snapshot(self.project, self.destination)
        self.assertEqual([p.name for p in self.destination.iterdir()], ['.backup.lock'])
    def test_reject_symlink(self):
        (self.project / 'storage/private-link').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):
            backup.snapshot(self.project, self.destination)
    def test_reject_corrupt_database(self):
        (self.project / 'pocketcontext.db').write_bytes(b'corrupt database')
        with self.assertRaises(sqlite3.DatabaseError):
            backup.snapshot(self.project, self.destination)
        self.assertEqual([p.name for p in self.destination.iterdir()], ['.backup.lock'])
    def test_reject_nested_and_public_destination(self):
        with self.assertRaises(ValueError):
            backup.snapshot(self.project, self.project / 'backups')
        self.destination.mkdir(mode=0o755)
        with self.assertRaises(ValueError):
            backup.snapshot(self.project, self.destination)
    def test_missing_original_is_not_a_successful_backup(self):
        with sqlite3.connect(self.project / 'pocketcontext.db') as db:
            db.execute('INSERT INTO sources VALUES(?,?,?)', ('missing', 'file.txt', '0' * 64))
        with self.assertRaises(ValueError):
            backup.snapshot(self.project, self.destination)
        self.assertEqual([p.name for p in self.destination.iterdir()], ['.backup.lock'])
    def test_detect_source_change(self):
        original_digest = backup.digest
        def changed(path):
            if path == self.project / 'pocketcontext.json':
                return 'changed'
            return original_digest(path)
        with patch.object(backup, 'digest', side_effect=changed):
            with self.assertRaises(ValueError):
                backup.snapshot(self.project, self.destination)
        self.assertEqual([p.name for p in self.destination.iterdir()], ['.backup.lock'])

if __name__ == '__main__':
    unittest.main()
