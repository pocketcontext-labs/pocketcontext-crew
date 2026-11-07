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

func TestCrewMCPWebhookReadinessAndIdempotency(t *testing.T) {
	api, token := mcpRealAPI(t)
	h := mcpTestHandler(api)
	write := func(args map[string]any, denied bool) any {
		args["reported_agent"] = "Synthetic Build"
		return mcpCall(t, h, token, "crew_write", args, denied)
	}
	ensure := map[string]any{"action": "agent.ensure", "idempotency_key": "synthetic-agent-1", "data": map[string]any{"name": "Synthetic Build"}}
	agent := write(ensure, false)
	replayed := write(ensure, false)
	if dig(agent, "id") != dig(replayed, "id") {
		t.Fatal("agent.ensure duplicated its result")
	}
	write(map[string]any{"action": "agent.ensure", "idempotency_key": "synthetic-agent-1", "data": map[string]any{"name": "Other"}}, true)
	task := write(map[string]any{"action": "task.create", "data": map[string]any{"title": "Synthetic immediate work", "assigned_agent": dig(agent, "id"), "readiness": "ready"}}, false)
	if dig(task, "readiness") != "ready" || dig(task, "wake_generation") != float64(1) {
		t.Fatalf("ready creation did not create a generation: %v", task)
	}
	update := func(record any, data map[string]any) any {
		return write(map[string]any{"action": "task.update", "id": dig(record, "id"), "expected_revision": dig(record, "revision"), "data": data}, false)
	}
	task = update(task, map[string]any{"description": "Ordinary metadata edit"})
	if dig(task, "wake_generation") != float64(1) {
		t.Fatal("ordinary edit changed generation")
	}
	task = update(task, map[string]any{"readiness": "waiting"})
	if dig(task, "wake_generation") != float64(2) {
		t.Fatal("waiting did not invalidate delivered generation")
	}
	task = update(task, map[string]any{"readiness": "ready", "draft": "Synthetic review draft"})
	write(map[string]any{"action": "review.request", "id": dig(task, "id"), "expected_revision": dig(task, "revision"), "data": map[string]any{}}, false)
	read := mcpCall(t, h, token, "crew_read", map[string]any{"collection": "tasks", "id": dig(task, "id")}, false)
	task = dig(read, "items").([]any)[0]
	if dig(task, "wake_generation") != float64(4) {
		t.Fatalf("review request did not invalidate generation: %v", task)
	}
	task = update(task, map[string]any{"draft": "Changed draft", "readiness": "ready"})
	if dig(task, "readiness") != "waiting" || dig(task, "wake_generation") != float64(5) {
		t.Fatalf("automatic withdrawal must remain waiting and invalidate: %v", task)
	}
	triageTask := write(map[string]any{"action": "task.create", "data": map[string]any{"title": "Synthetic triage", "readiness": "ready"}}, false)
	routingRead := mcpCall(t, h, token, "crew_read", map[string]any{"collection": "webhook_routing"}, false)
	routing := dig(routingRead, "items").([]any)[0]
	for _, target := range []any{dig(agent, "id"), nil, dig(agent, "id")} {
		routing = write(map[string]any{"action": "webhook.routing.update", "expected_revision": dig(routing, "revision"), "data": map[string]any{"triage_agent": target}}, false)
	}
	triageRead := mcpCall(t, h, token, "crew_read", map[string]any{"collection": "tasks", "id": dig(triageTask, "id")}, false)
	triageTask = dig(triageRead, "items").([]any)[0]
	if dig(triageTask, "wake_generation") != float64(4) {
		t.Fatalf("triage changes must invalidate old delivered generations: %v", triageTask)
	}
	write(map[string]any{"action": "webhook.create", "idempotency_key": "synthetic-private", "data": map[string]any{"agent": dig(agent, "id"), "url": "https://127.0.0.1/receiver", "adapter": "crew-v1", "subscriptions": []string{"ready"}, "secret": "synthetic"}}, true)
}

func TestCrewMCPGlobalIntegrationCredentialBoundary(t *testing.T) {
	api, token := mcpRealAPI(t)
	h := mcpTestHandler(api)
	read := func(collection string) []any {
		result := mcpCall(t, h, token, "crew_read", map[string]any{"collection": collection}, false)
		return dig(result, "items").([]any)
	}
	configs := read("webhook_configs")
	var config any
	for _, row := range configs {
		if dig(row, "scope") == "global" {
			config = row
		}
	}
	if config == nil {
		t.Fatal("global integration missing")
	}
	for _, key := range []string{"url", "secret", "secret_ciphertext"} {
		if _, ok := config.(map[string]any)[key]; ok {
			t.Fatalf("MCP config exposes %s", key)
		}
	}
	args := func(action string, row any, data map[string]any) map[string]any {
		a := map[string]any{"action": action, "data": data, "reported_agent": "Synthetic dispatcher"}
		if row != nil {
			a["id"] = dig(row, "id")
			a["expected_revision"] = dig(row, "revision")
		}
		return a
	}
	agent := mcpCall(t, h, token, "crew_write", args("agent.create", nil, map[string]any{"name": "Synthetic dispatcher"}), false)
	config = mcpCall(t, h, token, "crew_write", args("webhook.integration.update", config, map[string]any{"agent": dig(agent, "id")}), false)
	mcpCall(t, h, token, "crew_write", args("webhook.credentials.update", config, map[string]any{"url": "https://receiver.example.com/wake", "secret": "synthetic-private-key"}), true)
	mcpCall(t, h, token, "crew_write", args("webhook.integration.update", config, map[string]any{"secret": "synthetic-private-key"}), true)
	mcpCall(t, h, token, "crew_write", args("webhook.update", config, map[string]any{"secret": "synthetic-private-key"}), true)
	create := args("webhook.create", nil, map[string]any{"agent": dig(agent, "id"), "url": "https://receiver.example.com/wake", "secret": "synthetic-private-key", "adapter": "crew-v1", "subscriptions": []string{"ready"}})
	create["idempotency_key"] = "blocked-legacy-create"
	mcpCall(t, h, token, "crew_write", create, true)
	mcpCall(t, h, token, "crew_write", args("webhook.enable", config, map[string]any{}), true)
	mapping := args("webhook.mapping.update", nil, map[string]any{"agent": dig(agent, "id"), "bot_ref": "Synthetic Grok bot"})
	mapping["expected_revision"] = 0
	mcpCall(t, h, token, "crew_write", mapping, false)
	if len(read("webhook_mappings")) != 1 {
		t.Fatal("mapping not persisted")
	}
	if len(read("webhook_deliveries")) != 0 {
		t.Fatal("non-secret setup sent a webhook")
	}
}

func TestCrewDiscoveryAndCachedEnvelopeCompatibility(t *testing.T) {
	api, token := mcpRealAPI(t)
	h := mcpTestHandler(api)
	listed := mcpRequest(t, h, token, "tools/list", map[string]any{})
	raw, _ := json.Marshal(listed)
	for _, term := range []string{"capabilities", "execution.begin", "idempotency_key", "execution", "webhook_mappings", "webhook_executions"} {
		if !bytes.Contains(raw, []byte(term)) {
			t.Fatalf("tools/list omits %s", term)
		}
	}
	result := mcpCall(t, h, token, "crew_read", map[string]any{"collection": "capabilities"}, false)
	cap := dig(result, "items").([]any)[0]
	if dig(cap, "protocol_version") != float64(2) {
		t.Fatal(cap)
	}
	for _, action := range []string{"execution.begin", "execution.complete", "webhook.instructions.sync", "webhook.runtime.report", "webhook.mapping.update"} {
		if dig(cap, "operations", action) == nil {
			t.Fatalf("capabilities omit %s", action)
		}
	}
	// Model-visible old connector schema can send only these original arguments.
	args := map[string]any{"action": "agent.ensure", "reported_agent": "Synthetic legacy client", "data": map[string]any{"name": "Cached client bot", "_crew": map[string]any{"idempotency_key": "cached-ensure"}}}
	first := mcpCall(t, h, token, "crew_write", args, false)
	second := mcpCall(t, h, token, "crew_write", args, false)
	if dig(first, "id") != dig(second, "id") {
		t.Fatal("compatibility key lost idempotency")
	}
	args["idempotency_key"] = "contradictory-key"
	mcpCall(t, h, token, "crew_write", args, true)
	delete(args, "idempotency_key")
	args["data"].(map[string]any)["_crew"] = map[string]any{"owner": true}
	mcpCall(t, h, token, "crew_write", args, true)
	task := mcpCall(t, h, token, "crew_write", map[string]any{"action": "task.create", "reported_agent": "Synthetic", "data": map[string]any{"title": "Compatibility proof test"}}, false)
	// Normalization cannot turn malformed/stale proof into an ordinary unfenced write.
	mcpCall(t, h, token, "crew_write", map[string]any{"action": "task.comment", "reported_agent": "Synthetic", "id": dig(task, "id"), "expected_revision": dig(task, "revision"), "data": map[string]any{"body": "must not appear", "_crew": map[string]any{"idempotency_key": "invalid-proof", "execution": map[string]any{"id": "missingrecord00", "worker_id": "synthetic", "fence": 1}}}}, true)
	// Owner-only operation remains owner-only through the compatible envelope.
	configs := dig(mcpCall(t, h, token, "crew_read", map[string]any{"collection": "webhook_configs"}, false), "items").([]any)
	for _, c := range configs {
		if dig(c, "scope") == "global" {
			mcpCall(t, h, token, "crew_write", map[string]any{"action": "webhook.credentials.update", "reported_agent": "Synthetic", "id": dig(c, "id"), "expected_revision": dig(c, "revision"), "data": map[string]any{"secret": "synthetic-never-save", "_crew": map[string]any{"idempotency_key": "blocked-credential"}}}, true)
		}
	}
}
