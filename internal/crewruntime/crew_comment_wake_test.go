package crewruntime

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// commentFixture subscribes the enabled synthetic integration to owner comments
// and returns a fresh Ready task with its first wake.
func commentFixture(t *testing.T) (*testApp, *core.Record, *core.Record, *core.Record) {
	t.Helper()
	a, config, _, _ := webhookFixture(t)
	subs := []string{"created", "assigned", "reassigned", "ready", "reopened", "review_outcome", "catch_up", "comment"}
	updated := webhookOperation(t, a, "webhook.integration.update", config.Id, config.GetInt("revision"), map[string]any{"subscriptions": subs}, "")
	webhookOperation(t, a, "webhook.enable", config.Id, int(updated["revision"].(float64)), map[string]any{}, "")
	created := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Synthetic comment task", "assigned_agent": config.GetString("agent"), "readiness": "ready"}, "")
	task := apiWebhookRecord(t, a, "tasks", created["id"].(string))
	deliveries := apiWebhookDeliveries(t, a, task.Id)
	if len(deliveries) != 1 {
		t.Fatal("fixture task did not wake once", len(deliveries))
	}
	return a, apiWebhookRecord(t, a, "webhook_configs", config.Id), task, deliveries[0]
}

func commentDeliveries(t *testing.T, a *testApp, task string) []*core.Record {
	t.Helper()
	rows, err := a.app.FindRecordsByFilter("crew_webhook_deliveries", "task={:task} && payload ~ '\"reason\":\"comment\"'", "-created", 0, 0, map[string]any{"task": task})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func ownerComment(t *testing.T, a *testApp, task string, body string) string {
	t.Helper()
	current := apiWebhookRecord(t, a, "tasks", task)
	webhookOperation(t, a, "task.comment", task, current.GetInt("revision"), map[string]any{"body": body}, "")
	ev, err := a.app.FindFirstRecordByFilter("crew_events", "parent={:task} && action='task.comment' && body={:body}", map[string]any{"task": task, "body": body})
	if err != nil {
		t.Fatal(err)
	}
	return ev.Id
}

func beginSelf(t *testing.T, a *testApp, delivery *core.Record, key string) map[string]any {
	t.Helper()
	return executionOperation(t, a, "execution.begin", "", 0, map[string]any{"event_id": delivery.GetString("event_id"), "epoch": delivery.GetString("epoch"), "generation": delivery.GetInt("generation"), "role": "dispatcher", "worker_id": key}, key, false, 200)
}

func TestCommentWakeOwnerOnlyAndReferenceOnly(t *testing.T) {
	a, _, task, first := commentFixture(t)
	eventID := ownerComment(t, a, task.Id, "Synthetic owner instruction text")
	wakes := commentDeliveries(t, a, task.Id)
	if len(wakes) != 1 {
		t.Fatal("owner comment did not wake exactly once", len(wakes))
	}
	if apiWebhookRecord(t, a, "webhook_deliveries", first.Id).GetString("state") != "cancelled" {
		t.Fatal("older pending wake was not cancelled")
	}
	raw := wakes[0].GetString("payload")
	if strings.Contains(raw, "Synthetic owner instruction text") {
		t.Fatal("payload carries comment prose", raw)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatal(err)
	}
	current := apiWebhookRecord(t, a, "tasks", task.Id)
	if payload["comment_event_id"] != eventID || payload["reason"] != "comment" || payload["wake_generation"] != float64(current.GetInt("wake_generation")) {
		t.Fatal("bad comment payload", payload)
	}
	if current.GetInt("revision") != task.GetInt("revision") {
		t.Fatal("comment changed task revision")
	}
	// Shared-MCP comments never wake, even with valid execution proof.
	run := beginSelf(t, a, wakes[0], "mcp-commenter")
	raw2, _ := json.Marshal(map[string]any{"action": "task.comment", "id": task.Id, "expected_revision": current.GetInt("revision"), "data": map[string]any{"body": "agent pong"}, "idempotency_key": "agent-pong", "execution": run["execution"]})
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw2), 200)
	after := apiWebhookRecord(t, a, "tasks", task.Id)
	if len(commentDeliveries(t, a, task.Id)) != 1 || after.GetInt("comment_wake_generation") != 0 || after.GetInt("wake_generation") != current.GetInt("wake_generation") {
		t.Fatal("MCP comment woke or deferred a wake")
	}
}

func TestCommentWakeRequiresSubscriptionAndEligibility(t *testing.T) {
	a, _, task, first := webhookFixture(t)
	ownerComment(t, a, task.Id, "Not subscribed")
	if len(commentDeliveries(t, a, task.Id)) != 0 || apiWebhookRecord(t, a, "webhook_deliveries", first.Id).GetString("state") != "pending" {
		t.Fatal("unsubscribed comment woke or cancelled the pending wake")
	}
	a, _, task, _ = commentFixture(t)
	webhookOperation(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"readiness": "waiting"}, "")
	ownerComment(t, a, task.Id, "Waiting task")
	if len(commentDeliveries(t, a, task.Id)) != 0 || apiWebhookRecord(t, a, "tasks", task.Id).GetInt("comment_wake_generation") != 0 {
		t.Fatal("ineligible task woke on comment")
	}
}

func TestCommentWakeDeferredDuringLiveExecution(t *testing.T) {
	a, _, task, first := commentFixture(t)
	run := beginSelf(t, a, first, "live-worker")
	eventID := ownerComment(t, a, task.Id, "Also check the synthetic edge case")
	current := apiWebhookRecord(t, a, "tasks", task.Id)
	if len(commentDeliveries(t, a, task.Id)) != 0 || current.GetInt("comment_wake_generation") != current.GetInt("wake_generation") || current.GetString("comment_wake_event") != eventID {
		t.Fatal("comment during live execution was not deferred", current.PublicExport())
	}
	stored := apiWebhookRecord(t, a, "webhook_executions", run["id"].(string))
	if stored.GetString("state") != "running" {
		t.Fatal("comment invalidated live execution")
	}
	executionOperation(t, a, "execution.complete", stored.Id, stored.GetInt("revision"), map[string]any{"worker_id": "live-worker", "fence": run["fence"], "outcome": "completed"}, "complete-live", false, 200)
	wakes := commentDeliveries(t, a, task.Id)
	after := apiWebhookRecord(t, a, "tasks", task.Id)
	if len(wakes) != 1 || after.GetInt("comment_wake_generation") != 0 || after.GetString("comment_wake_event") != "" || wakes[0].GetInt("generation") != after.GetInt("wake_generation") {
		t.Fatal("deferred comment wake not emitted once on completion", len(wakes), after.PublicExport())
	}
	var payload map[string]any
	_ = json.Unmarshal([]byte(wakes[0].GetString("payload")), &payload)
	if payload["comment_event_id"] != eventID {
		t.Fatal("deferred wake lost comment reference", payload)
	}
}

func TestCommentWakeDeferredDroppedWhenTaskFinished(t *testing.T) {
	a, _, task, first := commentFixture(t)
	run := beginSelf(t, a, first, "finishing-worker")
	ownerComment(t, a, task.Id, "Late note")
	stored := apiWebhookRecord(t, a, "webhook_executions", run["id"].(string))
	current := apiWebhookRecord(t, a, "tasks", task.Id)
	executionOperation(t, a, "execution.complete", stored.Id, stored.GetInt("revision"), map[string]any{"worker_id": "finishing-worker", "fence": run["fence"], "outcome": "completed", "mark_done": true, "task_revision": current.GetInt("revision")}, "complete-done", false, 200)
	if len(commentDeliveries(t, a, task.Id)) != 0 || apiWebhookRecord(t, a, "tasks", task.Id).GetInt("comment_wake_generation") != 0 {
		t.Fatal("finished task woke on deferred comment")
	}
}

func TestCommentWakeMarkerClearedByAnotherWake(t *testing.T) {
	a, _, task, first := commentFixture(t)
	run := beginSelf(t, a, first, "superseded-worker")
	ownerComment(t, a, task.Id, "Deferred")
	current := apiWebhookRecord(t, a, "tasks", task.Id)
	waiting := webhookOperation(t, a, "task.update", task.Id, current.GetInt("revision"), map[string]any{"readiness": "waiting"}, "")
	webhookOperation(t, a, "task.update", task.Id, int(waiting["revision"].(float64)), map[string]any{"readiness": "ready"}, "")
	after := apiWebhookRecord(t, a, "tasks", task.Id)
	if after.GetInt("comment_wake_generation") != 0 || len(commentDeliveries(t, a, task.Id)) != 0 {
		t.Fatal("marker survived another wake")
	}
	latest := apiWebhookDeliveries(t, a, task.Id)
	var payload map[string]any
	for _, d := range latest {
		if d.GetInt("generation") == after.GetInt("wake_generation") {
			_ = json.Unmarshal([]byte(d.GetString("payload")), &payload)
		}
	}
	if payload["reason"] != "ready" {
		t.Fatal("ready wake missing", payload)
	}
	// The superseded execution cannot complete and re-emit the comment wake.
	stored := apiWebhookRecord(t, a, "webhook_executions", run["id"].(string))
	executionOperation(t, a, "execution.complete", stored.Id, stored.GetInt("revision"), map[string]any{"worker_id": "superseded-worker", "fence": run["fence"], "outcome": "completed"}, "stale-complete", false, 409)
	if len(commentDeliveries(t, a, task.Id)) != 0 {
		t.Fatal("stale completion emitted comment wake")
	}
}

func TestCommentWakeExpiredLeaseIsNotLive(t *testing.T) {
	a, _, task, first := commentFixture(t)
	run := beginSelf(t, a, first, "expired-worker")
	ownerComment(t, a, task.Id, "Deferred before expiry")
	stored := apiWebhookRecord(t, a, "webhook_executions", run["id"].(string))
	stored.Set("lease_until", time.Now().Add(-time.Minute).UTC().Format(time.RFC3339))
	if err := a.app.Save(stored); err != nil {
		t.Fatal(err)
	}
	// The stranded marker never fires by itself; the next owner comment wakes now.
	if len(commentDeliveries(t, a, task.Id)) != 0 {
		t.Fatal("expiry fired a wake")
	}
	eventID := ownerComment(t, a, task.Id, "Comment after expiry")
	wakes := commentDeliveries(t, a, task.Id)
	if len(wakes) != 1 || !strings.Contains(wakes[0].GetString("payload"), eventID) {
		t.Fatal("comment after expired lease did not wake immediately")
	}
	if apiWebhookRecord(t, a, "webhook_executions", stored.Id).GetString("state") != "invalidated" {
		t.Fatal("expired execution was not invalidated by the new generation")
	}
	if apiWebhookRecord(t, a, "tasks", task.Id).GetInt("comment_wake_generation") != 0 {
		t.Fatal("marker not cleared")
	}
}

func TestCommentWakeOwnerCancelDropsMarker(t *testing.T) {
	a, _, task, first := commentFixture(t)
	run := beginSelf(t, a, first, "cancelled-worker")
	ownerComment(t, a, task.Id, "Deferred before cancel")
	stored := apiWebhookRecord(t, a, "webhook_executions", run["id"].(string))
	stored.Set("lease_until", time.Now().Add(-time.Minute).UTC().Format(time.RFC3339))
	if err := a.app.Save(stored); err != nil {
		t.Fatal(err)
	}
	executionOperation(t, a, "execution.recover", stored.Id, stored.GetInt("revision"), map[string]any{"resolution": "cancel"}, "owner-cancel", true, 200)
	if apiWebhookRecord(t, a, "tasks", task.Id).GetInt("comment_wake_generation") != 0 || len(commentDeliveries(t, a, task.Id)) != 0 {
		t.Fatal("owner cancel must drop the marker without waking")
	}
}

func agentWrite(t *testing.T, a *testApp, action, id string, revision int, data map[string]any, status int) map[string]any {
	t.Helper()
	b := map[string]any{"action": action, "data": data, "reported_agent": "synthetic-bot"}
	if id != "" {
		b["id"] = id
		b["expected_revision"] = revision
	}
	raw, _ := json.Marshal(b)
	return a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), status)
}

func TestBotHandoffLimitStopsLoopWithoutWake(t *testing.T) {
	a, config, _, _ := webhookFixture(t)
	dispatcher := config.GetString("agent")
	routing, err := a.app.FindFirstRecordByFilter("crew_webhook_routing", "singleton='routing'")
	if err != nil {
		t.Fatal(err)
	}
	if routing.GetInt("max_bot_handoffs") != 4 {
		t.Fatal("default limit", routing.GetInt("max_bot_handoffs"))
	}
	// Work clients and the reader can both change the limit.
	if agentWrite(t, a, "webhook.routing.update", routing.Id, routing.GetInt("revision"), map[string]any{"max_bot_handoffs": 20}, 200)["max_bot_handoffs"] != float64(20) {
		t.Fatal("work client could not set limit")
	}
	agentWrite(t, a, "webhook.routing.update", routing.Id, routing.GetInt("revision")+1, map[string]any{"max_bot_handoffs": 0}, 400)
	raw, _ := json.Marshal(map[string]any{"action": "webhook.routing.update", "id": routing.Id, "expected_revision": routing.GetInt("revision") + 1, "data": map[string]any{"max_bot_handoffs": 0}})
	a.request(t, "POST", "/api/crew/write", a.token, string(raw), 400)
	raw, _ = json.Marshal(map[string]any{"action": "webhook.routing.update", "id": routing.Id, "expected_revision": routing.GetInt("revision") + 1, "data": map[string]any{"max_bot_handoffs": 2}})
	if a.request(t, "POST", "/api/crew/write", a.token, string(raw), 200)["max_bot_handoffs"] != float64(2) {
		t.Fatal("owner could not set limit")
	}
	// Unmapped agents receive no wake, so the Ready task stays ungoverned until the loop reaches the dispatcher.
	b := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Synthetic B"}, "")["id"].(string)
	c := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Synthetic C"}, "")["id"].(string)
	task := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Loop task", "assigned_agent": b, "readiness": "ready"}, "")
	id := task["id"].(string)
	rev := func() int { return apiWebhookRecord(t, a, "tasks", id).GetInt("revision") }
	// An agent-created assigned task starts at one handoff.
	if apiWebhookRecord(t, a, "tasks", id).GetInt("bot_handoffs") != 1 {
		t.Fatal("agent creation with assignee did not count")
	}
	agentWrite(t, a, "task.update", id, rev(), map[string]any{"assigned_agent": c}, 200)
	if apiWebhookRecord(t, a, "tasks", id).GetInt("bot_handoffs") != 2 {
		t.Fatal("counter did not increment")
	}
	// Any owner write resets it, including a comment.
	ownerComment(t, a, id, "Owner reset")
	if apiWebhookRecord(t, a, "tasks", id).GetInt("bot_handoffs") != 0 {
		t.Fatal("owner comment did not reset counter")
	}
	agentWrite(t, a, "task.update", id, rev(), map[string]any{"assigned_agent": b}, 200)
	agentWrite(t, a, "task.update", id, rev(), map[string]any{"assigned_agent": ""}, 200)
	if apiWebhookRecord(t, a, "tasks", id).GetInt("bot_handoffs") != 2 {
		t.Fatal("unassignment did not count")
	}
	before := len(apiWebhookDeliveries(t, a, id))
	stopped := agentWrite(t, a, "task.update", id, rev(), map[string]any{"assigned_agent": dispatcher, "readiness": "ready"}, 200)
	if stopped["assigned_agent"] != dispatcher || stopped["readiness"] != "waiting" || stopped["handoff_limited"] != true || stopped["bot_handoffs"] != float64(3) {
		t.Fatal("hop limit did not apply write and stop", stopped)
	}
	if len(apiWebhookDeliveries(t, a, id)) != before {
		t.Fatal("hop limit emitted a wake")
	}
	events, err := a.app.FindRecordsByFilter("crew_events", "parent={:task} && action='task.hop_limit'", "", 0, 0, map[string]any{"task": id})
	if err != nil || len(events) != 1 || events[0].GetString("reason") != "hop_limit" {
		t.Fatal("hop limit audit missing", err, len(events))
	}
	// A work client may set the stopped task Ready, but the counter and marker
	// stay, so the next work-client reassignment stops it again.
	agentReady := agentWrite(t, a, "task.update", id, rev(), map[string]any{"readiness": "ready"}, 200)
	if agentReady["readiness"] != "ready" || agentReady["handoff_limited"] != true || agentReady["bot_handoffs"] != float64(3) {
		t.Fatal("agent Ready reset the hop accounting", agentReady)
	}
	if len(apiWebhookDeliveries(t, a, id)) != before+1 {
		t.Fatal("agent Ready did not wake the assignee")
	}
	// The assignee's execution is now live; release it so the next agent
	// write is not fenced.
	agentWrite(t, a, "task.update", id, rev(), map[string]any{"readiness": "waiting"}, 200)
	restopped := agentWrite(t, a, "task.update", id, rev(), map[string]any{"assigned_agent": b, "readiness": "ready"}, 200)
	if restopped["readiness"] != "waiting" || restopped["handoff_limited"] != true || restopped["bot_handoffs"] != float64(4) {
		t.Fatal("next reassignment after agent Ready did not stop again", restopped)
	}
	// An agent comment on the stopped task applies silently.
	agentWrite(t, a, "task.comment", id, rev(), map[string]any{"body": "Synthetic agent note"}, 200)
	released := webhookOperation(t, a, "task.update", id, rev(), map[string]any{"assigned_agent": dispatcher, "readiness": "ready"}, "")
	if released["bot_handoffs"] != float64(0) || released["handoff_limited"] != false || len(apiWebhookDeliveries(t, a, id)) != before+2 {
		t.Fatal("owner release did not reset and wake", released)
	}
}

func TestCapabilitiesDescribeCommentWakeAndHandoffLimit(t *testing.T) {
	a := newTestApp(t)
	result := a.request(t, "POST", "/api/crew/read", a.token, `{"collection":"capabilities"}`, 200)
	doc := result["items"].([]any)[0].(map[string]any)
	reasons, _ := json.Marshal(doc["wake_reasons"])
	if !strings.Contains(string(reasons), `"comment"`) {
		t.Fatal("comment reason not discoverable", string(reasons))
	}
	ops := doc["operations"].(map[string]any)
	op := ops["webhook.routing.update"].(map[string]any)
	if _, ok := op["owner_only_fields"]; ok || op["authority"] != "shared_mcp" {
		t.Fatal("limit still owner-only in capabilities", op)
	}
	// Work clients share every operation except credential entry,
	// upload-link creation and publishing, replacing, revoking, expiring or archiving artifacts.
	for name, raw := range ops {
		want := "shared_mcp"
		switch name {
		case "webhook.credentials.update", "upload_link.create", "artifact.publish", "artifact.replace", "artifact.revoke", "artifact.set_expiry", "artifact.archive", "artifact.restore":
			want = "owner_browser"
		}
		if authority := raw.(map[string]any)["authority"]; authority != want {
			t.Errorf("%s authority %v, want %s", name, authority, want)
		}
	}
}

func TestCommentWakeMigrationKeepsSubscriptionsAndWork(t *testing.T) {
	a, c, task, event := webhookFixture(t)
	if strings.Contains(c.GetString("subscriptions"), "comment") {
		t.Fatal("default configuration subscribed to comments")
	}
	// Rehearse on the 0.6.0 layout without the new fields.
	for collection, names := range map[string][]string{"crew_tasks": {"bot_handoffs", "comment_wake_generation", "comment_wake_event", "handoff_limited"}, "crew_webhook_routing": {"max_bot_handoffs"}} {
		col, err := a.app.FindCollectionByNameOrId(collection)
		if err != nil {
			t.Fatal(err)
		}
		for _, name := range names {
			col.Fields.RemoveByName(name)
		}
		if err = a.app.Save(col); err != nil {
			t.Fatal(err)
		}
	}
	beforeSubs, beforeRevision := c.GetString("subscriptions"), c.GetInt("revision")
	if err := runFixtureMigration(t, a.app, "../../pb_migrations/1800600000_crew_comment_wake.js"); err != nil {
		t.Fatal(err)
	}
	c = apiWebhookRecord(t, a, "webhook_configs", c.Id)
	if c.GetString("subscriptions") != beforeSubs || c.GetInt("revision") != beforeRevision || !c.GetBool("enabled") {
		t.Fatal("migration changed integration")
	}
	after := apiWebhookRecord(t, a, "tasks", task.Id)
	if after.GetInt("revision") != task.GetInt("revision") || after.GetInt("wake_generation") != task.GetInt("wake_generation") || after.GetInt("bot_handoffs") != 0 {
		t.Fatal("migration changed task work")
	}
	if apiWebhookRecord(t, a, "webhook_deliveries", event.Id).GetString("state") != "pending" {
		t.Fatal("migration cancelled pending work")
	}
	routing, _ := a.app.FindFirstRecordByFilter("crew_webhook_routing", "singleton='routing'")
	if routing.GetInt("max_bot_handoffs") != 4 {
		t.Fatal("default limit not installed")
	}
}

func TestCommentWakeDeferredDuringPreparedHandoff(t *testing.T) {
	a, config, _, _ := commentFixture(t)
	recipient := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Synthetic comment recipient"}, "")
	webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": recipient["id"], "bot_ref": "comment-recipient"}, "")
	created := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Handoff comment task", "assigned_agent": recipient["id"], "readiness": "ready"}, "")
	id := created["id"].(string)
	event := apiWebhookDeliveries(t, a, id)[0]
	run := executionOperation(t, a, "execution.begin", "", 0, map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "role": "dispatcher", "worker_id": "dispatcher", "native_handoff": true}, "prepare", false, 200)
	if run["next_step"] != "handoff" || config.GetString("agent") == recipient["id"] {
		t.Fatal(run)
	}
	ownerComment(t, a, id, "Comment while handoff prepared")
	if len(commentDeliveries(t, a, id)) != 0 || apiWebhookRecord(t, a, "webhook_executions", run["id"].(string)).GetString("state") != "handed_off" {
		t.Fatal("comment broke a prepared handoff")
	}
	work := executionOperation(t, a, "execution.begin", "", 0, map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "role": "recipient", "worker_id": "recipient"}, "work", false, 200)
	executionOperation(t, a, "execution.complete", work["id"].(string), int(work["revision"].(float64)), map[string]any{"worker_id": "recipient", "fence": work["fence"], "outcome": "failed"}, "failed", false, 200)
	if len(commentDeliveries(t, a, id)) != 1 {
		t.Fatal("failed outcome did not emit the deferred comment wake")
	}
}
