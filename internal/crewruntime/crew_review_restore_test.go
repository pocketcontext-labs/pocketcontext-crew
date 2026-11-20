package crewruntime

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// review.restore is the Undo of an archive that withdrew a pending review:
// one write un-archives the task and makes that same review pending again.
// All records are synthetic.

// requestedReview creates a task through the reader route and requests its
// review. It returns the task id and the pending review as the client got it.
func requestedReview(t *testing.T, a *testApp, task, request map[string]any) (string, map[string]any) {
	t.Helper()
	if task == nil {
		task = map[string]any{}
	}
	if task["title"] == nil {
		task["title"] = "Synthetic restore task"
	}
	if task["draft"] == nil && task["draft_options"] == nil {
		task["draft"] = "Synthetic draft"
	}
	if request == nil {
		request = map[string]any{}
	}
	id := newTask(t, a, task)["id"].(string)
	return id, crewWrite(t, a, false, "review.request", id, taskRevision(t, a, id), request, 200)
}

// setArchived archives or un-archives a task with a plain task.update, with
// any other fields of the same write in extra.
func setArchived(t *testing.T, a *testApp, agent bool, id string, archived bool, extra map[string]any) map[string]any {
	t.Helper()
	data := map[string]any{"archived": archived}
	for k, v := range extra {
		data[k] = v
	}
	return crewWrite(t, a, agent, "task.update", id, taskRevision(t, a, id), data, 200)
}

// restoreReview sends review.restore with the review's current revision.
func restoreReview(t *testing.T, a *testApp, agent bool, review string, want int) map[string]any {
	t.Helper()
	revision := apiWebhookRecord(t, a, "reviews", review).GetInt("revision")
	return crewWrite(t, a, agent, "review.restore", review, revision, map[string]any{}, want)
}

// queuedWakes lists the task's webhook deliveries that would still be sent.
func queuedWakes(t *testing.T, a *testApp, task string) []*core.Record {
	t.Helper()
	rows, err := a.app.FindRecordsByFilter("crew_webhook_deliveries", "task={:task} && (state='pending' || state='in_flight')", "", 0, 0, map[string]any{"task": task})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

// crewSnapshot serializes every record a review write can touch, so a refused
// write can be shown to change nothing.
func crewSnapshot(t *testing.T, a *testApp) string {
	t.Helper()
	out := map[string]any{}
	for _, collection := range []string{"crew_tasks", "crew_reviews", "crew_events", "crew_attachments", "crew_webhook_deliveries", "crew_webhook_executions"} {
		rows, err := a.app.FindRecordsByFilter(collection, "id!=''", "id", 0, 0)
		if err != nil {
			t.Fatal(err)
		}
		list := make([]map[string]any, len(rows))
		for i, r := range rows {
			list[i] = r.PublicExport()
		}
		out[collection] = list
	}
	raw, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// assertNotRestorable checks the refusal a client sees: HTTP 409 with
// data.reason.code review_not_restorable and a message naming the condition.
func assertNotRestorable(t *testing.T, body map[string]any, condition string) {
	t.Helper()
	want := "This review cannot be restored: " + condition + "."
	if message := assertRefusal(t, body, "review_not_restorable"); message != want || body["message"] != want || body["status"] != float64(409) {
		t.Fatalf("refusal %v; want message %q", body, want)
	}
}

// eventChanges decodes the changes of the single event with that action.
func eventChanges(t *testing.T, a *testApp, parent, action string) (*core.Record, map[string]any) {
	t.Helper()
	events := eventsOf(t, a, parent, action)
	if len(events) != 1 {
		t.Fatalf("%d %s events on %s; want 1", len(events), action, parent)
	}
	var changes map[string]any
	if err := json.Unmarshal([]byte(events[0].GetString("changes")), &changes); err != nil {
		t.Fatal(err)
	}
	return events[0], changes
}

func TestReviewRestoreUndoesArchive(t *testing.T) {
	options := []map[string]any{
		{"key": "a", "label": "First", "body": "Synthetic first alternative"},
		{"key": "b", "label": "Second", "body": "Synthetic second alternative"},
	}
	for _, tc := range []struct {
		name          string
		task, request map[string]any
		approve       map[string]any
	}{
		{
			name:    "Ready task with a plain draft",
			task:    map[string]any{"draft": "Synthetic draft", "readiness": "ready"},
			request: map[string]any{},
			approve: map[string]any{"decision": "approved"},
		},
		{
			name:    "on-hold task with options, pick one and a recipient",
			task:    map[string]any{"draft": "Synthetic context", "waiting_reason": "Synthetic hold"},
			request: map[string]any{"options": options, "selection": "one", "recipient": "Synthetic reader"},
			approve: map[string]any{"decision": "approved", "option_decisions": []map[string]any{{"key": "a", "decision": "approved"}, {"key": "b", "decision": "rejected"}}},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := newTestApp(t)
			setLinkTestDomain(a)
			owner := "owner:" + a.user.Id
			id, review := requestedReview(t, a, tc.task, tc.request)
			rid := review["id"].(string)
			requested := apiWebhookRecord(t, a, "tasks", id)
			if requested.GetString("status") != "needs_review" || review["status"] != "pending" {
				t.Fatal("fixture has no pending review", requested.PublicExport())
			}

			// Archive: the review is withdrawn, never decided, and the task is
			// archived In progress.
			setArchived(t, a, false, id, true, nil)
			archived := apiWebhookRecord(t, a, "tasks", id)
			if !archived.GetBool("archived") || archived.GetString("status") != "in_progress" || archived.GetString("archived_at") == "" || archived.GetString("archived_by") != owner {
				t.Fatal("archive did not leave the task archived and In progress", archived.PublicExport())
			}
			withdrawn := apiWebhookRecord(t, a, "reviews", rid)
			if withdrawn.GetString("status") != "withdrawn" || withdrawn.GetInt("revision") != 2 || withdrawn.GetString("decided_by") != "" || withdrawn.GetString("decided_at") != "" || withdrawn.GetString("decision_note") != "" {
				t.Fatal("archive did not just withdraw the review", withdrawn.PublicExport())
			}
			for _, parent := range []string{rid, id} {
				if n := len(eventsOf(t, a, parent, "review.decide")); n != 0 {
					t.Fatal("archive recorded a decision on", parent, n)
				}
			}
			if _, changes := eventChanges(t, a, rid, "review.withdraw"); changes["archived"] != true {
				t.Fatal("the withdrawal does not say the task was archived", changes)
			}
			if items := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "tasks", "id": id}, 200)); len(items) != 0 {
				t.Fatal("archived task still listed", items)
			}

			// Restore: the same review is pending again, with its snapshot.
			restored := restoreReview(t, a, false, rid, 200)
			link := "#/approvals/" + rid
			if restored["id"] != rid || restored["status"] != "pending" || restored["revision"] != float64(3) || restored["path"] != link || restored["url"] != linkTestBase+"/"+link {
				t.Fatal("restore result", restored)
			}
			for _, field := range []string{"task", "draft", "options", "selection", "recipient", "attachments", "option_decisions", "requested_by", "decided_by", "decided_at", "decision_note", "created"} {
				if !reflect.DeepEqual(restored[field], review[field]) {
					t.Fatalf("restore changed the review's %s: %v, was %v", field, restored[field], review[field])
				}
			}
			after := apiWebhookRecord(t, a, "tasks", id)
			if after.GetBool("archived") || after.GetString("archived_at") != "" || after.GetString("archived_by") != "" || after.GetString("status") != "needs_review" || after.GetInt("revision") != archived.GetInt("revision")+1 {
				t.Fatal("task not restored to Needs review", after.PublicExport())
			}
			for _, field := range []string{"readiness", "waiting_reason", "held_since", "title", "description", "draft", "draft_options", "draft_selection", "draft_recipient", "assigned_agent", "labels"} {
				if after.GetString(field) != requested.GetString(field) {
					t.Fatalf("restore changed the task's %s: %q, was %q", field, after.GetString(field), requested.GetString(field))
				}
			}
			// Like review.request, the restore advances the wake generation once.
			if after.GetInt("wake_generation") != archived.GetInt("wake_generation")+1 {
				t.Fatal("wake generation", after.GetInt("wake_generation"), archived.GetInt("wake_generation"))
			}

			onReview, reviewChanges := eventChanges(t, a, rid, "review.restore")
			onTask, taskChanges := eventChanges(t, a, id, "review.restore")
			if !reflect.DeepEqual(reviewChanges, map[string]any{"status": "pending"}) {
				t.Fatal("review event changes", reviewChanges)
			}
			if want := map[string]any{"archived": false, "status": "needs_review", "readiness": after.GetString("readiness"), "wake_generation": float64(after.GetInt("wake_generation"))}; !reflect.DeepEqual(taskChanges, want) {
				t.Fatal("task event changes", taskChanges, "want", want)
			}
			for _, ev := range []*core.Record{onReview, onTask} {
				if ev.GetString("actor") != owner || ev.GetString("reported_agent") != "synthetic-bot" || ev.GetString("reason") != "synthetic" {
					t.Fatal("restore event attribution", ev.PublicExport())
				}
			}
			// Still exactly one withdrawal on the review, and still no decision.
			if len(eventsOf(t, a, rid, "review.withdraw")) != 1 || len(eventsOf(t, a, rid, "review.decide")) != 0 {
				t.Fatal("restore rewrote the review's history")
			}

			// The task and its review are back in the default reads.
			if readTask(t, a, id)["status"] != "needs_review" {
				t.Fatal("restored task not listed")
			}
			listed := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "reviews", "parent": id}, 200))
			if len(listed) != 1 || listed[0]["id"] != rid || listed[0]["status"] != "pending" {
				t.Fatal("restored review not listed as pending", listed)
			}

			// The snapshot still matches the task, so the owner can decide it.
			decided := crewWrite(t, a, false, "review.decide", rid, 3, tc.approve, 200)
			if decided["status"] != "approved" || apiWebhookRecord(t, a, "tasks", id).GetString("status") != "in_progress" {
				t.Fatal("restored review could not be approved", decided)
			}
		})
	}
}

func TestReviewRestoreWorkClientRouteAndCapabilities(t *testing.T) {
	a := newTestApp(t)
	agent := "mcp:" + a.user.Id
	created := crewWrite(t, a, true, "task.create", "", 0, map[string]any{"title": "Synthetic work-client restore", "draft": "Synthetic draft"}, 200)
	id := created["id"].(string)
	rid := crewWrite(t, a, true, "review.request", id, taskRevision(t, a, id), map[string]any{}, 200)["id"].(string)
	setArchived(t, a, true, id, true, nil)
	// A stopped hand-off loop, to show which route resets it.
	limited := func() {
		t.Helper()
		task := apiWebhookRecord(t, a, "tasks", id)
		task.Set("bot_handoffs", 3)
		task.Set("handoff_limited", true)
		if err := a.app.Save(task); err != nil {
			t.Fatal(err)
		}
	}
	limited()
	restored := restoreReview(t, a, true, rid, 200)
	if _, hasURL := restored["url"]; restored["status"] != "pending" || restored["revision"] != float64(3) || restored["path"] != "#/approvals/"+rid || hasURL {
		t.Fatal("work-client restore result", restored)
	}
	after := apiWebhookRecord(t, a, "tasks", id)
	if after.GetBool("archived") || after.GetString("status") != "needs_review" || after.GetString("archived_by") != "" {
		t.Fatal("work client did not restore the task", after.PublicExport())
	}
	// Loop accounting stays on the route split: a work client does not reset it.
	if after.GetInt("bot_handoffs") != 3 || !after.GetBool("handoff_limited") {
		t.Fatal("work-client restore reset the hand-off limit", after.PublicExport())
	}
	for _, parent := range []string{rid, id} {
		if ev, _ := eventChanges(t, a, parent, "review.restore"); ev.GetString("actor") != agent || ev.GetString("reported_agent") != "synthetic-bot" {
			t.Fatal("work-client restore attribution", ev.PublicExport())
		}
	}
	// Archive again and restore in the reader: it resets the limit, as every
	// reader task write does.
	setArchived(t, a, true, id, true, nil)
	limited()
	if restoreReview(t, a, false, rid, 200)["revision"] != float64(5) {
		t.Fatal("second restore revision")
	}
	after = apiWebhookRecord(t, a, "tasks", id)
	if after.GetBool("archived") || after.GetInt("bot_handoffs") != 0 || after.GetBool("handoff_limited") {
		t.Fatal("reader restore did not reset the hand-off limit", after.PublicExport())
	}
	if len(eventsOf(t, a, rid, "review.restore")) != 2 || len(eventsOf(t, a, rid, "review.withdraw")) != 2 {
		t.Fatal("history of two archive and restore rounds")
	}

	// The operation is discoverable, shared with work clients and not part of
	// the wake-run subset.
	doc := capabilitiesItem(t, a, `{"collection":"capabilities"}`)
	ops := doc["operations"].(map[string]any)
	op, _ := ops["review.restore"].(map[string]any)
	if op == nil {
		t.Fatal("capabilities omit review.restore")
	}
	if op["authority"] != "shared_mcp" || op["revision"] != "review" || op["idempotency"] != "optional" || op["execution_proof"] != ops["review.withdraw"].(map[string]any)["execution_proof"] {
		t.Fatal("review.restore capability", op)
	}
	description, _ := op["description"].(string)
	for _, want := range []string{"Undo of an archive", "One transaction", "review_not_restorable", "Never wakes", "Use it only when the owner asks"} {
		if !strings.Contains(description, want) {
			t.Errorf("review.restore description lacks %q", want)
		}
	}
	schema := op["data_schema"].(map[string]any)
	properties := schema["properties"].(map[string]any)
	if schema["additionalProperties"] != false || len(properties) != 1 || properties["_crew"] == nil || len(schema["required"].([]any)) != 0 {
		t.Fatal("review.restore accepts data fields", schema)
	}
	if !reflect.DeepEqual(op["result_schema"], map[string]any{"$ref": "#/$defs/reviews"}) {
		t.Fatal("review.restore result schema", op["result_schema"])
	}
	subset := capabilitiesItem(t, a, `{"collection":"capabilities","id":"execution"}`)
	if _, listed := subset["operations"].(map[string]any)["review.restore"]; listed {
		t.Fatal("review.restore joined the wake-run subset")
	}
}

// Why the operation exists: with an enabled integration, a mapped bot assignee
// and a Ready task, un-archiving wakes the bot, so Undo cannot be two writes.
func TestReviewRestoreNeverWakes(t *testing.T) {
	// A Ready task of the fixture's bot with a pending review, archived
	// through one route. Returns the deliveries the task had before.
	archived := func(t *testing.T, agent bool) (*testApp, string, string, int) {
		t.Helper()
		a, _, task, _ := commentFixture(t)
		crewWrite(t, a, agent, "task.update", task.Id, task.GetInt("revision"), map[string]any{"draft": "Synthetic draft"}, 200)
		review := crewWrite(t, a, agent, "review.request", task.Id, taskRevision(t, a, task.Id), map[string]any{}, 200)
		before := len(apiWebhookDeliveries(t, a, task.Id))
		setArchived(t, a, agent, task.Id, true, nil)
		if got := len(apiWebhookDeliveries(t, a, task.Id)); got != before || len(queuedWakes(t, a, task.Id)) != 0 {
			t.Fatal("archiving a task with a pending review queued a wake", got, before)
		}
		if apiWebhookRecord(t, a, "tasks", task.Id).GetString("readiness") != "ready" {
			t.Fatal("fixture task is not Ready")
		}
		return a, task.Id, review["id"].(string), before
	}
	for _, agent := range []bool{false, true} {
		t.Run(map[bool]string{false: "reader", true: "work client"}[agent]+" archive and restore queue nothing", func(t *testing.T) {
			a, id, rid, before := archived(t, agent)
			generation := apiWebhookRecord(t, a, "tasks", id).GetInt("wake_generation")
			restored := restoreReview(t, a, agent, rid, 200)
			if got := len(apiWebhookDeliveries(t, a, id)); got != before || len(queuedWakes(t, a, id)) != 0 || len(reviewOutcomeWakes(t, a, id)) != 0 {
				t.Fatal("review.restore queued a wake", got, before)
			}
			after := apiWebhookRecord(t, a, "tasks", id)
			if after.GetString("readiness") != "ready" || after.GetString("status") != "needs_review" || after.GetInt("wake_generation") != generation+1 {
				t.Fatal("restored task", after.PublicExport())
			}
			// It is an ordinary pending review again: Request changes wakes.
			ownerReview(t, a, "review.decide", restored, map[string]any{"decision": "changes_requested"})
			if wakes := reviewOutcomeWakes(t, a, id); len(wakes) != 1 || len(apiWebhookDeliveries(t, a, id)) != before+1 {
				t.Fatal("Request changes on the restored review did not wake once", len(wakes))
			}
		})
	}
	t.Run("a plain un-archive wakes the bot", func(t *testing.T) {
		a, id, rid, before := archived(t, false)
		setArchived(t, a, false, id, false, nil)
		wakes := queuedWakes(t, a, id)
		if len(wakes) != 1 || len(apiWebhookDeliveries(t, a, id)) != before+1 {
			t.Fatal("un-archiving a Ready task did not wake once", len(wakes))
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(wakes[0].GetString("payload")), &payload); err != nil {
			t.Fatal(err)
		}
		if payload["reason"] != "reopened" {
			t.Fatal("wake reason", payload["reason"])
		}
		// And it does not bring the review back.
		if apiWebhookRecord(t, a, "reviews", rid).GetString("status") != "withdrawn" {
			t.Fatal("un-archive revived the review")
		}
	})
}

// A pending review and a live execution do not coexist: requesting the review
// already completes (the holder) or invalidates (anyone else) the execution.
// Archiving and restoring then find nothing live and queue nothing.
func TestReviewRestoreAfterExecutionEnded(t *testing.T) {
	active := func(t *testing.T, a *testApp, task string) int {
		t.Helper()
		rows, err := a.app.FindRecordsByFilter("crew_webhook_executions", "task={:task} && (state='dispatching' || state='handed_off' || state='running')", "", 0, 0, map[string]any{"task": task})
		if err != nil {
			t.Fatal(err)
		}
		return len(rows)
	}
	quiet := func(t *testing.T, a *testApp, task, review, step string, deliveries int) {
		t.Helper()
		if n := active(t, a, task); n != 0 {
			t.Fatal(step, "left an execution active", n)
		}
		if got := len(apiWebhookDeliveries(t, a, task)); got != deliveries || len(queuedWakes(t, a, task)) != 0 {
			t.Fatal(step, "queued a wake", got, deliveries)
		}
		for _, parent := range []string{task, review} {
			if n := len(eventsOf(t, a, parent, "review.decide")); n != 0 {
				t.Fatal(step, "recorded a decision", n)
			}
		}
	}
	t.Run("holder requested the review", func(t *testing.T) {
		a, _, task, event := commentFixture(t)
		proof := proofOf(beginSelf(t, a, event, "synthetic-restore-worker"))
		updated := fencedWrite(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"draft": "Synthetic outbound draft"}, proof, "", 200)
		rid := fencedWrite(t, a, "review.request", task.Id, int(updated["revision"].(float64)), map[string]any{}, proof, "", 200)["id"].(string)
		execution := apiWebhookRecord(t, a, "webhook_executions", proof["id"].(string))
		if execution.GetString("state") != "completed" || execution.GetString("outcome_code") != "review_requested" {
			t.Fatal("the review request did not complete the execution", execution.PublicExport())
		}
		deliveries := len(apiWebhookDeliveries(t, a, task.Id))
		setArchived(t, a, false, task.Id, true, nil)
		quiet(t, a, task.Id, rid, "archive", deliveries)
		if apiWebhookRecord(t, a, "reviews", rid).GetString("status") != "withdrawn" {
			t.Fatal("archive did not withdraw the review")
		}
		// Supplied proof is always validated: the finished execution's proof
		// does not authorize the restore, and nothing changes.
		before := crewSnapshot(t, a)
		assertRefusal(t, fencedWrite(t, a, "review.restore", rid, 2, map[string]any{}, proof, "", 409), "execution_conflict")
		if crewSnapshot(t, a) != before {
			t.Fatal("a refused restore changed something")
		}
		restoreReview(t, a, true, rid, 200)
		quiet(t, a, task.Id, rid, "restore", deliveries)
		if again := apiWebhookRecord(t, a, "webhook_executions", execution.Id); again.GetString("state") != "completed" || again.GetInt("revision") != execution.GetInt("revision") {
			t.Fatal("restore touched the completed execution", again.PublicExport())
		}
	})
	t.Run("an execution left running is invalidated by the archive", func(t *testing.T) {
		a, _, task, event := commentFixture(t)
		run := beginSelf(t, a, event, "synthetic-live-worker")
		crewWrite(t, a, false, "task.update", task.Id, task.GetInt("revision"), map[string]any{"draft": "Synthetic owner draft"}, 200)
		rid := crewWrite(t, a, false, "review.request", task.Id, taskRevision(t, a, task.Id), map[string]any{}, 200)["id"].(string)
		execution := apiWebhookRecord(t, a, "webhook_executions", run["id"].(string))
		if execution.GetString("state") != "invalidated" || execution.GetString("outcome_code") != "work_no_longer_eligible" {
			t.Fatal("the owner's review request did not invalidate the execution", execution.PublicExport())
		}
		// No write can leave an execution running under a pending review, so
		// put a live lease back directly, as if one had survived.
		execution.Set("state", "running")
		execution.Set("outcome_code", "")
		execution.Set("worker_id", "synthetic-live-worker")
		execution.Set("lease_until", time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
		if err := a.app.Save(execution); err != nil {
			t.Fatal(err)
		}
		if active(t, a, task.Id) != 1 {
			t.Fatal("fixture execution is not running")
		}
		deliveries := len(apiWebhookDeliveries(t, a, task.Id))
		setArchived(t, a, false, task.Id, true, nil)
		quiet(t, a, task.Id, rid, "archive", deliveries)
		cancelled := apiWebhookRecord(t, a, "webhook_executions", execution.Id)
		if cancelled.GetString("state") != "invalidated" || cancelled.GetString("outcome_code") != "work_no_longer_eligible" || cancelled.GetString("lease_until") != "" || cancelled.GetString("worker_id") != "" {
			t.Fatal("archive did not cancel the running execution", cancelled.PublicExport())
		}
		if apiWebhookRecord(t, a, "reviews", rid).GetString("status") != "withdrawn" {
			t.Fatal("archive did not withdraw the review")
		}
		restoreReview(t, a, false, rid, 200)
		quiet(t, a, task.Id, rid, "restore", deliveries)
		if apiWebhookRecord(t, a, "reviews", rid).GetString("status") != "pending" {
			t.Fatal("review not restored")
		}
	})
}

func TestReviewRestoreRefusals(t *testing.T) {
	a := newTestApp(t)
	options := []map[string]any{
		{"key": "a", "label": "First", "body": "Synthetic first alternative"},
		{"key": "b", "label": "Second", "body": "Synthetic second alternative"},
	}
	file := func(name string) []any {
		return []any{map[string]any{"name": name, "content_base64": "c3ludGhldGlj"}}
	}
	// Every refusal answers both routes alike and leaves every record as it was.
	refused := func(t *testing.T, review, condition string) {
		t.Helper()
		before := crewSnapshot(t, a)
		for _, agent := range []bool{false, true} {
			assertNotRestorable(t, restoreReview(t, a, agent, review, 409), condition)
		}
		if crewSnapshot(t, a) != before {
			t.Fatal("a refused review.restore changed something")
		}
	}
	// A review withdrawn by archiving its task, ready to restore.
	archivedReview := func(t *testing.T, task, request map[string]any) (string, string) {
		t.Helper()
		id, review := requestedReview(t, a, task, request)
		setArchived(t, a, false, id, true, nil)
		return id, review["id"].(string)
	}
	// setCreated rewrites creation times to show they do not decide what is newest.
	setCreated := func(t *testing.T, table string, times map[string]string) {
		t.Helper()
		for id, created := range times {
			if _, err := a.app.DB().NewQuery("UPDATE " + table + " SET created={:created} WHERE id={:id}").Bind(map[string]any{"created": created, "id": id}).Execute(); err != nil {
				t.Fatal(err)
			}
		}
	}
	reviewEvents := func(t *testing.T, review string, want ...string) []string {
		t.Helper()
		rows, err := a.app.FindRecordsByFilter("crew_events", "parent={:parent}", "@rowid", 0, 0, map[string]any{"parent": review})
		if err != nil {
			t.Fatal(err)
		}
		ids, actions := []string{}, []string{}
		for _, r := range rows {
			ids = append(ids, r.Id)
			actions = append(actions, r.GetString("action"))
		}
		if !reflect.DeepEqual(actions, want) {
			t.Fatalf("review events %v; want %v", actions, want)
		}
		return ids
	}

	t.Run("pending review", func(t *testing.T) {
		_, review := requestedReview(t, a, nil, nil)
		refused(t, review["id"].(string), "it is already pending")
	})
	t.Run("decided review", func(t *testing.T) {
		for _, decision := range []string{"approved", "changes_requested", "rejected"} {
			id, review := requestedReview(t, a, nil, nil)
			rid := review["id"].(string)
			crewWrite(t, a, false, "review.decide", rid, 1, map[string]any{"decision": decision}, 200)
			refused(t, rid, "it is decided ("+decision+"), not withdrawn")
			// Archiving the task later does not make a decision restorable.
			setArchived(t, a, false, id, true, nil)
			refused(t, rid, "it is decided ("+decision+"), not withdrawn")
			if apiWebhookRecord(t, a, "reviews", rid).GetString("status") != decision {
				t.Fatal("decision rewritten")
			}
		}
	})
	t.Run("withdrawn by hand, task still active", func(t *testing.T) {
		_, review := requestedReview(t, a, nil, nil)
		rid := review["id"].(string)
		crewWrite(t, a, false, "review.withdraw", rid, 1, map[string]any{}, 200)
		refused(t, rid, "its task is not archived")
	})
	t.Run("withdrawn by hand, task archived later", func(t *testing.T) {
		id, review := requestedReview(t, a, nil, nil)
		rid := review["id"].(string)
		crewWrite(t, a, true, "review.withdraw", rid, 1, map[string]any{}, 200)
		setArchived(t, a, false, id, true, nil)
		refused(t, rid, "it was not withdrawn by archiving its task")
	})
	t.Run("withdrawn by a draft edit, task archived later", func(t *testing.T) {
		id, review := requestedReview(t, a, nil, nil)
		crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"draft": "Synthetic edited draft"}, 200)
		setArchived(t, a, false, id, true, nil)
		refused(t, review["id"].(string), "it was not withdrawn by archiving its task")
	})
	t.Run("withdrawn by an attachment, task archived later", func(t *testing.T) {
		id, review := requestedReview(t, a, nil, nil)
		if out := crewWrite(t, a, true, "attachment.add", "", 0, map[string]any{"task": id, "files": file("late.txt")}, 200); out["review_withdrawn"] != true {
			t.Fatal("attachment did not withdraw the review", out)
		}
		setArchived(t, a, false, id, true, nil)
		refused(t, review["id"].(string), "it was not withdrawn by archiving its task")
	})
	t.Run("restored, withdrawn by hand, archived again", func(t *testing.T) {
		id, rid := archivedReview(t, nil, nil)
		restoreReview(t, a, false, rid, 200)
		crewWrite(t, a, false, "review.withdraw", rid, 3, map[string]any{}, 200)
		setArchived(t, a, false, id, true, nil)
		refused(t, rid, "it was not withdrawn by archiving its task")
		// The newest event is the last one written, whatever the clock said:
		// neither equal nor reversed creation times bring the archive back.
		events := reviewEvents(t, rid, "review.withdraw", "review.restore", "review.withdraw")
		setCreated(t, "crew_events", map[string]string{events[0]: "2030-01-01 00:00:00.000Z", events[1]: "2030-01-01 00:00:00.000Z", events[2]: "2030-01-01 00:00:00.000Z"})
		refused(t, rid, "it was not withdrawn by archiving its task")
		setCreated(t, "crew_events", map[string]string{events[0]: "2030-01-01 00:00:02.000Z", events[1]: "2030-01-01 00:00:01.000Z"})
		refused(t, rid, "it was not withdrawn by archiving its task")
	})
	t.Run("archived twice restores despite a later-stamped restore event", func(t *testing.T) {
		id, rid := archivedReview(t, nil, nil)
		restoreReview(t, a, false, rid, 200)
		setArchived(t, a, false, id, true, nil)
		events := reviewEvents(t, rid, "review.withdraw", "review.restore", "review.withdraw")
		setCreated(t, "crew_events", map[string]string{events[0]: "2030-01-01 00:00:00.000Z", events[1]: "2030-01-01 00:00:02.000Z", events[2]: "2030-01-01 00:00:01.000Z"})
		if restoreReview(t, a, false, rid, 200)["status"] != "pending" {
			t.Fatal("the second archive was not undone")
		}
	})
	t.Run("not the task's newest review", func(t *testing.T) {
		id, first := archivedReview(t, nil, nil)
		setArchived(t, a, false, id, false, nil)
		second := crewWrite(t, a, false, "review.request", id, taskRevision(t, a, id), map[string]any{}, 200)["id"].(string)
		setArchived(t, a, false, id, true, nil)
		refused(t, first, "its task has a newer review")
		// Newest is the review written last, not the latest creation time.
		setCreated(t, "crew_reviews", map[string]string{first: "2030-01-01 00:00:01.000Z", second: "2030-01-01 00:00:00.000Z"})
		refused(t, first, "its task has a newer review")
		// A pending review on the task (unreachable through writes) also refuses.
		older := apiWebhookRecord(t, a, "reviews", first)
		older.Set("status", "pending")
		if err := a.app.Save(older); err != nil {
			t.Fatal(err)
		}
		refused(t, second, "its task has a pending review")
		older.Set("status", "withdrawn")
		if err := a.app.Save(older); err != nil {
			t.Fatal(err)
		}
		if restoreReview(t, a, false, second, 200)["status"] != "pending" {
			t.Fatal("the newest review was not restored")
		}
		if apiWebhookRecord(t, a, "reviews", first).GetString("status") != "withdrawn" {
			t.Fatal("the older review changed")
		}
	})
	t.Run("draft changed between archive and restore", func(t *testing.T) {
		for name, edit := range map[string]map[string]any{
			"draft":     {"draft": "Synthetic edited context"},
			"options":   {"draft_options": []map[string]any{options[0], {"key": "b", "label": "Second", "body": "Synthetic edited alternative"}}},
			"selection": {"draft_selection": "one"},
			"recipient": {"draft_recipient": "Synthetic other reader"},
		} {
			id, rid := archivedReview(t, map[string]any{"draft": "Synthetic context"}, map[string]any{"options": options, "recipient": "Synthetic reader"})
			// Un-archive together with the edit, then archive again.
			setArchived(t, a, false, id, false, edit)
			setArchived(t, a, false, id, true, nil)
			if apiWebhookRecord(t, a, "tasks", id).GetString("status") != "in_progress" {
				t.Fatal(name, "edit changed the status")
			}
			refused(t, rid, "the task draft changed after the review was requested")
		}
	})
	t.Run("draft edited in the archiving write", func(t *testing.T) {
		id, review := requestedReview(t, a, nil, nil)
		setArchived(t, a, false, id, true, map[string]any{"draft": "Synthetic edited draft"})
		refused(t, review["id"].(string), "the task draft changed after the review was requested")
	})
	t.Run("attachment added between archive and restore", func(t *testing.T) {
		id, rid := archivedReview(t, nil, nil)
		setArchived(t, a, false, id, false, nil)
		crewWrite(t, a, false, "attachment.add", "", 0, map[string]any{"task": id, "files": file("added.txt")}, 200)
		setArchived(t, a, false, id, true, nil)
		refused(t, rid, "the task attachments changed after the review was requested")
	})
	t.Run("attachment archived between archive and restore", func(t *testing.T) {
		id := newTask(t, a, map[string]any{"title": "Synthetic evidence task", "draft": "Synthetic draft"})["id"].(string)
		attachment := crewWrite(t, a, false, "attachment.add", "", 0, map[string]any{"task": id, "files": file("evidence.txt")}, 200)["attachments"].([]any)[0].(map[string]any)["id"].(string)
		review := crewWrite(t, a, false, "review.request", id, taskRevision(t, a, id), map[string]any{}, 200)
		if len(review["attachments"].([]any)) != 1 {
			t.Fatal("review did not snapshot the attachment", review)
		}
		rid := review["id"].(string)
		setArchived(t, a, false, id, true, nil)
		setArchived(t, a, false, id, false, nil)
		crewWrite(t, a, false, "attachment.archive", attachment, 1, map[string]any{}, 200)
		setArchived(t, a, false, id, true, nil)
		refused(t, rid, "the task attachments changed after the review was requested")
		// Putting the same file back makes the snapshot match again.
		setArchived(t, a, false, id, false, nil)
		crewWrite(t, a, false, "attachment.restore", attachment, 2, map[string]any{}, 200)
		setArchived(t, a, false, id, true, nil)
		if restoreReview(t, a, false, rid, 200)["status"] != "pending" {
			t.Fatal("matching snapshot was not restored")
		}
	})
	t.Run("status changed between archive and restore", func(t *testing.T) {
		for _, status := range []string{"todo", "done", "wont_do"} {
			id, rid := archivedReview(t, nil, nil)
			setArchived(t, a, false, id, false, map[string]any{"status": status})
			setArchived(t, a, false, id, true, nil)
			refused(t, rid, "its task is no longer In progress ("+status+")")
		}
	})
	t.Run("stale revision, data fields and unknown review", func(t *testing.T) {
		id, rid := archivedReview(t, nil, nil)
		before := crewSnapshot(t, a)
		for _, agent := range []bool{false, true} {
			// The usual revision conflict, without a reason code.
			for _, revision := range []int{1, 3} {
				body := crewWrite(t, a, agent, "review.restore", rid, revision, map[string]any{}, 409)
				if body["message"] != "Revision conflict; reread and reassess." || dig(body, "data", "reason") != nil {
					t.Fatal("stale revision", body)
				}
			}
			raw, _ := json.Marshal(map[string]any{"action": "review.restore", "id": rid, "data": map[string]any{}})
			route := map[bool]string{false: "/api/crew/write", true: "/api/crew/agent-write"}[agent]
			if body := a.request(t, "POST", route, a.token, string(raw), 409); dig(body, "data", "reason") != nil {
				t.Fatal("missing revision", body)
			}
			// data accepts no fields.
			for _, data := range []map[string]any{{"archived": false}, {"note": "Synthetic"}, {"decision": "approved"}} {
				if body := crewWrite(t, a, agent, "review.restore", rid, 2, data, 400); !strings.HasPrefix(body["message"].(string), "Unsupported field: ") {
					t.Fatal("data field", body)
				}
			}
			crewWrite(t, a, agent, "review.restore", "aaaaaaaaaaaaaaa", 1, map[string]any{}, 404)
			// A task id is not a review id.
			crewWrite(t, a, agent, "review.restore", id, 1, map[string]any{}, 404)
		}
		if crewSnapshot(t, a) != before {
			t.Fatal("a refused review.restore changed something")
		}
		// Undo applies once: a repeat with the old revision conflicts, and
		// with the new one the review is no longer restorable.
		if restoreReview(t, a, false, rid, 200)["revision"] != float64(3) {
			t.Fatal("restorable review was refused")
		}
		crewWrite(t, a, false, "review.restore", rid, 2, map[string]any{}, 409)
		refused(t, rid, "it is already pending")
	})
}
