package bundle

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/plugins/jsvm"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/dop251/goja"
)

func runFixtureMigration(t *testing.T, app core.App, path string) error {
	t.Helper()
	vm := goja.New()
	jsvm.BindCore(vm)
	jsvm.BindSecurity(vm)
	registerHookBindings(vm)
	var up func(core.App) error
	vm.Set("migrate", func(fn, down func(core.App) error) { up = fn })
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = vm.RunString(string(raw)); err != nil {
		t.Fatal(err)
	}
	return app.RunInTransaction(func(tx core.App) error { return up(tx) })
}

func syntheticLegacyProject(t *testing.T) (*testApp, *Project, *Store) {
	t.Helper()
	a := newTestApp(t)
	if err := runFixtureMigration(t, a.app, "testdata/legacy_knowledge.js"); err != nil {
		t.Fatal(err)
	}
	spaces, err := a.app.FindAllRecords("spaces")
	if err != nil {
		t.Fatal(err)
	}
	sources, err := a.app.FindCollectionByNameOrId("sources")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(sources)
	r.Set("space", spaces[0].Id)
	r.Set("title", "Synthetic archived evidence")
	r.Set("original_name", "evidence.txt")
	r.Set("media_type", "text/plain")
	r.Set("revision", 1)
	file, err := filesystem.NewFileFromBytes([]byte("Synthetic evidence retained across migration."), "evidence.txt")
	if err != nil {
		t.Fatal(err)
	}
	r.Set("original", file)
	reader, err := file.Reader.Open()
	if err != nil {
		t.Fatal(err)
	}
	hash, err := readerSHA256(reader)
	reader.Close()
	if err != nil {
		t.Fatal(err)
	}
	r.Set("sha256", hash)
	// File readers are opened anew by PocketBase when saving.
	if err = a.app.Save(r); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"crew_agents", "crew_buckets"} {
		c, _ := a.app.FindCollectionByNameOrId(name)
		r := core.NewRecord(c)
		r.Set("name", "Synthetic retained "+name)
		r.Set("revision", 7)
		if err = a.app.Save(r); err != nil {
			t.Fatal(err)
		}
	}
	dir := a.app.DataDir()
	p := &Project{Dir: dir, DB: filepath.Join(dir, "pocketcontext.db"), ConfigPath: filepath.Join(dir, "pocketcontext.json"), Cache: t.TempDir(), Config: Config{Port: 8096}}
	if err = p.SaveConfig(); err != nil {
		t.Fatal(err)
	}
	// The fixture database is isolated, outside a synced project. Prepare an
	// equivalent private working snapshot while leaving the original fixture open.
	if err = os.MkdirAll(p.LiveDir(), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err = a.app.DB().NewQuery("VACUUM INTO {:path}").Bind(map[string]any{"path": filepath.Join(p.LiveDir(), "data.db")}).Execute(); err != nil {
		t.Fatal(err)
	}
	return a, p, &Store{p: p}
}

func TestKnowledgeArchiveMigrationPreservesAndRestores(t *testing.T) {
	a, p, s := syntheticLegacyProject(t)
	before, err := a.app.FindAllRecords("crew_agents")
	if err != nil {
		t.Fatal(err)
	}
	if err = prepareKnowledgeArchive(p, s); err != nil {
		t.Fatal(err)
	}
	if err = verifyKnowledgeArchive(a.app); err != nil {
		t.Fatal(err)
	}
	if err = runFixtureMigration(t, a.app, "../../pb_migrations/1800100000_crew_standalone.js"); err != nil {
		t.Fatal(err)
	}
	for _, name := range retiredKnowledge {
		if _, err = a.app.FindCollectionByNameOrId(name); err == nil {
			t.Fatalf("retained %s", name)
		}
	}
	after, err := a.app.FindAllRecords("crew_agents")
	if err != nil || len(after) != len(before) || after[0].Id != before[0].Id || after[0].GetInt("revision") != 7 {
		t.Fatal("Crew records changed", err)
	}
	raw, err := os.ReadFile(filepath.Join(p.Dir, "legacy-knowledge", "current.json"))
	if err != nil {
		t.Fatal(err)
	}
	var pointer struct{ Archive string }
	if err = json.Unmarshal(raw, &pointer); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(p.Dir, "legacy-knowledge", pointer.Archive)
	if _, err = verifyArchiveFiles(archive); err != nil {
		t.Fatal(err)
	}
	// Rollback opens a separate copy, not the archive or migrated live database.
	restored := t.TempDir()
	if err = copyFile(filepath.Join(archive, "pocketcontext.db"), filepath.Join(restored, "data.db")); err != nil {
		t.Fatal(err)
	}
	old := core.NewBaseApp(core.BaseAppConfig{DataDir: restored})
	if err = old.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	defer old.ResetBootstrapState()
	rows, err := old.FindAllRecords("sources")
	if err != nil || len(rows) != 1 || rows[0].GetString("title") != "Synthetic archived evidence" {
		t.Fatal("rollback evidence missing", err)
	}
	oldAgents, err := old.FindAllRecords("crew_agents")
	if err != nil || len(oldAgents) != len(before) || oldAgents[0].Id != before[0].Id {
		t.Fatal("rollback Crew records changed", err)
	}
}

func TestKnowledgeArchiveFailsClosed(t *testing.T) {
	a, p, s := syntheticLegacyProject(t)
	path := "../../pb_migrations/1800100000_crew_standalone.js"
	if err := runFixtureMigration(t, a.app, path); err == nil {
		t.Fatal("migration accepted missing archive")
	}
	if err := prepareKnowledgeArchive(p, s); err != nil {
		t.Fatal(err)
	}
	r, err := a.app.FindFirstRecordByFilter("sources", "id != ''")
	if err != nil {
		t.Fatal(err)
	}
	r.Set("title", "Changed since snapshot")
	if err = a.app.Save(r); err != nil {
		t.Fatal(err)
	}
	if err = runFixtureMigration(t, a.app, path); err == nil {
		t.Fatal("migration accepted stale archive")
	}
	if _, err = a.app.FindCollectionByNameOrId("sources"); err != nil {
		t.Fatal("failed migration removed data")
	}
	raw, _ := os.ReadFile(filepath.Join(p.Dir, "legacy-knowledge", "current.json"))
	var pointer struct{ Archive string }
	json.Unmarshal(raw, &pointer)
	archive := filepath.Join(p.Dir, "legacy-knowledge", pointer.Archive)
	if err = os.WriteFile(filepath.Join(archive, "pocketcontext.json"), []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = verifyArchiveFiles(archive); err == nil {
		t.Fatal("corrupt archive accepted")
	}
}

func TestKnowledgeArchiveRejectsCorruptOriginal(t *testing.T) {
	a, p, s := syntheticLegacyProject(t)
	r, err := a.app.FindFirstRecordByFilter("sources", "id != ''")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(p.Dir, "storage", r.BaseFilesPath(), r.GetString("original"))
	if err = os.WriteFile(path, []byte("corrupt original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = prepareKnowledgeArchive(p, s); err == nil {
		t.Fatal("accepted corrupt original")
	}
	if _, err = os.Stat(filepath.Join(p.Dir, "legacy-knowledge", "current.json")); !os.IsNotExist(err) {
		t.Fatal("published incomplete archive", err)
	}
	if _, err = a.app.FindCollectionByNameOrId("sources"); err != nil {
		t.Fatal("source schema changed before verified archive")
	}
}

func TestKnowledgeArchiveRequiredAfterMigration(t *testing.T) {
	for _, damage := range []string{"root", "pointer", "target", "empty-root", "wrong-pointer", "manifest"} {
		t.Run(damage, func(t *testing.T) {
			a, p, s := syntheticLegacyProject(t)
			if err := prepareKnowledgeArchive(p, s); err != nil {
				t.Fatal(err)
			}
			if err := runFixtureMigration(t, a.app, "../../pb_migrations/1800100000_crew_standalone.js"); err != nil {
				t.Fatal(err)
			}
			root := filepath.Join(p.Dir, "legacy-knowledge")
			raw, err := os.ReadFile(filepath.Join(root, "current.json"))
			if err != nil {
				t.Fatal(err)
			}
			var pointer struct{ Archive string }
			if err = json.Unmarshal(raw, &pointer); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(root, pointer.Archive)
			db := filepath.Join(a.app.DataDir(), "data.db")
			if err = verifyKnowledgeArchiveTree(p.Dir, db); err != nil {
				t.Fatal("intact migrated archive rejected", err)
			}
			switch damage {
			case "root":
				err = os.RemoveAll(root)
			case "pointer":
				err = os.Remove(filepath.Join(root, "current.json"))
			case "target":
				err = os.RemoveAll(target)
			case "empty-root":
				err = os.RemoveAll(root)
				if err == nil {
					err = os.MkdirAll(root, 0700)
				}
			case "wrong-pointer":
				err = os.WriteFile(filepath.Join(root, "current.json"), []byte(`{"archive":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}`), 0600)
			case "manifest":
				// Even valid JSON cannot be replaced without changing the durable DB anchor.
				manifest := filepath.Join(target, "manifest.json")
				var contents []byte
				contents, err = os.ReadFile(manifest)
				if err == nil {
					err = os.WriteFile(manifest, append(contents, '\n'), 0600)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if err = verifyKnowledgeArchiveTree(p.Dir, db); err == nil {
				t.Fatal("accepted migrated project whose required archive was lost or changed")
			}
		})
	}
}

func TestKnowledgeArchiveExactContents(t *testing.T) {
	for _, damage := range []string{"extra", "missing-config-entry", "directory-symlink"} {
		t.Run(damage, func(t *testing.T) {
			_, p, s := syntheticLegacyProject(t)
			if err := prepareKnowledgeArchive(p, s); err != nil {
				t.Fatal(err)
			}
			root := filepath.Join(p.Dir, "legacy-knowledge")
			raw, err := os.ReadFile(filepath.Join(root, "current.json"))
			if err != nil {
				t.Fatal(err)
			}
			var pointer struct{ Archive string }
			if err = json.Unmarshal(raw, &pointer); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(root, pointer.Archive)
			switch damage {
			case "extra":
				err = os.WriteFile(filepath.Join(target, "unlisted.txt"), []byte("unlisted"), 0600)
			case "missing-config-entry":
				var manifest knowledgeArchiveManifest
				raw, err = os.ReadFile(filepath.Join(target, "manifest.json"))
				if err == nil {
					err = json.Unmarshal(raw, &manifest)
				}
				if err == nil {
					delete(manifest.Files, "pocketcontext.json")
					err = os.Remove(filepath.Join(target, "pocketcontext.json"))
				}
				if err == nil {
					raw, err = json.Marshal(manifest)
				}
				if err == nil {
					err = os.WriteFile(filepath.Join(target, "manifest.json"), raw, 0600)
				}
			case "directory-symlink":
				storage := filepath.Join(target, "storage")
				external := filepath.Join(t.TempDir(), "storage")
				if err = os.Rename(storage, external); err != nil {
					t.Fatal(err)
				}
				if err = os.Symlink(external, storage); err != nil {
					t.Skipf("symlink creation unavailable: %v", err)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err = verifyArchiveFiles(target); err == nil {
				t.Fatal("accepted incomplete or non-local archive")
			}
		})
	}
}

func TestKnowledgeArchiveInterruptedPreparationRetry(t *testing.T) {
	_, p, s := syntheticLegacyProject(t)
	root := filepath.Join(p.Dir, "legacy-knowledge")
	interrupted := filepath.Join(root, ".preparing-interrupted")
	if err := os.MkdirAll(interrupted, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(interrupted, "pocketcontext.db"), []byte("incomplete snapshot"), 0600); err != nil {
		t.Fatal(err)
	}
	// WriteAtomic's own temporary filename has a second leading dot.
	pointerTemp := filepath.Join(root, "..pointer-interrupted.tmp-123")
	if err := os.WriteFile(pointerTemp, []byte("incomplete pointer"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := prepareKnowledgeArchive(p, s); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".preparing-") || strings.HasPrefix(entry.Name(), ".pointer-") || strings.HasPrefix(entry.Name(), "..pointer-") {
			t.Fatal("interrupted staging entry survives successful preparation")
		}
	}
}
