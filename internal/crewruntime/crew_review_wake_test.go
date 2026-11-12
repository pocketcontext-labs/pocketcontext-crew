package crewruntime

import (
	"encoding/json"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// heldReview puts the fixture task on hold with a stale reason, gives it a
// draft and opens a review, returning the task and the pending review.
func heldReview(t *testing.T, a *testApp, task *core.Record) (*core.Record, map[string]any) {
	t.Helper()
	webhookOperation(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"readiness": "waiting", "waiting_reason": "Review withdrawn", "draft": "Synthetic draft"}, "")
	current := apiWebhookRecord(t, a, "tasks", task.Id)
	review := webhookOperation(t, a, "review.request", task.Id, current.GetInt("revision"), map[string]any{}, "")
	current = apiWebhookRecord(t, a, "tasks", task.Id)
	if current.GetString("readiness") != "waiting" || current.GetString("held_since") == "" {
		t.Fatal("fixture task is not on hold", current.PublicExport())
	}
	return current, review
}

func ownerReview(t *testing.T, a *testApp, action string, review map[string]any, data map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"action": action, "id": review["id"], "expected_revision": review["revision"], "data": data})
	a.request(t, "POST", "/api/crew/write", a.token, string(raw), 200)
}

func reviewOutcomeWakes(t *testing.T, a *testApp, task string) []*core.Record {
	t.Helper()
	rows, err := a.app.FindRecordsByFilter("crew_webhook_deliveries", "task={:task} && state='pending' && payload ~ '\"review_outcome\"'", "-created", 0, 0, map[string]any{"task": task})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestRequestChangesOnHeldTaskMakesItReadyAndWakes(t *testing.T) {
	a, _, task, _ := commentFixture(t)
	held, review := heldReview(t, a, task)
	ownerReview(t, a, "review.decide", review, map[string]any{"decision": "changes_requested", "note": "Synthetic decision note"})
	after := apiWebhookRecord(t, a, "tasks", task.Id)
	if after.GetString("status") != "in_progress" || after.GetString("readiness") != "ready" || after.GetString("waiting_reason") != "" || after.GetString("held_since") != "" {
		t.Fatal("Request changes left the task on hold", after.PublicExport())
	}
	if after.GetString("assigned_agent") != task.GetString("assigned_agent") || after.GetInt("wake_generation") <= held.GetInt("wake_generation") {
		t.Fatal("assignment changed or generation did not advance", after.PublicExport())
	}
	wakes := reviewOutcomeWakes(t, a, task.Id)
	if len(wakes) != 1 || wakes[0].GetInt("generation") != after.GetInt("wake_generation") {
		t.Fatal("assignee was not woken once", len(wakes))
	}
	var payload map[string]any
	_ = json.Unmarshal([]byte(wakes[0].GetString("payload")), &payload)
	if payload["review_outcome"] != "changes_requested" {
		t.Fatal("wake lacks the review outcome", payload)
	}
	stored := apiWebhookRecord(t, a, "reviews", review["id"].(string))
	if stored.GetString("decision_note") != "Synthetic decision note" {
		t.Fatal("decision note not saved")
	}
}

func TestRequestChangesOnReadyTaskStillWakes(t *testing.T) {
	a, _, task, _ := commentFixture(t)
	webhookOperation(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"draft": "Synthetic draft"}, "")
	current := apiWebhookRecord(t, a, "tasks", task.Id)
	review := webhookOperation(t, a, "review.request", task.Id, current.GetInt("revision"), map[string]any{}, "")
	if len(reviewOutcomeWakes(t, a, task.Id)) != 0 {
		t.Fatal("pending review woke the assignee")
	}
	ownerReview(t, a, "review.decide", review, map[string]any{"decision": "changes_requested"})
	if len(reviewOutcomeWakes(t, a, task.Id)) != 1 || apiWebhookRecord(t, a, "tasks", task.Id).GetString("readiness") != "ready" {
		t.Fatal("Request changes on a Ready task did not wake")
	}
}

func TestWithdrawApproveRejectKeepHold(t *testing.T) {
	for _, step := range []struct {
		action string
		data   map[string]any
	}{
		{"review.withdraw", map[string]any{}},
		{"review.decide", map[string]any{"decision": "approved"}},
		{"review.decide", map[string]any{"decision": "rejected"}},
	} {
		a, _, task, _ := commentFixture(t)
		held, review := heldReview(t, a, task)
		ownerReview(t, a, step.action, review, step.data)
		after := apiWebhookRecord(t, a, "tasks", task.Id)
		if after.GetString("readiness") != "waiting" || after.GetString("waiting_reason") != "Review withdrawn" || after.GetString("held_since") != held.GetString("held_since") {
			t.Fatal(step.action, step.data, "changed the hold", after.PublicExport())
		}
		if len(reviewOutcomeWakes(t, a, task.Id)) != 0 {
			t.Fatal(step.action, step.data, "woke a held task")
		}
	}
}
