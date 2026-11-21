package crewruntime

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBeginReturnsRecipientWorkflowOnlyToNewWorker(t *testing.T) {
	a, dispatcher, _, _ := webhookFixture(t)
	agent := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Synthetic analyst", "brief": "Initial private role"}, "")
	id := agent["id"].(string)
	webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": id, "bot_ref": "analyst-ref"}, "")
	sessionUpdate(t, a, true, 0, map[string]any{"agent": id, "instructions": "Initial private workflow"}, "", 200)
	task := newTask(t, a, map[string]any{"title": "Synthetic analysis", "assigned_agent": id, "readiness": "ready"})
	event := apiWebhookDeliveries(t, a, task["id"].(string))[0]
	data := map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "role": "dispatcher", "worker_id": "dispatcher-run", "native_handoff": true}
	handoff := executionOperation(t, a, "execution.begin", "", 0, data, "context-dispatch", false, 200)
	if handoff["next_step"] != "handoff" || handoff["agent_context"] != nil {
		t.Fatal("handoff unexpectedly includes workflow", handoff)
	}

	// The context is read at recipient acquisition, including changes made
	// after the event was emitted and even after dispatch prepared the handoff.
	const brief = "Latest private analyst role"
	const workflow = "Latest private analyst workflow"
	crewWrite(t, a, false, "agent.update", id, int(agent["revision"].(float64)), map[string]any{"brief": brief}, 200)
	sessionUpdate(t, a, true, 1, map[string]any{"agent": id, "instructions": workflow}, "", 200)
	data["role"], data["worker_id"] = "recipient", "analyst-run"
	run := executionOperation(t, a, "execution.begin", "", 0, data, "context-recipient", false, 200)
	context, ok := run["agent_context"].(map[string]any)
	if !ok || run["next_step"] != "work" || dispatcher.GetString("agent") == id || context["agent_id"] != id ||
		context["name"] != "Synthetic analyst" || context["brief"] != brief || context["workflow"] != workflow || context["revision"] != float64(2) {
		t.Fatal("worker lacks the current recipient context", run)
	}
	for _, want := range []string{"takes precedence", "task.claim", "execution proof", "execution.renew", "owner’s approval"} {
		if !strings.Contains(context["execution_guidance"].(string), want) {
			t.Fatal("missing coordination guidance", want)
		}
	}
	replay := executionOperation(t, a, "execution.begin", "", 0, data, "context-recipient", false, 200)
	if replay["next_step"] != "reconcile" || replay["execution"] != nil || replay["agent_context"] != nil {
		t.Fatal("replay unexpectedly authorizes work or exposes context")
	}
	checkPrivate := func(raw string) {
		t.Helper()
		for _, forbidden := range []string{"agent_context", "Initial private role", "Initial private workflow", brief, workflow} {
			if strings.Contains(raw, forbidden) {
				t.Fatal("unexpected recipient context in transport or persistence", forbidden)
			}
		}
	}
	handoffJSON, _ := json.Marshal(handoff)
	checkPrivate(string(handoffJSON))
	checkPrivate(apiWebhookRecord(t, a, "webhook_deliveries", event.Id).GetString("payload"))
	stored, err := a.app.FindRecordsByFilter("crew_webhook_idempotency", "operation='execution.begin'", "", 0, 0)
	if err != nil || len(stored) != 2 {
		t.Fatal("unexpected begin ledger", len(stored), err)
	}
	for _, entry := range stored {
		checkPrivate(entry.GetString("result"))
	}
}

func TestBeginSelfWorkUsesCurrentDefaultSession(t *testing.T) {
	a, config, _, event := webhookFixture(t)
	id := config.GetString("agent")
	session := readSession(t, a, id)
	run := beginSelf(t, a, event, "context-owner")
	ctx, ok := run["agent_context"].(map[string]any)
	if !ok || run["next_step"] != "self_work" || ctx["agent_id"] != id || ctx["revision"] != float64(0) || ctx["workflow"] != session["body"] {
		t.Fatal("self work must receive its own active default", run)
	}
}

func TestBeginCapabilitiesDescribeAgentContext(t *testing.T) {
	a := newTestApp(t)
	full := capabilitiesItem(t, a, `{"collection":"capabilities"}`)
	shape := dig(full, "operations", "execution.begin", "result_schema", "properties", "agent_context", "properties")
	for _, field := range []string{"agent_id", "name", "brief", "workflow", "revision", "execution_guidance"} {
		if dig(shape, field, "type") == nil {
			t.Fatal("missing agent context schema field", field)
		}
	}
	subset := capabilitiesItem(t, a, `{"collection":"capabilities","id":"execution"}`)
	summary := dig(subset, "operations", "execution.begin", "returns").(string)
	if !strings.Contains(summary, "agent_context") || !strings.Contains(summary, "work/self_work") || subset["capabilities_digest"] != full["capabilities_digest"] {
		t.Fatal("execution capability discovery incomplete", summary)
	}
}

func TestBeginTwoWakesLoadSuccessiveSavedWorkflowRevisions(t *testing.T) {
	a := newTestApp(t)
	agent := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Manual dispatcher", "kind": "external", "brief": "Synthetic private role"}, "")
	id := agent["id"].(string)
	const original = "Summarize the assigned task in one paragraph."
	const edited = "Summarize the assigned task in three bullet points."
	sessionUpdate(t, a, true, 0, map[string]any{"agent": id, "instructions": original}, "", 200)
	_, _, task, first := configureWebhookFixture(t, a, agent, true)
	assertWorkflow := func(run map[string]any, workflow string, revision float64) {
		t.Helper()
		ctx, ok := run["agent_context"].(map[string]any)
		if !ok || run["next_step"] != "self_work" || ctx["agent_id"] != id || ctx["workflow"] != workflow || ctx["revision"] != revision {
			t.Fatalf("wanted agent %v with workflow %q revision %v, got %v", id, workflow, revision, ctx)
		}
	}
	receiveWake := func(eventID, worker string) map[string]any {
		t.Helper()
		payload := deliverToMock(t, a, eventID)
		raw, _ := json.Marshal(payload)
		for _, private := range []string{"agent_context", "Synthetic private role", original, edited, "synthetic-bearer"} {
			if strings.Contains(string(raw), private) {
				t.Fatal("mock receiver got private data", private)
			}
		}
		return map[string]any{"event_id": payload["event_id"], "epoch": payload["epoch"], "generation": payload["wake_generation"], "role": "dispatcher", "worker_id": worker}
	}
	firstRequest := receiveWake(first.GetString("event_id"), "first-wake-worker")
	run := executionOperation(t, a, "execution.begin", "", 0, firstRequest, "first-wake-worker", false, 200)
	assertWorkflow(run, original, 1)
	result := executionOperation(t, a, "execution.complete", run["id"].(string), int(run["revision"].(float64)), map[string]any{"worker_id": "first-wake-worker", "fence": run["fence"], "outcome": "completed"}, "first-complete", false, 200)
	if result["state"] != "completed" {
		t.Fatal(result)
	}
	replay := executionOperation(t, a, "execution.begin", "", 0, firstRequest, "first-wake-worker", false, 200)
	if replay["next_step"] != "reconcile" || replay["agent_context"] != nil || replay["execution"] != nil {
		t.Fatal("replay unexpectedly authorized more work", replay)
	}

	sessionUpdate(t, a, true, 1, map[string]any{"agent": id, "instructions": edited}, "", 200)
	next := newTask(t, a, map[string]any{"title": "Second assignment", "assigned_agent": id, "readiness": "ready"})
	deliveries := apiWebhookDeliveries(t, a, next["id"].(string))
	if len(deliveries) != 1 || deliveries[0].GetString("event_id") == first.GetString("event_id") {
		t.Fatal("expected a distinct wake for the second assignment")
	}
	secondRequest := receiveWake(deliveries[0].GetString("event_id"), "second-wake-worker")
	second := executionOperation(t, a, "execution.begin", "", 0, secondRequest, "second-wake-worker", false, 200)
	assertWorkflow(second, edited, 2)
	executionOperation(t, a, "execution.complete", second["id"].(string), int(second["revision"].(float64)), map[string]any{"worker_id": "second-wake-worker", "fence": second["fence"], "outcome": "completed"}, "second-complete", false, 200)
	for _, taskID := range []string{task.Id, next["id"].(string)} {
		if saved := apiWebhookRecord(t, a, "tasks", taskID); saved.GetString("status") == "done" {
			t.Fatal("mock wake marked task Done", taskID)
		}
	}
}
