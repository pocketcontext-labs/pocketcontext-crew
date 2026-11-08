package crewruntime

import "testing"

func TestExecutionBeginReplayNeverAuthorizesAnotherSend(t *testing.T) {
	a, _, _, _ := webhookFixture(t)
	recipient := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Replay recipient"}, "")
	webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": recipient["id"], "bot_ref": "replay-recipient"}, "")
	task := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Replay task", "assigned_agent": recipient["id"], "readiness": "ready"}, "")
	event := apiWebhookDeliveries(t, a, task["id"].(string))[0]
	data := map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "role": "dispatcher", "worker_id": "original-dispatcher", "native_handoff": true}
	run := executionOperation(t, a, "execution.begin", "", 0, data, "begin-replay", false, 200)
	if run["next_step"] != "handoff" {
		t.Fatal(run)
	}
	check := func(state string) {
		t.Helper()
		replay := executionOperation(t, a, "execution.begin", "", 0, data, "begin-replay", false, 200)
		if replay["next_step"] != "reconcile" || replay["replayed"] != true || replay["state"] != state || replay["execution"] != nil || replay["recipient_bot_ref"] != nil {
			t.Fatal("replay granted stale authority", replay)
		}
	}
	check("handed_off")
	work := executionOperation(t, a, "execution.begin", "", 0, map[string]any{"event_id": data["event_id"], "epoch": data["epoch"], "generation": data["generation"], "role": "recipient", "worker_id": "recipient"}, "recipient-replay", false, 200)
	check("running")
	executionOperation(t, a, "execution.complete", work["id"].(string), int(work["revision"].(float64)), map[string]any{"worker_id": "recipient", "fence": work["fence"], "outcome": "completed"}, "complete-replay", false, 200)
	check("completed")
	// Changing eligibility cannot turn the historical begin result back into send authority.
	webhookOperation(t, a, "task.update", task["id"].(string), int(task["revision"].(float64)), map[string]any{"readiness": "waiting"}, "")
	check("completed")
}
