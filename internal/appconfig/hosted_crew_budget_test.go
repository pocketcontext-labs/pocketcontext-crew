//go:build crew_core_testkit

package appconfig

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketcontext-labs/pocketcontext-core/appserver"
)

func assertRateMetadata(t *testing.T, w *httptest.ResponseRecorder, label string, capacity, retry int) {
	t.Helper()
	var body struct {
		Data struct {
			Rate struct {
				Limit             string `json:"limit"`
				RetryAfterSeconds int    `json:"retry_after_seconds"`
				Capacity          int    `json:"capacity"`
			} `json:"rate_limit"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Data.Rate.Limit != label || body.Data.Rate.Capacity != capacity || body.Data.Rate.RetryAfterSeconds != retry {
		t.Fatalf("metadata: %+v, body %s", body.Data.Rate, w.Body)
	}
	for _, header := range []string{"Retry-After", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"} {
		if w.Header().Get(header) == "" {
			t.Errorf("missing %s", header)
		}
	}
}

func TestHostedCrewSharedBudgetAndCooldown(t *testing.T) {
	a := newTestApp(t)
	setOwnerEmail(t, a)
	token, err := a.user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	// Consume operation reservations without database work, then exercise real Crew
	// routes at the boundary. Time is frozen so slow CI cannot replenish budget.
	a.app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.Bind(&hook.Handler[*core.RequestEvent]{Id: "budgetProbe", Priority: apis.DefaultLoadAuthTokenMiddlewarePriority + 7, Func: func(re *core.RequestEvent) error {
			if re.Request.URL.Path == "/api/budget-probe" {
				return re.NoContent(204)
			}
			return re.Next()
		}})
		return e.Next()
	})
	now := time.Now()
	server, err := Runtime.NewTestServer(a.app, appserver.TestServerOptions{Domain: syntheticDomain, Hosted: true, HostedConfig: syntheticHostedConfig(), Cache: t.TempDir(), Clock: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Router()
	request := func(path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := server.MarkPublic(httptest.NewRequest("POST", "https://knowledge.example.com"+path, strings.NewReader(body)))
		r.Header.Set("Authorization", token)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s: %d %s want %d", path, w.Code, w.Body, want)
		}
		return w
	}
	for range 1180 {
		request("/api/budget-probe", "{}", 204)
	}
	read := `{"collection":"agents"}`
	write := `{"action":"task.create","reported_agent":"Synthetic worker","data":{"title":"Budget boundary"}}`
	for range 17 {
		request("/api/crew/read", read, 200)
	}
	request("/api/crew/write", write, 200)
	request("/api/crew/agent-write", write, 200)
	request("/api/crew/read", read, 200)
	for _, path := range []string{"/api/crew/read", "/api/crew/write", "/api/crew/agent-write"} {
		body := write
		if path == "/api/crew/read" {
			body = read
		}
		w := request(path, body, 429)
		assertRateMetadata(t, w, "authenticated_knowledge", 1200, 1)
	}
	tasks, err := a.app.FindAllRecords("crew_tasks")
	if err != nil || len(tasks) != 2 {
		t.Fatalf("throttled mutation executed: tasks=%d err=%v", len(tasks), err)
	}
	now = now.Add(10 * time.Millisecond) // exactly one operation replenishes
	request("/api/crew/read", read, 200)
	request("/api/crew/agent-write", write, 429)
	now = now.Add(time.Second)
	request("/api/crew/agent-write", write, 200)
	tasks, err = a.app.FindAllRecords("crew_tasks")
	if err != nil || len(tasks) != 3 {
		t.Fatalf("cooldown recovery: tasks=%d err=%v", len(tasks), err)
	}
}
