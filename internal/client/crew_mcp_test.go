package client

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCrewMCPAuthorityBoundary(t *testing.T) {
	for _, path := range []string{"/api/crew/write", "/api/crew/write/", "/api/collections/crew_reviews/records", "/api/collections/crew_notes/records"} {
		for _, method := range []string{"POST", "PATCH", "DELETE"} {
			if mcpAPIAllowed(method, path) {
				t.Errorf("MCP exposes owner/raw route %s %s", method, path)
			}
		}
	}
	if !mcpAPIAllowed("POST", "/api/crew/read") || !mcpAPIAllowed("POST", "/api/crew/agent-write") {
		t.Fatal("Crew agent routes unavailable")
	}
	calls := 0
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/api/crew/agent-write" {
			t.Fatalf("Crew write escaped agent route: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "synthetic" {
			t.Fatal("Authenticated principal was not forwarded")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["action"] == "review.decide" {
			http.Error(w, "Owner action required", http.StatusForbidden)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "syntheticrecord", "action": body["action"]})
	})
	h := mcpTestHandler(api)
	mcpCall(t, h, "synthetic", "crew_write", map[string]any{"action": "task.create", "reported_agent": "Network", "data": map[string]any{"title": "Synthetic"}}, false)
	mcpCall(t, h, "synthetic", "crew_write", map[string]any{"action": "review.decide", "reported_agent": "owner", "data": map[string]any{"decision": "approved"}}, true)
	if calls != 2 {
		t.Fatalf("got %d API calls", calls)
	}
}

// This uses the real API and JS hooks. The MCP harness injects the ordinary
// principal supplied by OAuth; bundle's OAuth suite separately checks exchange,
// audience binding, revocation and conversion of external grants to that identity.
func TestCrewMCPRealWorkflowAndApprovalBoundary(t *testing.T) {
	api, token := mcpRealAPI(t)
	h := mcpTestHandler(api)
	call := func(name string, args map[string]any) any { return mcpCall(t, h, token, name, args, false) }
	denied := func(name string, args map[string]any) { mcpCall(t, h, token, name, args, true) }
	writeArgs := func(action string, record any, data map[string]any) map[string]any {
		args := map[string]any{"action": action, "reported_agent": "Network", "reason": "Synthetic MCP rehearsal", "data": data}
		if record != nil {
			args["id"] = dig(record, "id")
			args["expected_revision"] = dig(record, "revision")
		}
		return args
	}
	write := func(action string, record any, data map[string]any) any {
		return call("crew_write", writeArgs(action, record, data))
	}
	read := func(collection string, filter map[string]any) []any {
		args := map[string]any{"collection": collection}
		for k, v := range filter {
			args[k] = v
		}
		return dig(call("crew_read", args), "items").([]any)
	}
	owner := func(args map[string]any) any {
		payload, _ := json.Marshal(args)
		req := httptest.NewRequest("POST", "http://knowledge.example.com/api/crew/write", bytes.NewReader(payload))
		req.Header.Set("Authorization", token)
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		api.ServeHTTP(response, req)
		if response.Code != 200 {
			t.Fatalf("owner request: %d %s", response.Code, response.Body)
		}
		var result any
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	agent := write("agent.create", nil, map[string]any{"name": "Network"})
	bucket := write("bucket.create", nil, map[string]any{"name": "NETWORK", "responsible_agent": dig(agent, "id")})

	otherAgent := write("agent.create", nil, map[string]any{"name": "Design"})
	oldBucket := bucket
	bucket = write("bucket.assign", bucket, map[string]any{"agent": "Design"})
	if dig(bucket, "responsible_agent") != dig(otherAgent, "id") {
		t.Fatal("MCP assignment did not resolve exact name")
	}
	rows := read("buckets", map[string]any{"responsible_agent": "Design"})
	if len(rows) != 1 || dig(rows[0], "responsible_agent_details", "id") != dig(otherAgent, "id") || dig(rows[0], "responsible_agent_details", "name") != "Design" {
		t.Fatal("MCP assignment read round-trip lost expanded agent")
	}
	denied("crew_write", writeArgs("bucket.assign", oldBucket, map[string]any{"agent": dig(agent, "id")}))
	denied("crew_write", writeArgs("bucket.assign", bucket, map[string]any{}))
	denied("crew_write", writeArgs("bucket.assign.extra", bucket, map[string]any{"agent": dig(agent, "id")}))
	denied("crew_write", writeArgs("bucket.assign", bucket, map[string]any{"agent": "Missing agent"}))
	bucket = write("bucket.update", bucket, map[string]any{"responsible_agent": nil})
	if dig(bucket, "responsible_agent") != "" || dig(bucket, "responsible_agent_details") != nil {
		t.Fatal("MCP clear failed")
	}
	if len(read("buckets", map[string]any{"responsible_agent": ""})) != 1 {
		t.Fatal("MCP unassigned filter failed")
	}
	bucket = write("bucket.assign", bucket, map[string]any{"agent": dig(otherAgent, "id")})
	assignmentEvents := read("events", map[string]any{"parent": dig(bucket, "id")})
	found := false
	for _, ev := range assignmentEvents {
		if dig(ev, "action") == "bucket.assign" && dig(ev, "changes", "responsible_agent", "old") == dig(agent, "id") && dig(ev, "changes", "responsible_agent", "new") == dig(otherAgent, "id") && dig(ev, "reported_agent") == "Network" {
			found = true
		}
	}
	if !found {
		t.Fatal("MCP assignment event omitted old/new attribution")
	}
	// Reported Network continues to write into the bucket assigned to Design.
	note := write("note.create", nil, map[string]any{"bucket": dig(bucket, "id"), "title": "Synthetic launch voice", "body": "Speak to independent founders."})
	if len(read("notes", map[string]any{"query": "independent"})) != 1 {
		t.Fatal("MCP memory search omitted note")
	}
	archived := write("note.update", note, map[string]any{"archived": true})
	if len(read("notes", nil)) != 0 || len(read("notes", map[string]any{"archived": true})) != 1 {
		t.Fatal("MCP archive defaults leaked/missed notes")
	}
	note = write("note.update", archived, map[string]any{"archived": false})
	denied("crew_write", writeArgs("bucket.update", bucket, map[string]any{"archived": true}))
	bucket = owner(writeArgs("bucket.update", bucket, map[string]any{"archived": true}))
	denied("crew_write", writeArgs("bucket.assign", bucket, map[string]any{"agent": dig(agent, "id")}))
	if len(read("notes", nil)) != 0 {
		t.Fatal("Archived ancestor leaked notes through MCP")
	}
	denied("crew_write", writeArgs("note.update", note, map[string]any{"body": "Cannot change an archived bucket"}))
	bucket = owner(writeArgs("bucket.update", bucket, map[string]any{"archived": false}))
	if len(read("notes", nil)) != 1 {
		t.Fatal("Restoring bucket did not reveal active notes")
	}
	task := write("task.create", nil, map[string]any{"title": "Synthetic launch post", "draft": "Exact draft for review", "assigned_agent": dig(agent, "id")})
	review := write("review.request", task, map[string]any{})
	denied("crew_write", writeArgs("review.decide", review, map[string]any{"decision": "approved"}))
	forged := writeArgs("review.decide", review, map[string]any{"decision": "approved"})
	forged["reported_agent"] = "owner"
	denied("crew_write", forged)
	denied("create", map[string]any{"collection": "crew_reviews", "fields": map[string]any{"task": dig(task, "id"), "status": "approved"}})
	denied("update", map[string]any{"collection": "crew_reviews", "id": dig(review, "id"), "fields": map[string]any{"status": "approved"}})
	denied("batch", map[string]any{"requests": []any{map[string]any{"method": "PATCH", "url": "/api/collections/crew_reviews/records/" + dig(review, "id").(string), "body": map[string]any{"status": "approved"}}}})
	denied("batch", map[string]any{"requests": []any{map[string]any{"method": "POST", "url": "/api/crew/write", "body": forged}}})
	denied("query", map[string]any{"sql": "SELECT * FROM crew_reviews"})
	pending := read("reviews", map[string]any{"id": dig(review, "id")})
	if len(pending) != 1 || dig(pending[0], "status") != "pending" {
		t.Fatal("MCP forged decision changed review")
	}
	approved := owner(writeArgs("review.decide", review, map[string]any{"decision": "approved"}))
	if dig(approved, "draft") != "Exact draft for review" || dig(approved, "status") != "approved" {
		t.Fatal("Owner did not approve exact snapshot")
	}
	currentTask := read("tasks", map[string]any{"id": dig(task, "id")})[0]
	if dig(currentTask, "status") == "done" {
		t.Fatal("Approval falsely completed external action")
	}
	currentTask = write("task.update", currentTask, map[string]any{"draft": "A changed draft"})
	fresh := write("review.request", currentTask, map[string]any{})
	if dig(fresh, "status") != "pending" || dig(fresh, "draft") != "A changed draft" {
		t.Fatal("Changed draft reused approval")
	}
	prior := read("reviews", map[string]any{"id": dig(review, "id")})[0]
	if dig(prior, "draft") != "Exact draft for review" || dig(prior, "status") != "approved" {
		t.Fatal("Historical approval snapshot changed")
	}
}
