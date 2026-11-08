package appconfig

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/pocketcontext-labs/pocketcontext-core/appserver"
)

// Crew uses custom operations rather than record-create routes. On the hosted
// public handler its read and write requests must share the authenticated
// budget without relaxing authority.
func TestHostedCrewBurstAndAuthority(t *testing.T) {
	a := newTestApp(t)
	setOwnerEmail(t, a)
	token, err := a.user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	server, err := Runtime.NewTestServer(a.app, appserver.TestServerOptions{Domain: syntheticDomain, Hosted: true, HostedConfig: syntheticHostedConfig(), Cache: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	public, raw := server.Public(), server.Router()
	request := func(handler http.Handler, path string, body any, token string) *httptest.ResponseRecorder {
		payload, err := json.Marshal(body)
		if err != nil {
			panic(err)
		}
		r := httptest.NewRequest("POST", "https://knowledge.example.com"+path, bytes.NewReader(payload))
		r.RemoteAddr = "192.0.2.1:0" // All MCP requests share this synthetic transport address.
		r = server.MarkPublic(r)
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
					w := request(public, call.path, call.body, token)
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
		w := request(public, path, body, token)
		if w.Code != want {
			t.Fatalf("%s: %d %s want %d", path, w.Code, w.Body, want)
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
		if w := request(public, path, map[string]any{}, ""); w.Code != 401 {
			t.Fatalf("anonymous %s: %d", path, w.Code)
		}
	}
	// Even authenticated internal dispatch cannot bypass custom Crew operations.
	body := map[string]any{"title": "Forbidden raw task"}
	if w := request(raw, "/api/collections/crew_tasks/records", body, token); w.Code != 403 {
		t.Fatalf("generic write: %d %s", w.Code, w.Body)
	}
	if w := request(raw, "/api/batch", map[string]any{"requests": []any{map[string]any{"method": "POST", "url": "/api/collections/crew_tasks/records", "body": body}}}, token); w.Code != 403 {
		t.Fatalf("generic batch: %d %s", w.Code, w.Body)
	}
}
