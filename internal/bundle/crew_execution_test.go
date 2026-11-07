package bundle

import (
	"encoding/json"
	"testing"
	"time"
)

func executionOperation(t *testing.T, a *testApp, action, id string, revision int, data map[string]any, key string, owner bool, status int) map[string]any {
	t.Helper()
	b := map[string]any{"action": action, "data": data, "idempotency_key": key}
	if id != "" {
		b["id"] = id
		b["expected_revision"] = revision
	}
	raw, _ := json.Marshal(b)
	route := "/api/crew/agent-write"
	if owner {
		route = "/api/crew/write"
	}
	return a.request(t, "POST", route, a.token, string(raw), status)
}
func TestExecutionSerializesHandoffsAndFencesWrites(t *testing.T) {
	a, _, task, event := webhookFixture(t)
	data := map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "phase": "dispatch", "worker_id": "dispatch-one"}
	run := executionOperation(t, a, "execution.acquire", "", 0, data, "acquire-one", false, 200)
	replay := executionOperation(t, a, "execution.acquire", "", 0, data, "acquire-one", false, 200)
	if run["id"] != replay["id"] || run["fence"] != replay["fence"] {
		t.Fatal("acquire replay changed lease", replay)
	}
	executionOperation(t, a, "execution.acquire", "", 0, data, "acquire-duplicate", false, 409)
	// A normal MCP task mutation cannot bypass an unresolved execution lease.
	raw, _ := json.Marshal(map[string]any{"action": "task.comment", "id": task.Id, "expected_revision": task.GetInt("revision"), "data": map[string]any{"body": "unfenced"}})
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 409)
	proof := map[string]any{"worker_id": "dispatch-one", "fence": run["fence"]}
	run = executionOperation(t, a, "execution.start", run["id"].(string), int(run["revision"].(float64)), proof, "start", false, 200)
	raw, _ = json.Marshal(map[string]any{"action": "task.comment", "id": task.Id, "expected_revision": task.GetInt("revision"), "data": map[string]any{"body": "pong"}, "idempotency_key": "pong-once", "execution": map[string]any{"id": run["id"], "worker_id": "dispatch-one", "fence": run["fence"]}})
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 200)
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 200)
	comments, err := a.app.FindRecordsByFilter("crew_events", "parent={:task} && action='task.comment'", "", 10, 0, map[string]any{"task": task.Id})
	if err != nil || len(comments) != 1 {
		t.Fatal("comment replay duplicated pong", len(comments), err)
	}
	result := executionOperation(t, a, "execution.complete", run["id"].(string), int(run["revision"].(float64)), map[string]any{"worker_id": "dispatch-one", "fence": run["fence"], "outcome": "completed", "mark_done": true, "task_revision": task.GetInt("revision")}, "complete", false, 200)
	if result["state"] != "completed" {
		t.Fatal(result)
	}
	saved, _ := a.app.FindRecordById("crew_tasks", task.Id)
	if saved.GetString("status") != "done" {
		t.Fatal("task not atomically completed")
	}
	executionOperation(t, a, "execution.acquire", "", 0, data, "reacquire", false, 409)
}
func TestExecutionExpiredLeaseRequiresRecovery(t *testing.T) {
	a, _, _, event := webhookFixture(t)
	data := map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "phase": "work", "worker_id": "worker-one"}
	run := executionOperation(t, a, "execution.acquire", "", 0, data, "first", false, 200)
	stored, _ := a.app.FindRecordById("crew_webhook_executions", run["id"].(string))
	stored.Set("lease_until", time.Now().Add(-time.Minute).UTC().Format(time.RFC3339))
	if err := a.app.Save(stored); err != nil {
		t.Fatal(err)
	}
	executionOperation(t, a, "execution.acquire", "", 0, data, "expired", false, 409)
	executionOperation(t, a, "execution.recover", stored.Id, stored.GetInt("revision"), map[string]any{"resolution": "retry"}, "forbidden-recovery", false, 403)
	recovered := executionOperation(t, a, "execution.recover", stored.Id, stored.GetInt("revision"), map[string]any{"resolution": "retry"}, "recovery", true, 200)
	executionOperation(t, a, "execution.recover", stored.Id, stored.GetInt("revision"), map[string]any{"resolution": "retry"}, "recovery", false, 403)
	if recovered["state"] != "handed_off" {
		t.Fatal(recovered)
	}
	data["worker_id"] = "worker-two"
	next := executionOperation(t, a, "execution.acquire", "", 0, data, "second", false, 200)
	if next["fence"].(float64) <= run["fence"].(float64) {
		t.Fatal("fence not advanced")
	}
	executionOperation(t, a, "execution.renew", stored.Id, int(next["revision"].(float64)), map[string]any{"worker_id": "worker-one", "fence": run["fence"]}, "old-renew", false, 409)
}
func TestExecutionRejectsStaleAndTestWork(t *testing.T) {
	a, config, task, event := webhookFixture(t)
	validation := map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation")}
	executionOperation(t, a, "execution.validate", "", 0, validation, "validate", false, 200)
	webhookOperation(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"readiness": "waiting"}, "")
	executionOperation(t, a, "execution.validate", "", 0, validation, "validate", false, 409)
	data := map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "phase": "work", "worker_id": "worker"}
	executionOperation(t, a, "execution.acquire", "", 0, data, "stale", false, 409)
	test := webhookOperation(t, a, "webhook.test", config.Id, config.GetInt("revision"), map[string]any{}, "test-execution")
	ack := executionOperation(t, a, "execution.test_ack", "", 0, map[string]any{"event_id": test["event_id"], "epoch": test["epoch"]}, "ack", false, 200)
	if ack["state"] != "test_acknowledged" {
		t.Fatal(ack)
	}
	data["event_id"] = test["event_id"]
	data["epoch"] = test["epoch"]
	data["generation"] = 0
	executionOperation(t, a, "execution.acquire", "", 0, data, "test-work", false, 409)
}

func TestExecutionFastRecipientAndLateDispatchReport(t *testing.T) {
	a, _, _, event := webhookFixture(t)
	data := map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "phase": "dispatch", "worker_id": "dispatcher"}
	run := executionOperation(t, a, "execution.acquire", "", 0, data, "route", false, 200)
	dispatcherFence := run["fence"]
	run = executionOperation(t, a, "execution.handoff", run["id"].(string), int(run["revision"].(float64)), map[string]any{"worker_id": "dispatcher", "fence": dispatcherFence}, "prepare", false, 200)
	if run["handoff_at"] != "" {
		t.Fatal("prepared handoff falsely reported sent")
	}
	data["phase"] = "work"
	data["worker_id"] = "recipient"
	run = executionOperation(t, a, "execution.acquire", "", 0, data, "fast-recipient", false, 200)
	workerFence := run["fence"]
	run = executionOperation(t, a, "execution.dispatched", run["id"].(string), int(run["revision"].(float64)), map[string]any{"worker_id": "dispatcher", "fence": dispatcherFence}, "sent", false, 200)
	if run["state"] != "running" || run["handoff_at"] == "" || run["fence"] != workerFence {
		t.Fatal("late report disrupted worker", run)
	}
	executionOperation(t, a, "execution.renew", run["id"].(string), int(run["revision"].(float64)), map[string]any{"worker_id": "recipient", "fence": workerFence}, "renew", false, 200)
}

func TestExecutionReviewTransitionInvalidatesAndReopens(t *testing.T) {
	a, _, task, event := webhookFixture(t)
	data := map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "phase": "work", "worker_id": "worker"}
	run := executionOperation(t, a, "execution.acquire", "", 0, data, "work", false, 200)
	proof := map[string]any{"id": run["id"], "worker_id": "worker", "fence": run["fence"]}
	raw, _ := json.Marshal(map[string]any{"action": "task.update", "id": task.Id, "expected_revision": task.GetInt("revision"), "data": map[string]any{"draft": "Synthetic review draft"}, "execution": proof})
	updated := a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 200)
	raw, _ = json.Marshal(map[string]any{"action": "review.request", "id": task.Id, "expected_revision": updated["revision"], "data": map[string]any{}, "execution": proof})
	review := a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 200)
	prior, _ := a.app.FindRecordById("crew_webhook_executions", run["id"].(string))
	if prior.GetString("state") != "invalidated" {
		t.Fatal("review left execution locked")
	}
	raw, _ = json.Marshal(map[string]any{"action": "review.decide", "id": review["id"], "expected_revision": review["revision"], "data": map[string]any{"decision": "approved"}})
	a.request(t, "POST", "/api/crew/write", a.token, string(raw), 200)
	events, err := a.app.FindRecordsByFilter("crew_webhook_deliveries", "task={:task}", "-created", 10, 0, map[string]any{"task": task.Id})
	if err != nil || len(events) < 2 {
		t.Fatal("review outcome did not wake", err, len(events))
	}
	latest := events[0]
	data["event_id"] = latest.GetString("event_id")
	data["epoch"] = latest.GetString("epoch")
	data["generation"] = latest.GetInt("generation")
	executionOperation(t, a, "execution.acquire", "", 0, data, "after-review", false, 200)
}
