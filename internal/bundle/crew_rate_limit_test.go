package bundle

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/hook"
)

// Crew uses custom operations rather than record-create routes. Its read and
// write requests must share the authenticated budget without relaxing authority.
func TestHostedCrewBurstAndAuthority(t *testing.T) {
	a := newTestApp(t)
	a.user.SetEmail("owner@example.test")
	if err := a.app.Save(a.user); err != nil {
		t.Fatal(err)
	}
	if err := configureHosted(a.app, "knowledge.example.com", syntheticHostedConfig(), false); err != nil {
		t.Fatal(err)
	}
	token, err := a.user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	a.token = token
	router, err := apis.NewRouter(a.app)
	if err != nil {
		t.Fatal(err)
	}
	local := &localRoutes{p: &Project{Config: Config{Port: 8096}}, hosted: true, publicURL: "https://knowledge.example.com"}
	local.register(&core.ServeEvent{App: a.app, Router: router})
	if err := a.app.OnServe().Trigger(&core.ServeEvent{App: a.app, Router: router}); err != nil {
		t.Fatal(err)
	}
	raw, err := router.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	public := publicHandlerMode(a.app, "knowledge.example.com", raw, true)
	request := func(handler http.Handler, path string, body any, token string) *httptest.ResponseRecorder {
		payload, err := json.Marshal(body)
		if err != nil {
			panic(err)
		}
		r := httptest.NewRequest("POST", "https://knowledge.example.com"+path, bytes.NewReader(payload))
		r.RemoteAddr = "192.0.2.1:0" // All MCP requests share this synthetic transport address.
		r = r.WithContext(context.WithValue(r.Context(), publicContextKey{}, true))
		r.Header.Set("Authorization", token)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	operation := func(action string, data any) map[string]any {
		return map[string]any{"action": action, "reported_agent": "Synthetic worker", "data": data}
	}
	start := make(chan struct{})
	failures := make(chan error, 8)
	var workers sync.WaitGroup
	for worker := range 8 {
		workers.Add(1)
		go func(worker int) {
			defer workers.Done()
			<-start
			for i := range 20 {
				body := operation("task.create", map[string]any{"title": fmt.Sprintf("Synthetic task %d-%d", worker, i)})
				for _, call := range []struct {
					path string
					body any
				}{{"/api/crew/agent-write", body}, {"/api/crew/read", map[string]any{"collection": "agents"}}} {
					w := request(public, call.path, call.body, a.token)
					if w.Code != 200 {
						failures <- fmt.Errorf("worker%d operation%d %s: %d %s", worker, i, call.path, w.Code, w.Body)
						return
					}
				}
			}
		}(worker)
	}
	close(start)
	workers.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	if t.Failed() {
		return
	}
	tasks, err := a.app.FindAllRecords("crew_tasks")
	if err != nil || len(tasks) != 160 {
		t.Fatalf("tasks=%d err=%v", len(tasks), err)
	}
	call := func(path string, body any, want int) map[string]any {
		t.Helper()
		w := request(public, path, body, a.token)
		if w.Code != want {
			t.Fatalf("%s: %d %s want%d", path, w.Code, w.Body, want)
		}
		var out map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	task := call("/api/crew/agent-write", operation("task.create", map[string]any{"title": "Review boundary", "draft": "Exact synthetic draft"}), 200)
	args := operation("task.update", map[string]any{"draft": "Revised synthetic draft"})
	args["id"], args["expected_revision"] = task["id"], task["revision"]
	revised := call("/api/crew/agent-write", args, 200)
	call("/api/crew/agent-write", args, 409)
	args = operation("review.request", map[string]any{})
	args["id"], args["expected_revision"] = revised["id"], revised["revision"]
	review := call("/api/crew/agent-write", args, 200)
	args = operation("review.decide", map[string]any{"decision": "approved"})
	args["id"], args["expected_revision"], args["reported_agent"] = review["id"], review["revision"], "owner"
	call("/api/crew/agent-write", args, 403)
	approved := call("/api/crew/write", args, 200)
	if approved["status"] != "approved" || approved["draft"] != "Revised synthetic draft" {
		t.Fatalf("owner decision: %v", approved)
	}
	for _, path := range []string{"/api/crew/read", "/api/crew/agent-write", "/api/crew/write"} {
		w := request(public, path, map[string]any{}, "")
		if w.Code != 401 {
			t.Fatalf("anonymous %s: %d", path, w.Code)
		}
	}
	// Even authenticated internal dispatch cannot bypass custom Crew operations.
	body := map[string]any{"title": "Forbidden raw task"}
	w := request(raw, "/api/collections/crew_tasks/records", body, a.token)
	if w.Code != 403 {
		t.Fatalf("generic write: %d %s", w.Code, w.Body)
	}
	w = request(raw, "/api/batch", map[string]any{"requests": []any{map[string]any{"method": "POST", "url": "/api/collections/crew_tasks/records", "body": body}}}, a.token)
	if w.Code != 400 {
		t.Fatalf("generic batch: %d %s", w.Code, w.Body)
	}
	var batch map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &batch); err != nil {
		t.Fatal(err)
	}
	response := batch["data"].(map[string]any)["requests"].(map[string]any)["0"].(map[string]any)["response"].(map[string]any)
	if response["status"] != float64(403) {
		t.Fatalf("generic batch bypass: %v", response)
	}
}

func TestHostedCrewSharedBudgetAndCooldown(t *testing.T) {
	a := newTestApp(t)
	configureHostedRateLimits(a.app)
	router, err := apis.NewRouter(a.app)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	registerHostedRateLimitsClock(&core.ServeEvent{App: a.app, Router: router}, func() time.Time { return now })
	// Consume batch reservations without database work, then exercise real Crew
	// routes at the boundary. Time is frozen so slow CI cannot replenish budget.
	router.Bind(&hook.Handler[*core.RequestEvent]{Id: "budgetProbe", Priority: apis.DefaultLoadAuthTokenMiddlewarePriority + 7, Func: func(e *core.RequestEvent) error {
		if e.Request.URL.Path == "/api/batch" {
			return e.NoContent(204)
		}
		return e.Next()
	}})
	if err := a.app.OnServe().Trigger(&core.ServeEvent{App: a.app, Router: router}); err != nil {
		t.Fatal(err)
	}
	handler, err := router.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	request := func(path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest("POST", "https://knowledge.example.com"+path, strings.NewReader(body))
		r.Header.Set("Authorization", a.token)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s: %d %s want%d", path, w.Code, w.Body, want)
		}
		return w
	}
	for range 59 {
		request("/api/batch", "{}", 204)
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
