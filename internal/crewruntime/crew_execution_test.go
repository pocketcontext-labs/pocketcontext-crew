package crewruntime

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
	run = executionOperation(t, a, "execution.dispatched", run["id"].(string), int(run["revision"].(float64)), map[string]any{"worker_id": "dispatcher", "fence": dispatcherFence, "sent": true}, "sent", false, 200)
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

func TestExecutionGovernanceBeforeAcquireAndOwnerRelease(t *testing.T) {
	a, _, task, event := webhookFixture(t)
	if task.GetInt("execution_required_generation") != task.GetInt("wake_generation") {
		t.Fatal("wake did not establish governance")
	}
	write := func(action string, data map[string]any, status int) map[string]any {
		current, _ := a.app.FindRecordById("crew_tasks", task.Id)
		return executionOperation(t, a, action, task.Id, current.GetInt("revision"), data, "", false, status)
	}
	write("task.comment", map[string]any{"body": "must not bypass acquire"}, 409)
	write("task.update", map[string]any{"status": "done"}, 409)
	write("review.request", map[string]any{}, 409)
	plain := executionOperation(t, a, "task.create", "", 0, map[string]any{"title": "Ordinary ungoverned task"}, "", false, 200)
	executionOperation(t, a, "task.comment", plain["id"].(string), int(plain["revision"].(float64)), map[string]any{"body": "ordinary MCP work still works"}, "", false, 200)
	begin := map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "role": "dispatcher", "worker_id": "self-worker"}
	run := executionOperation(t, a, "execution.begin", "", 0, begin, "begin-self", false, 200)
	if run["state"] != "running" || run["next_step"] != "self_work" || run["acquired_at"] == "" || run["task"] != task.Id {
		t.Fatal("begin did not atomically start self work", run)
	}
	proof := map[string]any{"id": run["id"], "worker_id": "self-worker", "fence": run["fence"]}
	raw, _ := json.Marshal(map[string]any{"action": "task.update", "id": task.Id, "expected_revision": task.GetInt("revision"), "data": map[string]any{"readiness": "waiting"}, "execution": proof})
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 200)
	// A worker cannot invalidate its own generation and then omit proof.
	write("task.comment", map[string]any{"body": "stale fallback"}, 409)
	saved, _ := a.app.FindRecordById("crew_tasks", task.Id)
	executionOperation(t, a, "task.update", task.Id, saved.GetInt("revision"), map[string]any{"readiness": "waiting"}, "", true, 200)
	saved, _ = a.app.FindRecordById("crew_tasks", task.Id)
	if saved.GetInt("execution_required_generation") != 0 {
		t.Fatal("explicit owner waiting did not release governance")
	}
	write("task.comment", map[string]any{"body": "owner released ordinary work"}, 200)
}

func TestExecutionBeginRequiresRuntimeHandoffAndWaitDeadline(t *testing.T) {
	a, config, _, _ := webhookFixture(t)
	recipient := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Synthetic recipient"}, "")
	webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": recipient["id"], "bot_ref": "recipient-native-id"}, "")
	task := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Recipient task", "assigned_agent": recipient["id"], "readiness": "ready"}, "")
	event, err := a.app.FindFirstRecordByFilter("crew_webhook_deliveries", "task={:task}", map[string]any{"task": task["id"]})
	if err != nil {
		t.Fatal(err)
	}
	d := map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "role": "dispatcher", "worker_id": "dispatcher"}
	executionOperation(t, a, "execution.begin", "", 0, d, "missing-native", false, 409)
	d["native_handoff"] = false
	executionOperation(t, a, "execution.begin", "", 0, d, "false-native", false, 409)
	before, _ := a.app.FindRecordsByFilter("crew_webhook_executions", "task={:task}", "", 0, 0, map[string]any{"task": task["id"]})
	if len(before) != 0 {
		t.Fatal("unsupported dispatch created execution")
	}
	d["native_handoff"] = true
	run := executionOperation(t, a, "execution.begin", "", 0, d, "native", false, 200)
	if run["state"] != "handed_off" || run["next_step"] != "handoff" || run["handoff_at"] != "" || run["handoff_deadline_at"] == "" || run["recipient_agent_id"] != recipient["id"] || run["dispatcher_agent_id"] != config.GetString("agent") {
		t.Fatal("bad prepared handoff", run)
	}
	executionOperation(t, a, "execution.dispatched", run["id"].(string), int(run["revision"].(float64)), map[string]any{"worker_id": "dispatcher", "fence": run["fence"]}, "unsent", false, 400)
	run = executionOperation(t, a, "execution.dispatched", run["id"].(string), int(run["revision"].(float64)), map[string]any{"worker_id": "dispatcher", "fence": run["fence"], "sent": true, "message_ref": "synthetic-message"}, "sent-native", false, 200)
	if run["handoff_at"] == "" || run["handoff_message_ref"] != "synthetic-message" {
		t.Fatal("missing reported evidence")
	}
	stored, _ := a.app.FindRecordById("crew_webhook_executions", run["id"].(string))
	stored.Set("handoff_deadline_at", time.Now().Add(-time.Second).UTC().Format(time.RFC3339))
	if err := a.app.Save(stored); err != nil {
		t.Fatal(err)
	}
	d = map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "role": "recipient", "worker_id": "recipient"}
	executionOperation(t, a, "execution.begin", "", 0, d, "late-recipient", false, 409)
	executionOperation(t, a, "execution.recover", stored.Id, stored.GetInt("revision"), map[string]any{"resolution": "retry"}, "owner-recovery", true, 200)
	run = executionOperation(t, a, "execution.begin", "", 0, d, "reconciled-recipient", false, 200)
	if run["state"] != "running" || run["next_step"] != "work" || run["handoff_deadline_at"] != "" || run["acquired_at"] == "" {
		t.Fatal("recipient did not acquire recovered work", run)
	}
	executionOperation(t, a, "execution.begin", "", 0, d, "duplicate-recipient", false, 409)
}

func TestExecutionReassignmentFencesOldWorkerAndNewGenerationBeforeAcquire(t *testing.T) {
	a, _, task, event := webhookFixture(t)
	begin := map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "role": "dispatcher", "worker_id": "original-worker"}
	run := executionOperation(t, a, "execution.begin", "", 0, begin, "original", false, 200)
	recipient := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Replacement recipient"}, "")
	webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": recipient["id"], "bot_ref": "replacement-native-id"}, "")
	updated := webhookOperation(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"assigned_agent": recipient["id"]}, "")
	executionOperation(t, a, "execution.begin", "", 0, begin, "old-event", false, 409)
	raw, _ := json.Marshal(map[string]any{"action": "task.comment", "id": task.Id, "expected_revision": updated["revision"], "data": map[string]any{"body": "old worker"}, "execution": run["execution"]})
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 409)
	executionOperation(t, a, "task.comment", task.Id, int(updated["revision"].(float64)), map[string]any{"body": "new worker without acquire"}, "", false, 409)
	latest, err := a.app.FindFirstRecordByFilter("crew_webhook_deliveries", "task={:task} && generation={:generation}", map[string]any{"task": task.Id, "generation": updated["wake_generation"]})
	if err != nil {
		t.Fatal(err)
	}
	begin["event_id"] = latest.GetString("event_id")
	begin["generation"] = latest.GetInt("generation")
	begin["worker_id"] = "current-dispatcher"
	begin["native_handoff"] = true
	next := executionOperation(t, a, "execution.begin", "", 0, begin, "new-event", false, 200)
	if next["next_step"] != "handoff" || next["recipient_agent_id"] != recipient["id"] {
		t.Fatal("reassignment did not use current routing", next)
	}
}
