package crewruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/plugins/jsvm"
	"github.com/dop251/goja"

	"github.com/pocketcontext-labs/pocketcontext-crew/internal/crewpolicy"
)

// testSHA256 matches core's sha256(reader) binding.
func testSHA256(r io.Reader) (string, error) {
	h := sha256.New()
	if _, err := io.Copy(h, r); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// testHooksConfig loads the real hooks and migrations with Crew's bindings.
func testHooksConfig(root string) jsvm.Config {
	return jsvm.Config{
		HooksDir:      filepath.Join(root, "pb_hooks"),
		MigrationsDir: filepath.Join(root, "pb_migrations"),
		HooksWatch:    false,
		OnInit:        registerTestBindings,
	}
}

func registerTestBindings(vm *goja.Runtime) {
	bindings := hookBindings()
	bindings["sha256"] = testSHA256
	vm.Set(crewpolicy.Identity.HookGlobal, bindings)
}

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
	jsvm.MustRegister(app, testHooksConfig(root))
	registerCrewReads(app)
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// Close read-only SQL/search connections like the server shutdown does;
		// Windows cannot remove a temporary directory with open database files.
		_ = app.OnTerminate().Trigger(&core.TerminateEvent{App: app})
		_ = app.ResetBootstrapState()
	})
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
	u.SetEmail(crewpolicy.Identity.LocalAccountEmail)
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
