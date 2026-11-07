package bundle

// This one-time conversion runs after the single-writer lock and private working
// copy are established, but before PocketBase can mutate the old schema. The
// resulting directory is a complete, hash-verified rollback project, never an API.
import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/pocketcontext/sqliteuri"
)

var retiredKnowledge = []string{"spaces", "settings", "sources", "renditions", "passages", "pages", "ingestion_runs", "page_revisions", "citations", "page_links", "publications", "audit_log"}

type knowledgeArchiveManifest struct {
	Format           int               `json:"format"`
	Created          string            `json:"created"`
	MigrationVersion string            `json:"migration_version"`
	MigrationCommit  string            `json:"migration_commit"`
	Restore          string            `json:"restore"`
	Files            map[string]string `json:"files"`
	Tables           map[string]string `json:"tables"`
}

func tableDigest(rows *sql.Rows) (string, error) {
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return "", err
	}
	h := sha256.New()
	enc := json.NewEncoder(h)
	if err := enc.Encode(columns); err != nil {
		return "", err
	}
	for rows.Next() {
		values := make([]any, len(columns))
		refs := make([]any, len(columns))
		for i := range values {
			refs[i] = &values[i]
		}
		if err := rows.Scan(refs...); err != nil {
			return "", err
		}
		for i, value := range values {
			if b, ok := value.(bool); ok {
				if b {
					values[i] = int64(1)
				} else {
					values[i] = int64(0)
				}
			}
			if b, ok := value.([]byte); ok {
				values[i] = string(b)
			}
		}
		if err := enc.Encode(values); err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(h.Sum(nil)), rows.Err()
}

func legacyTableDigests(db *sql.DB) (map[string]string, error) {
	result := map[string]string{}
	for _, name := range retiredKnowledge {
		var count int
		if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", name).Scan(&count); err != nil {
			return nil, err
		}
		if count == 0 {
			continue
		}
		rows, err := db.Query(`SELECT * FROM "` + name + `" ORDER BY id`)
		if err != nil {
			return nil, err
		}
		digest, err := tableDigest(rows)
		if err != nil {
			return nil, err
		}
		result[name] = digest
	}
	return result, nil
}

func archiveDB(path string) (*sql.DB, error) {
	u := sqliteuri.File(path)
	q := u.Query()
	q.Set("mode", "ro")
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite3", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

func verifyArchiveFiles(dir string) (*knowledgeArchiveManifest, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return nil, err
	}
	var m knowledgeArchiveManifest
	if err = json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	if m.Format != 1 || len(m.Tables) == 0 || m.Files["pocketcontext.db"] == "" || m.Files["pocketcontext.json"] == "" {
		return nil, errors.New("invalid legacy archive manifest")
	}
	actual := map[string]bool{}
	if info, err := os.Lstat(dir); err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("legacy archive must be a real directory")
	}
	err = filepath.WalkDir(dir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("legacy archive contains a symlink")
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return errors.New("legacy archive contains non-regular entry")
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(rel)
		if name != "manifest.json" {
			actual[name] = true
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(actual) != len(m.Files) {
		return nil, errors.New("legacy archive file inventory mismatch")
	}
	for name := range actual {
		if m.Files[name] == "" {
			return nil, errors.New("legacy archive contains unexpected file")
		}
	}
	for name, want := range m.Files {
		if !fs.ValidPath(name) || strings.Contains(name, "\\") {
			return nil, errors.New("unsafe legacy archive path")
		}
		path := filepath.Join(dir, filepath.FromSlash(name))
		info, err := os.Lstat(path)
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, errors.New("legacy archive contains non-regular file")
		}
		got, err := fileSHA256(path)
		if err != nil {
			return nil, err
		}
		if got != want {
			return nil, fmt.Errorf("legacy archive checksum mismatch: %s", name)
		}
	}
	// Never let SQLite open an archive in the possibly synced project. Validate
	// only a disposable private copy, so SQLite cannot create archive sidecars.
	private, err := os.MkdirTemp("", "crew-archive-check-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(private)
	privateDB := filepath.Join(private, "data.db")
	if err = copyFile(filepath.Join(dir, "pocketcontext.db"), privateDB); err != nil {
		return nil, err
	}
	db, err := archiveDB(privateDB)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	var integrity string
	if err = db.QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil {
		return nil, err
	}
	if integrity != "ok" {
		return nil, errors.New("legacy archive database integrity failed")
	}
	tables, err := legacyTableDigests(db)
	if err != nil {
		return nil, err
	}
	if !sameDigests(tables, m.Tables) {
		return nil, errors.New("legacy archive table checksums mismatch")
	}
	// Original content hashes in the old schema must match the archived bytes too.
	if _, ok := tables["sources"]; ok {
		rows, err := db.Query("SELECT s.id,s.original,s.sha256,c.id FROM sources s JOIN _collections c ON c.name='sources'")
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var id, name, want, collection string
			if err = rows.Scan(&id, &name, &want, &collection); err != nil {
				return nil, err
			}
			if !fs.ValidPath(id) || !fs.ValidPath(name) || !fs.ValidPath(collection) || strings.ContainsAny(id+name+collection, "/\\") {
				return nil, errors.New("unsafe original path")
			}
			got := m.Files["storage/"+collection+"/"+id+"/"+name]
			if want == "" || got != want {
				return nil, errors.New("legacy source original missing or corrupt")
			}
		}
		if err = rows.Err(); err != nil {
			return nil, err
		}
	}
	return &m, nil
}

func sameDigests(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func prepareKnowledgeArchive(p *Project, s *Store) error {
	if _, err := os.Stat(s.livePath()); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	db, err := archiveDB(s.livePath())
	if err != nil {
		return err
	}
	tables, err := legacyTableDigests(db)
	db.Close()
	if err != nil {
		return err
	}
	if err = cleanupArchiveStaging(p.Dir); err != nil {
		return err
	}
	if len(tables) == 0 {
		return verifyKnowledgeArchiveTree(p.Dir, s.livePath())
	}
	root := filepath.Join(p.Dir, "legacy-knowledge")
	if err = os.MkdirAll(root, 0700); err != nil {
		return err
	}
	temp, err := os.MkdirTemp(root, ".preparing-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temp)
	if err = s.snapshot(filepath.Join(temp, "pocketcontext.db")); err != nil {
		return err
	}
	if err = os.Chmod(filepath.Join(temp, "pocketcontext.db"), 0600); err != nil {
		return err
	}
	file, err := os.OpenFile(filepath.Join(temp, "pocketcontext.db"), os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	err = file.Sync()
	file.Close()
	if err != nil {
		return err
	}
	if err = copyFile(p.ConfigPath, filepath.Join(temp, "pocketcontext.json")); err != nil {
		return err
	}
	storage := filepath.Join(p.Dir, "storage")
	err = filepath.WalkDir(storage, func(path string, entry fs.DirEntry, walkErr error) error {
		if errors.Is(walkErr, os.ErrNotExist) && path == storage {
			return nil
		}
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(p.Dir, path)
		if err != nil {
			return err
		}
		dst := filepath.Join(temp, rel)
		if entry.IsDir() {
			return os.MkdirAll(dst, 0700)
		}
		if !entry.Type().IsRegular() {
			return errors.New("cannot archive non-regular storage entry")
		}
		return copyFile(path, dst)
	})
	if err != nil {
		return err
	}
	m := knowledgeArchiveManifest{Format: 1, Created: time.Now().UTC().Format(time.RFC3339), MigrationVersion: Version, MigrationCommit: Commit, Tables: tables, Files: map[string]string{}, Restore: "Stop and fence the current writer. Copy pocketcontext.db, pocketcontext.json and storage to a separate empty project. Use the exact pre-upgrade release recorded by the complete deployment backup; this archive does not contain a binary or private OAuth state. Do not overwrite later Crew writes. The full database includes Crew and account state as of migration."}
	err = filepath.WalkDir(temp, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(temp, path)
		if err != nil {
			return err
		}
		hash, err := fileSHA256(path)
		if err != nil {
			return err
		}
		m.Files[filepath.ToSlash(rel)] = hash
		return nil
	})
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	if err = WriteAtomic(filepath.Join(temp, "manifest.json"), raw, 0600); err != nil {
		return err
	}
	if err = syncArchiveTree(temp); err != nil {
		return err
	}
	if _, err = verifyArchiveFiles(temp); err != nil {
		return err
	}
	digest := m.Files["pocketcontext.db"]
	dest := filepath.Join(root, digest)
	if _, err = os.Stat(dest); err == nil {
		if _, err = verifyArchiveFiles(dest); err != nil {
			return err
		}
	} else if errors.Is(err, os.ErrNotExist) {
		if err = durableArchiveRename(temp, dest); err != nil {
			return err
		}
	} else {
		return err
	}
	pointerTemp := filepath.Join(root, ".pointer-"+RandomHex(8))
	defer os.Remove(pointerTemp)
	pointerFile, err := os.OpenFile(pointerTemp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err = pointerFile.Write([]byte(`{"archive":"` + digest + `"}`)); err == nil {
		err = pointerFile.Sync()
	}
	closeErr := pointerFile.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = durableArchiveRename(pointerTemp, filepath.Join(root, "current.json")); err != nil {
		return err
	}
	if err = syncArchiveDirectory(root); err != nil {
		return err
	}
	return syncArchiveDirectory(p.Dir)
}

// Called inside the migration transaction, before the first collection removal.
// Its rows must still exactly match the fully archived private snapshot.
func verifyKnowledgeArchive(app core.App) error {
	root := filepath.Join(app.DataDir(), "legacy-knowledge")
	raw, err := os.ReadFile(filepath.Join(root, "current.json"))
	if err != nil {
		return fmt.Errorf("legacy knowledge archive required before migration: %w", err)
	}
	var pointer struct {
		Archive string `json:"archive"`
	}
	if err = json.Unmarshal(raw, &pointer); err != nil {
		return err
	}
	if len(pointer.Archive) != 64 || strings.Trim(pointer.Archive, "0123456789abcdef") != "" {
		return errors.New("invalid legacy archive reference")
	}
	m, err := verifyArchiveFiles(filepath.Join(root, pointer.Archive))
	if err != nil {
		return err
	}
	for name, want := range m.Tables {
		rows, err := app.DB().NewQuery(`SELECT * FROM "` + name + `" ORDER BY id`).Rows()
		if err != nil {
			return err
		}
		got, err := tableDigest(rows.Rows)
		if err != nil {
			return err
		}
		if got != want {
			return fmt.Errorf("legacy table changed since archive: %s", name)
		}
	}
	return nil
}

// recordKnowledgeArchive anchors preservation in the same transaction that
// removes the source collections. A missing archive can never look like a fresh
// installation on subsequent starts or complete-backup verification.
func recordKnowledgeArchive(app core.App) error {
	if err := verifyKnowledgeArchive(app); err != nil {
		return err
	}
	pointer, err := readArchivePointer(app.DataDir())
	if err != nil {
		return err
	}
	hash, err := fileSHA256(filepath.Join(app.DataDir(), "legacy-knowledge", pointer, "manifest.json"))
	if err != nil {
		return err
	}
	if _, err = app.DB().NewQuery(`CREATE TABLE _crew_legacy_archive (id INTEGER PRIMARY KEY CHECK(id=1), archive TEXT NOT NULL, manifest_sha256 TEXT NOT NULL)`).Execute(); err != nil {
		return err
	}
	_, err = app.DB().NewQuery(`INSERT INTO _crew_legacy_archive (id,archive,manifest_sha256) VALUES (1,{:archive},{:manifest})`).Bind(dbx.Params{"archive": pointer, "manifest": hash}).Execute()
	return err
}
func readArchivePointer(project string) (string, error) {
	root := filepath.Join(project, "legacy-knowledge")
	info, err := os.Lstat(root)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("legacy archive root must be a real directory")
	}
	path := filepath.Join(root, "current.json")
	info, err = os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("legacy archive pointer must be a regular file")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var p struct {
		Archive string `json:"archive"`
	}
	if err = json.Unmarshal(raw, &p); err != nil {
		return "", err
	}
	if len(p.Archive) != 64 || strings.Trim(p.Archive, "0123456789abcdef") != "" {
		return "", errors.New("invalid legacy archive pointer")
	}
	return p.Archive, nil
}

// Archives remain independently verifiable after their source tables are gone.
// databasePath must be a private working copy, never the synced project file.
func verifyKnowledgeArchiveTree(project, databasePath string) error {
	db, err := archiveDB(databasePath)
	if err != nil {
		return err
	}
	defer db.Close()
	var required int
	if err = db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='_crew_legacy_archive'").Scan(&required); err != nil {
		return err
	}
	if required != 0 {
		var count int
		if err = db.QueryRow("SELECT count(*) FROM _crew_legacy_archive").Scan(&count); err != nil {
			return err
		}
		if count != 1 {
			return errors.New("invalid legacy archive database anchor")
		}
		var archive, manifest string
		if err = db.QueryRow("SELECT archive,manifest_sha256 FROM _crew_legacy_archive WHERE id=1").Scan(&archive, &manifest); err != nil {
			return err
		}
		pointer, err := readArchivePointer(project)
		if err != nil {
			return fmt.Errorf("required legacy archive missing: %w", err)
		}
		if pointer != archive {
			return errors.New("legacy archive pointer differs from database anchor")
		}
		hash, err := fileSHA256(filepath.Join(project, "legacy-knowledge", archive, "manifest.json"))
		if err != nil {
			return err
		}
		if hash != manifest {
			return errors.New("legacy archive manifest differs from database anchor")
		}
	}
	root := filepath.Join(project, "legacy-knowledge")
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) && required == 0 {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err = readArchivePointer(project); err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() == "current.json" {
			continue
		}
		if !entry.IsDir() || len(entry.Name()) != 64 || strings.Trim(entry.Name(), "0123456789abcdef") != "" {
			return errors.New("unexpected entry in legacy knowledge archives")
		}
		m, err := verifyArchiveFiles(filepath.Join(root, entry.Name()))
		if err != nil {
			return err
		}
		if m.Files["pocketcontext.db"] != entry.Name() {
			return errors.New("legacy archive directory checksum mismatch")
		}
	}
	pointer, err := readArchivePointer(project)
	if err != nil {
		return err
	}
	_, err = verifyArchiveFiles(filepath.Join(root, pointer))
	return err
}

func cleanupArchiveStaging(project string) error {
	root := filepath.Join(project, "legacy-knowledge")
	info, err := os.Lstat(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("legacy archive root must be a real directory")
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".preparing-") {
			if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
				return errors.New("unsafe interrupted archive staging entry")
			}
			if err = os.RemoveAll(filepath.Join(root, entry.Name())); err != nil {
				return err
			}
		} else if strings.HasPrefix(entry.Name(), ".pointer-") || (strings.HasPrefix(entry.Name(), "..pointer-") && strings.Contains(entry.Name(), ".tmp-")) {
			if !entry.Type().IsRegular() {
				return errors.New("unsafe interrupted archive pointer")
			}
			if err = os.Remove(filepath.Join(root, entry.Name())); err != nil {
				return err
			}
		}
	}
	return syncArchiveDirectory(root)
}
func syncArchiveTree(root string) error {
	var dirs []string
	if err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			dirs = append(dirs, path)
		}
		return nil
	}); err != nil {
		return err
	}
	for i := len(dirs) - 1; i >= 0; i-- {
		if err := syncArchiveDirectory(dirs[i]); err != nil {
			return err
		}
	}
	return nil
}
