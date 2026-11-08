package crewruntime

import (
	"encoding/json"
	"testing"
)

// Synthetic native-tool stages exercise the real API; no external bot is contacted.
func TestBridgeReadyTaskCompletesOnlyWithRecipientProof(t *testing.T) {
	a, c, event, recipient := parentBridgeFixture(t, true)
	bridge := bridgeParent(t, a, bridgePrepare(t, a, event, "setup-wake"), "setup-parent")
	executionOperation(t, a, "webhook.bridge.ack", bridge["id"].(string), int(bridge["revision"].(float64)), map[string]any{"recipient_agent_id": recipient, "automatic": true}, "setup-recipient", false, 200)
	webhookOperation(t, a, "webhook.enable", c.Id, c.GetInt("revision"), nil, "")
	task := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Synthetic bridge completion", "assigned_agent": recipient, "readiness": "ready"}, "")
	delivery := apiWebhookDeliveries(t, a, task["id"].(string))[0]
	event = map[string]any{"event_id": delivery.GetString("event_id"), "epoch": delivery.GetString("epoch")}
	bridgeParent(t, a, bridgePrepare(t, a, event, "task-wake"), "task-parent")
	data := map[string]any{"event_id": event["event_id"], "epoch": event["epoch"], "generation": delivery.GetInt("generation"), "role": "dispatcher", "worker_id": "parent", "native_handoff": true}
	run := executionOperation(t, a, "execution.begin", "", 0, data, "dispatch", false, 200)
	dispatchFence := run["fence"]
	// Neither the earlier test acknowledgment nor a prepared send grants task-write authority.
	executionOperation(t, a, "task.comment", task["id"].(string), int(task["revision"].(float64)), map[string]any{"body": "unfenced"}, "unfenced", false, 409)
	data["role"], data["worker_id"] = "recipient", "recipient"
	run = executionOperation(t, a, "execution.begin", "", 0, data, "recipient-start", false, 200)
	if run["next_step"] != "work" {
		t.Fatal(run)
	}
	workerFence := run["fence"]
	run = executionOperation(t, a, "execution.dispatched", run["id"].(string), int(run["revision"].(float64)), map[string]any{"worker_id": "parent", "fence": dispatchFence, "sent": true}, "late-sent", false, 200)
	if run["fence"] != workerFence || run["state"] != "running" {
		t.Fatal("late send changed worker authority", run)
	}
	comment := map[string]any{"action": "task.comment", "id": task["id"], "expected_revision": task["revision"], "data": map[string]any{"body": "synthetic pong"}, "idempotency_key": "pong", "execution": map[string]any{"id": run["id"], "worker_id": "recipient", "fence": workerFence}}
	raw, _ := json.Marshal(comment)
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 200)
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 200)
	run = executionOperation(t, a, "execution.complete", run["id"].(string), int(run["revision"].(float64)), map[string]any{"worker_id": "recipient", "fence": workerFence, "outcome": "completed", "mark_done": true, "task_revision": task["revision"]}, "complete", false, 200)
	if run["state"] != "completed" || apiWebhookRecord(t, a, "tasks", task["id"].(string)).GetString("status") != "done" {
		t.Fatal("bridge work did not complete atomically", run)
	}
	comments, err := a.app.FindRecordsByFilter("crew_events", "parent={:task} && action='task.comment'", "", 0, 0, map[string]any{"task": task["id"]})
	if err != nil || len(comments) != 1 {
		t.Fatal("duplicate comment", len(comments), err)
	}
}

func TestBridgeDiagnosticCannotBypassDisabledTaskExecution(t *testing.T) {
	a, _, event, _ := parentBridgeFixture(t, false)
	bridgeParent(t, a, bridgePrepare(t, a, event, "wake"), "parent")
	data := map[string]any{"event_id": event["event_id"], "epoch": event["epoch"], "generation": 0, "role": "dispatcher", "worker_id": "test-worker", "native_handoff": true}
	executionOperation(t, a, "execution.begin", "", 0, data, "no-test-work", false, 409)
}
