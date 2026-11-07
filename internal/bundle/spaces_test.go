package bundle

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/plugins/jsvm"
)

type testApp struct {
	app     core.App
	handler http.Handler
	token   string
	user    *core.Record
}

// newTestApp runs the real application migrations and hooks on an isolated
// database and creates the project's one account.
func newTestApp(t *testing.T) *testApp {
	t.Helper()
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	app := core.NewBaseApp(core.BaseAppConfig{DataDir: t.TempDir()})
	configureWebhookRuntime(app, &Project{Cache: t.TempDir()}, "")
	jsvm.MustRegister(app, hooksConfig(root, ""))
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.OnServe().Trigger(&core.ServeEvent{App: app, Router: router}); err != nil {
		t.Fatal(err)
	}
	handler, err := router.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	u := core.NewRecord(users)
	u.SetEmail(LocalIdentity)
	u.SetPassword("synthetic-password")
	u.SetVerified(true)
	if err := app.Save(u); err != nil {
		t.Fatal(err)
	}
	token, err := u.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	return &testApp{app: app, handler: handler, token: token, user: u}
}

func (a *testApp) request(t *testing.T, method, path, token, body string, want int) map[string]any {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	response := httptest.NewRecorder()
	a.handler.ServeHTTP(response, req)
	if response.Code != want {
		t.Fatalf("%s %s: %d %s; want %d", method, path, response.Code, response.Body, want)
	}
	var data map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &data); err != nil {
		var list []any
		if json.Unmarshal(response.Body.Bytes(), &list) != nil {
			t.Fatal(err)
		}
	}
	return data
}

func TestCrewHasNoKnowledgeCollections(t *testing.T) {
	a := newTestApp(t)
	for _, name := range retiredKnowledge {
		if _, err := a.app.FindCollectionByNameOrId(name); err == nil {
			t.Errorf("retired collection %s remains", name)
		}
	}
	for _, name := range []string{"crew_agents", "crew_buckets", "crew_notes", "crew_note_revisions", "crew_tasks", "crew_reviews", "crew_events"} {
		if _, err := a.app.FindCollectionByNameOrId(name); err != nil {
			t.Errorf("missing %s: %v", name, err)
		}
	}
	for _, endpoint := range []string{"/api/spaces/default", "/api/context/schema", "/api/pocketcontext/runs/synthetic/check"} {
		a.request(t, "GET", endpoint, a.token, "", 404)
	}
	a.request(t, "POST", "/api/context/query", a.token, `{"sql":"SELECT 1"}`, 404)
	a.request(t, "POST", "/api/context/search", a.token, `{}`, 404)
}

// A database from an earlier release is refused before PocketBase opens it,
// and neither the synced file nor the working copy changes.
func TestEarlierReleaseRefused(t *testing.T) {
	dir := t.TempDir()
	for _, tc := range []struct {
		name, schema string
		refused      bool
	}{
		{"old migrations", "CREATE TABLE _migrations (file TEXT PRIMARY KEY, applied INTEGER); INSERT INTO _migrations VALUES ('1640988000_init.go', 1), ('1791500000_spaces.js', 2);", true},
		{"membership table", "CREATE TABLE space_members (id TEXT PRIMARY KEY);", true},
		{"unknown migration", "CREATE TABLE _migrations (file TEXT PRIMARY KEY, applied INTEGER); INSERT INTO _migrations VALUES ('1999999999_future.js', 1);", true},
		{"unknown system migration", "CREATE TABLE _migrations (file TEXT PRIMARY KEY, applied INTEGER); INSERT INTO _migrations VALUES ('1999999999_future.go', 1);", true},
		{"unknown migration extension", "CREATE TABLE _migrations (file TEXT PRIMARY KEY, applied INTEGER); INSERT INTO _migrations VALUES ('future.sql', 1);", true},
		{"migration path alias", "CREATE TABLE _migrations (file TEXT PRIMARY KEY, applied INTEGER); INSERT INTO _migrations VALUES ('future/1800000000_initial.js', 1);", true},
		{"current", "CREATE TABLE _migrations (file TEXT PRIMARY KEY, applied INTEGER); INSERT INTO _migrations VALUES ('1640988000_init.go', 1), ('1800000000_initial.js', 2);", false},
		{"empty", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(dir, strings.ReplaceAll(tc.name, " ", "-")+".db")
			db, err := sql.Open("sqlite3", path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec("CREATE TABLE notes (id TEXT); " + tc.schema); err != nil {
				t.Fatal(err)
			}
			db.Close()
			before, err := fileSHA256(path)
			if err != nil {
				t.Fatal(err)
			}
			err = checkDatabase(path, "/synced/pocketcontext.db")
			if got := errors.Is(err, ErrEarlierRelease); got != tc.refused {
				t.Fatalf("refused = %v (%v); want %v", got, err, tc.refused)
			}
			if tc.refused && !strings.Contains(err.Error(), "/synced/pocketcontext.db") {
				t.Fatalf("message does not name the database: %v", err)
			}
			if tc.name == "old migrations" && !strings.Contains(err.Error(), "earlier PocketContext release") {
				t.Fatalf("message: %v", err)
			}
			after, err := fileSHA256(path)
			if err != nil || after != before {
				t.Fatalf("the database changed: %v", err)
			}
		})
	}
}

// Store.Open copies an old synced database into the cache, and Serve refuses it
// there; unsaved changes of an earlier release are never written back.
func TestEarlierReleaseWorkingCopyUntouched(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	project := filepath.Join(t.TempDir(), "pocketcontext.db")
	db, err := sql.Open("sqlite3", project)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE space_members (id TEXT PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	before, _ := fileSHA256(project)
	p, err := Resolve(project)
	if err != nil {
		t.Fatal(err)
	}
	store := &Store{p: p}
	if err := store.Open(); err != nil {
		t.Fatal(err)
	}
	if err := checkDatabase(store.livePath(), p.DB); !errors.Is(err, ErrEarlierRelease) {
		t.Fatalf("working copy accepted: %v", err)
	}
	// An interrupted earlier-release run with unsaved changes.
	store.state.Dirty = true
	if err := store.saveState(); err != nil {
		t.Fatal(err)
	}
	if err := (&Store{p: p}).Open(); !errors.Is(err, ErrEarlierRelease) {
		t.Fatalf("dirty working copy: %v", err)
	}
	if after, _ := fileSHA256(project); after != before {
		t.Fatal("the synced database changed")
	}
	if _, err := os.Stat(store.livePath()); err != nil {
		t.Fatal("the working copy was removed")
	}
}
