package crewruntime

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func proofOf(run map[string]any) map[string]any {
	p, _ := run["execution"].(map[string]any)
	return p
}

func fencedWrite(t *testing.T, a *testApp, action, id string, revision int, data map[string]any, proof map[string]any, key string, status int) map[string]any {
	t.Helper()
	b := map[string]any{"action": action, "id": id, "expected_revision": revision, "reported_agent": "synthetic-bot", "data": data, "execution": proof}
	if key != "" {
		b["idempotency_key"] = key
	}
	raw, _ := json.Marshal(b)
	return a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), status)
}

// The holder's own review.request is the normal last step of governed work:
// it completes the execution, and a later fenced comment or execution.complete
// from the same worker still succeeds.
func TestReviewRequestCompletesHoldersExecution(t *testing.T) {
	a, _, task, event := webhookFixture(t)
	run := beginSelf(t, a, event, "synthetic-review-worker")
	proof := proofOf(run)
	updated := fencedWrite(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"draft": "Synthetic outbound draft"}, proof, "", 200)
	// A fenced comment before the review works as always.
	fencedWrite(t, a, "task.comment", task.Id, int(updated["revision"].(float64)), map[string]any{"body": "Synthetic before review"}, proof, "comment-before", 200)
	review := fencedWrite(t, a, "review.request", task.Id, int(updated["revision"].(float64)), map[string]any{}, proof, "", 200)
	done, _ := review["execution_completed"].(map[string]any)
	if done == nil || done["id"] != proof["id"] || done["outcome_code"] != "review_requested" || done["state"] != "completed" {
		t.Fatal("review.request did not report the completed execution", review)
	}
	stored := apiWebhookRecord(t, a, "webhook_executions", proof["id"].(string))
	if stored.GetString("state") != "completed" || stored.GetString("outcome_code") != "review_requested" || stored.GetString("completed_at") == "" || stored.GetString("lease_until") != "" {
		t.Fatal("execution not completed by review", stored.PublicExport())
	}
	events := eventsOf(t, a, task.Id, "review.request")
	if len(events) != 1 || !strings.Contains(events[0].GetString("changes"), `"execution_completed":"`+stored.Id+`"`) {
		t.Fatal("review event does not name the completed execution")
	}
	current := apiWebhookRecord(t, a, "tasks", task.Id)
	// The holder's final fenced comment after review is accepted and replays.
	fencedWrite(t, a, "task.comment", task.Id, current.GetInt("revision"), map[string]any{"body": "Synthetic final note"}, proof, "comment-after", 200)
	fencedWrite(t, a, "task.comment", task.Id, current.GetInt("revision"), map[string]any{"body": "Synthetic final note"}, proof, "comment-after", 200)
	if n := len(eventsOf(t, a, task.Id, "task.comment")); n != 2 {
		t.Fatal("comments", n)
	}
	// Proof on other writes is refused; the execution is finished.
	assertRefusal(t, fencedWrite(t, a, "task.update", task.Id, current.GetInt("revision"), map[string]any{"description": "x"}, proof, "", 409), "execution_conflict")
	wrong := map[string]any{"id": proof["id"], "worker_id": proof["worker_id"], "fence": proof["fence"].(float64) + 1}
	assertRefusal(t, fencedWrite(t, a, "task.comment", task.Id, current.GetInt("revision"), map[string]any{"body": "Synthetic wrong fence"}, wrong, "comment-wrong", 409), "execution_conflict")
	// A late execution.complete is a no-op acknowledgement, even at the old revision.
	complete := map[string]any{"worker_id": proof["worker_id"], "fence": proof["fence"], "outcome": "completed"}
	out := executionOperation(t, a, "execution.complete", stored.Id, int(run["revision"].(float64)), complete, "late-complete", false, 200)
	if out["already_completed"] != true || out["outcome_code"] != "review_requested" {
		t.Fatal("late complete", out)
	}
	if apiWebhookRecord(t, a, "webhook_executions", stored.Id).GetInt("revision") != stored.GetInt("revision") {
		t.Fatal("late complete changed the execution")
	}
	complete["mark_done"] = true
	complete["task_revision"] = current.GetInt("revision")
	executionOperation(t, a, "execution.complete", stored.Id, stored.GetInt("revision"), complete, "late-done", false, 400)
	complete = map[string]any{"worker_id": "synthetic-other", "fence": proof["fence"], "outcome": "completed"}
	executionOperation(t, a, "execution.complete", stored.Id, stored.GetInt("revision"), complete, "other-complete", false, 409)
	if apiWebhookRecord(t, a, "tasks", task.Id).GetString("status") != "needs_review" {
		t.Fatal("task left review")
	}
}

// A review requested by anyone else still invalidates the live execution.
func TestReviewRequestByOthersInvalidatesExecution(t *testing.T) {
	a, _, task, event := webhookFixture(t)
	run := beginSelf(t, a, event, "synthetic-held")
	webhookOperation(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"draft": "Synthetic owner draft"}, "")
	current := apiWebhookRecord(t, a, "tasks", task.Id)
	out := crewWrite(t, a, false, "review.request", task.Id, current.GetInt("revision"), map[string]any{}, 200)
	if out["execution_completed"] != nil {
		t.Fatal("owner review completed the execution", out)
	}
	stored := apiWebhookRecord(t, a, "webhook_executions", proofOf(run)["id"].(string))
	if stored.GetString("state") != "invalidated" || stored.GetString("outcome_code") != "work_no_longer_eligible" {
		t.Fatal("execution not invalidated", stored.PublicExport())
	}
}

func TestPutOnHoldCancelsLiveExecution(t *testing.T) {
	for _, owner := range []bool{false, true} {
		t.Run(map[bool]string{false: "work client without proof", true: "reader"}[owner], func(t *testing.T) {
			a, _, task, event := webhookFixture(t)
			run := beginSelf(t, a, event, "synthetic-hold-worker")
			proof := proofOf(run)
			before := apiWebhookRecord(t, a, "tasks", task.Id)
			if !owner {
				// Other writes without proof stay fenced.
				assertRefusal(t, archiveWrite(t, a, task.Id, map[string]any{"readiness": "waiting", "description": "Synthetic sneak"}, 409), "execution_required")
			}
			held := selfStartWrite(t, a, "task.update", task.Id, before.GetInt("revision"), map[string]any{"readiness": "on_hold", "waiting_reason": "Synthetic owner decision"}, archiveAgent, owner, 200)
			if held["readiness"] != "waiting" || held["waiting_reason"] != "Synthetic owner decision" {
				t.Fatal("hold not stored as waiting", held)
			}
			after := apiWebhookRecord(t, a, "tasks", task.Id)
			if after.GetInt("wake_generation") <= before.GetInt("wake_generation") || after.GetInt("execution_required_generation") != 0 {
				t.Fatal("hold did not advance generation or release governance", after.PublicExport())
			}
			stored := apiWebhookRecord(t, a, "webhook_executions", proof["id"].(string))
			if stored.GetString("state") != "invalidated" || stored.GetString("outcome_code") != "put_on_hold" || stored.GetString("lease_until") != "" ||
				stored.GetString("worker_id") != "" || stored.GetInt("fence") <= int(proof["fence"].(float64)) || stored.GetString("completed_at") == "" {
				t.Fatal("execution not cancelled", stored.PublicExport())
			}
			cancels := eventsOf(t, a, task.Id, "execution.cancel")
			if len(cancels) != 1 || !strings.Contains(cancels[0].GetString("changes"), `"outcome_code":"put_on_hold"`) || !strings.Contains(cancels[0].GetString("changes"), stored.Id) {
				t.Fatal("hold not logged in task activity", len(cancels))
			}
			// The old worker is fenced off.
			assertRefusal(t, fencedWrite(t, a, "task.comment", task.Id, after.GetInt("revision"), map[string]any{"body": "Synthetic stale"}, proof, "stale-after-hold", 409), "execution_conflict")
			executionOperation(t, a, "execution.renew", stored.Id, stored.GetInt("revision"), map[string]any{"worker_id": proof["worker_id"], "fence": proof["fence"]}, "renew-after-hold", false, 409)
			for _, d := range apiWebhookDeliveries(t, a, task.Id) {
				if d.GetString("state") == "pending" {
					t.Fatal("queued wake survived the hold")
				}
			}
		})
	}
}

// An on-hold task never wakes, whatever changes; setting Ready wakes once.
func TestOnHoldTaskNeverWakes(t *testing.T) {
	a, config, _, _ := commentFixture(t)
	dispatcher := config.GetString("agent")
	other := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Synthetic second bot"}, "")["id"].(string)
	webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": other, "bot_ref": "synthetic-second"}, "")
	for _, owner := range []bool{true, false} {
		created := selfStartWrite(t, a, "task.create", "", 0, map[string]any{"title": "Synthetic held task", "assigned_agent": dispatcher, "readiness": "on_hold"}, "Synthetic creator", owner, 200)
		id := created["id"].(string)
		if created["readiness"] != "waiting" {
			t.Fatal("on_hold alias not stored as waiting", created)
		}
		rev := func() int { return apiWebhookRecord(t, a, "tasks", id).GetInt("revision") }
		selfStartWrite(t, a, "task.update", id, rev(), map[string]any{"assigned_agent": other}, "Synthetic creator", owner, 200)
		selfStartWrite(t, a, "task.update", id, rev(), map[string]any{"assigned_agent": ""}, "Synthetic creator", owner, 200)
		selfStartWrite(t, a, "task.update", id, rev(), map[string]any{"assigned_agent": dispatcher}, "Synthetic creator", owner, 200)
		ownerComment(t, a, id, "Synthetic owner comment on a held task")
		agentWrite(t, a, "task.comment", id, rev(), map[string]any{"body": "Synthetic agent comment"}, 200)
		selfStartWrite(t, a, "task.update", id, rev(), map[string]any{"status": "done"}, "", true, 200)
		selfStartWrite(t, a, "task.update", id, rev(), map[string]any{"status": "todo"}, "", true, 200)
		if n := len(apiWebhookDeliveries(t, a, id)); n != 0 {
			t.Fatal("held task woke", n)
		}
		selfStartWrite(t, a, "task.update", id, rev(), map[string]any{"readiness": "ready"}, "", true, 200)
		wakes := apiWebhookDeliveries(t, a, id)
		if len(wakes) != 1 || !strings.Contains(wakes[0].GetString("payload"), `"reason":"ready"`) {
			t.Fatal("Ready did not wake exactly once", len(wakes))
		}
	}
	// The read filter accepts the alias too.
	raw, _ := json.Marshal(map[string]any{"collection": "tasks", "readiness": "on_hold", "fields": []string{"readiness"}})
	for _, item := range a.request(t, "POST", "/api/crew/read", a.token, string(raw), 200)["items"].([]any) {
		if item.(map[string]any)["readiness"] != "waiting" {
			t.Fatal("on_hold filter", item)
		}
	}
	raw, _ = json.Marshal(map[string]any{"action": "task.create", "data": map[string]any{"title": "x", "readiness": "paused"}})
	a.request(t, "POST", "/api/crew/write", a.token, string(raw), 400)
}

func TestAutomaticHoldsCarryReasons(t *testing.T) {
	t.Run("draft edited", func(t *testing.T) {
		a, _, task, _ := webhookFixture(t)
		webhookOperation(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"draft": "Synthetic first draft"}, "")
		current := apiWebhookRecord(t, a, "tasks", task.Id)
		crewWrite(t, a, false, "review.request", task.Id, current.GetInt("revision"), map[string]any{}, 200)
		current = apiWebhookRecord(t, a, "tasks", task.Id)
		out := crewWrite(t, a, true, "task.update", task.Id, current.GetInt("revision"), map[string]any{"draft": "Synthetic second draft"}, 200)
		if out["readiness"] != "waiting" || out["waiting_reason"] != "Draft edited" {
			t.Fatal("draft edit hold", out)
		}
		// Going Ready clears the reason.
		ready := crewWrite(t, a, false, "task.update", task.Id, int(out["revision"].(float64)), map[string]any{"readiness": "ready"}, 200)
		if ready["waiting_reason"] != "" {
			t.Fatal("Ready kept the hold reason", ready)
		}
	})
	t.Run("review withdrawn", func(t *testing.T) {
		a, _, task, _ := webhookFixture(t)
		webhookOperation(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"draft": "Synthetic draft"}, "")
		current := apiWebhookRecord(t, a, "tasks", task.Id)
		crewWrite(t, a, false, "review.request", task.Id, current.GetInt("revision"), map[string]any{}, 200)
		crewWrite(t, a, true, "attachment.add", "", 0, map[string]any{"task": task.Id, "files": []any{
			map[string]any{"name": "late.txt", "content_base64": "bGF0ZQ=="}}}, 200)
		after := apiWebhookRecord(t, a, "tasks", task.Id)
		if after.GetString("readiness") != "waiting" || after.GetString("waiting_reason") != "Review withdrawn" {
			t.Fatal("attachment hold", after.PublicExport())
		}
	})
	t.Run("hand-off limit", func(t *testing.T) {
		a, _, _, _ := webhookFixture(t)
		routing, _ := a.app.FindFirstRecordByFilter("crew_webhook_routing", "singleton='routing'")
		agentWrite(t, a, "webhook.routing.update", routing.Id, routing.GetInt("revision"), map[string]any{"max_bot_handoffs": 1}, 200)
		b := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Synthetic B"}, "")["id"].(string)
		c := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Synthetic C"}, "")["id"].(string)
		task := agentWrite(t, a, "task.create", "", 0, map[string]any{"title": "Synthetic loop", "assigned_agent": b, "readiness": "ready"}, 200)
		out := agentWrite(t, a, "task.update", task["id"].(string), int(task["revision"].(float64)), map[string]any{"assigned_agent": c}, 200)
		if out["readiness"] != "waiting" || out["waiting_reason"] != "Bot hand-off limit reached" {
			t.Fatal("hand-off hold", out)
		}
	})
}

func TestCommentWithFiles(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	id := task["id"].(string)
	rev := func() int { return apiWebhookRecord(t, a, "tasks", id).GetInt("revision") }
	shot := tinyPNG(t, 12, 8)
	// Work client (MCP shape): base64 files with a placeholder.
	out := crewWrite(t, a, true, "task.comment", id, rev(), map[string]any{"body": "Synthetic repro ![step](attachment:new-1)", "files": []any{
		map[string]any{"name": "step.png", "content_base64": base64.StdEncoding.EncodeToString(shot)},
	}}, 200)
	added, _ := out["attachments"].([]any)
	if len(added) != 1 || out["review_withdrawn"] != false {
		t.Fatal("comment attachments", out)
	}
	att := added[0].(map[string]any)
	if att["parent"] != id || att["parent_kind"] != "task" || att["image"] != true {
		t.Fatal("attachment not on the task", att)
	}
	comments := eventsOf(t, a, id, "task.comment")
	if len(comments) != 1 || comments[0].GetString("body") != "Synthetic repro ![step](attachment:"+att["id"].(string)+")" {
		t.Fatal("stored comment body", comments[0].GetString("body"))
	}
	if !strings.Contains(comments[0].GetString("changes"), att["id"].(string)) || len(eventsOf(t, a, id, "attachment.add")) != 1 {
		t.Fatal("comment events")
	}
	// Reader: multipart with a placeholder.
	out = multipartRequest(t, a, "/api/crew/write", a.token, map[string]any{"action": "task.comment", "id": id, "expected_revision": rev(), "data": map[string]any{"body": "Synthetic log [run](attachment:new-1)"}},
		[]testFile{{"run.log", []byte("synthetic line\n")}}, 200)
	if len(out["attachments"].([]any)) != 1 {
		t.Fatal("multipart comment", out)
	}
	// Upload first, then reference an existing attachment of the same task.
	crewWrite(t, a, false, "task.comment", id, rev(), map[string]any{"body": "See ![again](attachment:" + att["id"].(string) + ")"}, 200)
	// Refusals: a placeholder without files, an unknown ID, another item's
	// attachment, a data: image, a refused file. Nothing is saved.
	other := newTask(t, a, map[string]any{"title": "Synthetic other"})
	foreign := crewWrite(t, a, true, "attachment.add", "", 0, map[string]any{"task": other["id"], "files": []any{map[string]any{"name": "f.txt", "content_base64": "Zg=="}}}, 200)["attachments"].([]any)[0].(map[string]any)
	commentsBefore := len(eventsOf(t, a, id, "task.comment"))
	attachmentsBefore := len(attachmentsOf(t, a, id, false))
	crewWrite(t, a, true, "task.comment", id, rev(), map[string]any{"body": "![x](attachment:new-1)"}, 400)
	crewWrite(t, a, true, "task.comment", id, rev(), map[string]any{"body": "![x](attachment:aaaaaaaaaaaaaaa)"}, 400)
	crewWrite(t, a, true, "task.comment", id, rev(), map[string]any{"body": "![x](attachment:" + foreign["id"].(string) + ")"}, 400)
	crewWrite(t, a, true, "task.comment", id, rev(), map[string]any{"body": "![x](data:image/png;base64,AAAA)"}, 400)
	crewWrite(t, a, true, "task.comment", id, rev(), map[string]any{"body": "![x](attachment:new-2)", "files": []any{map[string]any{"name": "a.txt", "content_base64": "YQ=="}}}, 400)
	bad := crewWrite(t, a, true, "task.comment", id, rev(), map[string]any{"body": "two files", "files": []any{
		map[string]any{"name": "ok.txt", "content_base64": "b2s="},
		map[string]any{"name": "empty.txt", "content_base64": ""},
	}}, 400)
	if fileErrors(bad)["files.2"] == nil {
		t.Fatal("refused file not reported", bad)
	}
	if len(eventsOf(t, a, id, "task.comment")) != commentsBefore || len(attachmentsOf(t, a, id, false)) != attachmentsBefore {
		t.Fatal("a refused comment saved something")
	}
	// Archived attachments cannot be newly referenced.
	crewWrite(t, a, false, "attachment.archive", att["id"].(string), 1, map[string]any{}, 200)
	crewWrite(t, a, false, "task.comment", id, rev(), map[string]any{"body": "![x](attachment:" + att["id"].(string) + ")"}, 400)
	// Comments with files on a task with a pending review withdraw it.
	crewWrite(t, a, false, "task.update", id, rev(), map[string]any{"draft": "Synthetic draft"}, 200)
	crewWrite(t, a, false, "review.request", id, rev(), map[string]any{}, 200)
	out = crewWrite(t, a, true, "task.comment", id, rev(), map[string]any{"body": "late file", "files": []any{map[string]any{"name": "late.txt", "content_base64": "bGF0ZQ=="}}}, 200)
	if out["review_withdrawn"] != true || apiWebhookRecord(t, a, "tasks", id).GetString("waiting_reason") != "Review withdrawn" {
		t.Fatal("comment file did not withdraw the review", out)
	}
}

// Fenced comments with files fingerprint the files: a retry with the same
// files replays, different files conflict.
func TestFencedCommentWithFilesIsIdempotent(t *testing.T) {
	a, _, task, event := webhookFixture(t)
	proof := proofOf(beginSelf(t, a, event, "synthetic-file-comment"))
	data := func(content string) map[string]any {
		return map[string]any{"body": "Synthetic ![s](attachment:new-1)", "files": []any{map[string]any{"name": "s.txt", "content_base64": base64.StdEncoding.EncodeToString([]byte(content))}}}
	}
	first := fencedWrite(t, a, "task.comment", task.Id, task.GetInt("revision"), data("one"), proof, "file-comment", 200)
	again := fencedWrite(t, a, "task.comment", task.Id, task.GetInt("revision"), data("one"), proof, "file-comment", 200)
	if first["attachments"].([]any)[0].(map[string]any)["id"] != again["attachments"].([]any)[0].(map[string]any)["id"] {
		t.Fatal("replay created another attachment")
	}
	fencedWrite(t, a, "task.comment", task.Id, task.GetInt("revision"), data("two"), proof, "file-comment", 409)
	if n := len(attachmentsOf(t, a, task.Id, false)); n != 1 {
		t.Fatal("attachments", n)
	}
}

func TestOverdueBridgesRead(t *testing.T) {
	a, c, event, recipient := parentBridgeFixture(t, false)
	bridgeParent(t, a, bridgePrepare(t, a, event, "overdue-test-wake"), "overdue-test-parent")
	webhookOperation(t, a, "webhook.enable", c.Id, c.GetInt("revision"), nil, "")
	stranded := func(title, creator string) (string, string) {
		task := selfStartWrite(t, a, "task.create", "", 0, map[string]any{"title": title, "assigned_agent": recipient, "readiness": "ready", "status": "todo"}, creator, false, 200)
		id := task["id"].(string)
		d := apiWebhookDeliveries(t, a, id)
		if len(d) != 1 {
			t.Fatal("no wake for", title, len(d))
		}
		r := bridgePrepare(t, a, map[string]any{"event_id": d[0].GetString("event_id"), "epoch": d[0].GetString("epoch")}, "wake-"+id)
		stored := apiWebhookRecord(t, a, "webhook_bridges", r["id"].(string))
		stored.Set("deadline_at", time.Now().Add(-time.Minute).UTC().Format(time.RFC3339))
		if err := a.app.Save(stored); err != nil {
			t.Fatal(err)
		}
		return id, stored.Id
	}
	overdue := func() []string {
		raw, _ := json.Marshal(map[string]any{"collection": "webhook_bridges", "overdue": true, "fields": []string{"task_id", "overdue", "state"}})
		out := a.request(t, "POST", "/api/crew/read", a.token, string(raw), 200)
		ids := []string{}
		for _, x := range out["items"].([]any) {
			item := x.(map[string]any)
			if item["overdue"] != true || item["state"] != "wake_prepared" {
				t.Fatal("bad overdue item", item)
			}
			ids = append(ids, item["id"].(string))
		}
		return ids
	}
	keep, keepBridge := stranded("Synthetic stranded", "Synthetic owner bot")
	_, selfBridge := stranded("Synthetic self created", "Synthetic webhook agent")
	doneTask, _ := stranded("Synthetic finished", "Synthetic owner bot")
	selfStartWrite(t, a, "task.update", doneTask, apiWebhookRecord(t, a, "tasks", doneTask).GetInt("revision"), map[string]any{"status": "done"}, "", true, 200)
	heldTask, _ := stranded("Synthetic superseded", "Synthetic owner bot")
	selfStartWrite(t, a, "task.update", heldTask, apiWebhookRecord(t, a, "tasks", heldTask).GetInt("revision"), map[string]any{"readiness": "waiting"}, "", true, 200)
	got := overdue()
	if len(got) != 1 || got[0] != keepBridge {
		t.Fatal("overdue bridges", got, "want", keepBridge, "not", selfBridge)
	}
	// Paging works on the filtered list, and the filter is bridges-only.
	raw, _ := json.Marshal(map[string]any{"collection": "webhook_bridges", "overdue": true, "limit": 1, "offset": 1})
	if items := a.request(t, "POST", "/api/crew/read", a.token, string(raw), 200)["items"].([]any); len(items) != 0 {
		t.Fatal("offset past the list", items)
	}
	raw, _ = json.Marshal(map[string]any{"collection": "tasks", "overdue": true})
	a.request(t, "POST", "/api/crew/read", a.token, string(raw), 400)
	raw, _ = json.Marshal(map[string]any{"collection": "webhook_bridges", "overdue": false})
	a.request(t, "POST", "/api/crew/read", a.token, string(raw), 400)
	// A bridge still within its deadline is not overdue.
	stored := apiWebhookRecord(t, a, "webhook_bridges", keepBridge)
	stored.Set("deadline_at", time.Now().Add(time.Minute).UTC().Format(time.RFC3339))
	a.app.Save(stored)
	if len(overdue()) != 0 {
		t.Fatal("bridge within deadline listed")
	}
	_ = keep
}
