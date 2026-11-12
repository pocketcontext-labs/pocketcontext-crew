package crewruntime

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestReviewChoicesRoundTrip(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{"draft": "Choose the approved alternatives"})
	id := task["id"].(string)
	options := []map[string]any{{"key": "A-linkedin", "label": "Draft A · LinkedIn", "body": "Synthetic A LinkedIn"}, {"key": "A-x", "label": "Draft A · X", "body": "Synthetic A X"}, {"key": "B-linkedin", "label": "Draft B · LinkedIn", "body": "Synthetic B LinkedIn"}, {"key": "B-x", "label": "Draft B · X", "body": "Synthetic B X"}}
	review := crewWrite(t, a, true, "review.request", id, taskRevision(t, a, id), map[string]any{"options": options}, 200)
	if len(review["options"].([]any)) != 4 {
		t.Fatal(review)
	}
	rid := review["id"].(string)
	for _, ds := range []any{nil, []map[string]any{{"key": "unknown", "decision": "approved"}}, []map[string]any{{"key": "A-x", "decision": "approved"}, {"key": "A-x", "decision": "approved"}}, []map[string]any{{"key": "A-x", "decision": "approved"}}} {
		data := map[string]any{"decision": "approved"}
		if ds != nil {
			data["option_decisions"] = ds
		}
		crewWrite(t, a, true, "review.decide", rid, 1, data, 400)
	}
	decisions := []map[string]any{}
	for _, o := range options {
		decisions = append(decisions, map[string]any{"key": o["key"], "decision": "rejected"})
	}
	crewWrite(t, a, true, "review.decide", rid, 1, map[string]any{"decision": "approved", "option_decisions": decisions}, 400)
	decisions[0]["decision"] = "approved"
	decisions[0]["note"] = "Use this on LinkedIn"
	decisions[1]["decision"] = "approved"
	result := crewWrite(t, a, true, "review.decide", rid, 1, map[string]any{"decision": "approved", "option_decisions": decisions}, 200)
	if result["status"] != "approved" || len(result["option_decisions"].([]any)) != 4 {
		t.Fatal(result)
	}
	crewWrite(t, a, true, "review.decide", rid, 2, map[string]any{"decision": "rejected"}, 400)
	rows := crewPost(t, a, "/api/crew/read", map[string]any{"collection": "reviews", "id": rid, "fields": []string{"options", "option_decisions"}}, 200)
	if len(crewItems(t, rows)[0]["option_decisions"].([]any)) != 4 {
		t.Fatal(rows)
	}
	query := crewPost(t, a, "/api/crew/query", map[string]any{"sql": "SELECT options, option_decisions FROM reviews WHERE id='" + rid + "'"}, 200)
	raw, _ := json.Marshal(query)
	if !strings.Contains(string(raw), "A-linkedin") {
		t.Fatal(query)
	}
	events := eventsOf(t, a, id, "review.decide")
	if len(events) != 1 || !strings.Contains(events[0].GetString("changes"), "A-linkedin") {
		t.Fatal(events)
	}
	// A no-option review remains compatible.
	legacy := crewWrite(t, a, false, "review.request", id, taskRevision(t, a, id), map[string]any{}, 200)
	crewWrite(t, a, false, "review.decide", legacy["id"].(string), 1, map[string]any{"decision": "approved"}, 200)
}

func TestReviewEvidencePathsAndOptions(t *testing.T) {
	a := newTestApp(t)
	for _, path := range []string{"/workspace/billboards/concept-11.png", "~/draft.pdf", `C:\design\concept.png`, "file:///home/a/report.pdf", `\\server\share\image.png`, "/home/a/my image.png", "./image.png.", "../images/draft.pdf", "See /workspace/image.png."} {
		task := newTask(t, a, map[string]any{"draft": "Please review `" + path + "`"})
		id := task["id"].(string)
		refused := crewWrite(t, a, true, "review.request", id, taskRevision(t, a, id), map[string]any{}, 400)
		raw, _ := json.Marshal(refused)
		if !strings.Contains(string(raw), "draft_references_unattached_files") {
			t.Fatal(path, refused)
		}
	}
	task := newTask(t, a, map[string]any{"draft": "See https://example.test/images/file.png and normal prose / code"})
	id := task["id"].(string)
	for _, opts := range []any{[]map[string]any{{"key": "a", "label": "A", "body": "/tmp/a.pdf"}}, []map[string]any{{"key": "a", "label": "A", "body": "a"}, {"key": "a", "label": "B", "body": "b"}}, []map[string]any{{"key": "a", "label": "A", "body": "![missing](attachment:aaaaaaaaaaaaaaa)"}}} {
		crewWrite(t, a, true, "review.request", id, taskRevision(t, a, id), map[string]any{"options": opts}, 400)
	}
	crewWrite(t, a, true, "review.request", id, taskRevision(t, a, id), map[string]any{}, 200)
}

func TestStableHoldAndClaimStart(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{"draft": "Synthetic draft"})
	id := task["id"].(string)
	held := task["held_since"].(string)
	if held == "" {
		t.Fatal(task)
	}
	task = crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"title": "Edited held task"}, 200)
	if task["held_since"] != held {
		t.Fatal("edit reset hold", task)
	}
	crewWrite(t, a, false, "task.comment", id, taskRevision(t, a, id), map[string]any{"body": "Comment while held"}, 200)
	if apiWebhookRecord(t, a, "tasks", id).GetString("held_since") != held {
		t.Fatal("comment reset hold")
	}
	task = crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"readiness": "ready"}, 200)
	if task["held_since"] != "" {
		t.Fatal(task)
	}
	review := crewWrite(t, a, false, "review.request", id, taskRevision(t, a, id), map[string]any{}, 200)
	_ = review
	task = crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"draft": "Changed draft"}, 200)
	if task["held_since"] == "" || task["readiness"] != "waiting" {
		t.Fatal("automatic hold has no timestamp", task)
	}
	agent := crewOp(t, a, "agent.create", nil, map[string]any{"name": "Implement", "kind": "external"})
	claimable := newTask(t, a, map[string]any{"assigned_agent": agent["id"], "readiness": "ready"})
	cid := claimable["id"].(string)
	claimed := crewWrite(t, a, true, "task.claim", cid, taskRevision(t, a, cid), map[string]any{"assigned_agent": agent["id"]}, 200)
	start := claimed["claimed_at"].(string)
	if _, err := time.Parse(time.RFC3339, start); err != nil {
		t.Fatal(start, err)
	}
	renewed := crewWrite(t, a, true, "task.claim_renew", cid, taskRevision(t, a, cid), map[string]any{}, 200)
	if renewed["claimed_at"] != start {
		t.Fatal("renewal changed start")
	}
	released := crewWrite(t, a, true, "task.release", cid, taskRevision(t, a, cid), map[string]any{}, 200)
	if released["claimed_at"] != "" {
		t.Fatal(released)
	}
	crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"held_since": "invented"}, 400)
	for _, status := range []string{"done", "wont_do"} {
		closed := crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": status}, 200)
		if closed["held_since"] != "" {
			t.Fatal("terminal hold timestamp", closed)
		}
		reopened := crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "todo"}, 200)
		if reopened["held_since"] == "" {
			t.Fatal("reopened hold missing", reopened)
		}
	}
}

func TestReviewOptionsRequireActiveOwnEvidence(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{"draft": "Review this evidence", "readiness": "ready"})
	id := task["id"].(string)
	file := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": id}), []testFile{{"synthetic.png", tinyPNG(t, 3, 3)}}, 200)["attachments"].([]any)[0].(map[string]any)
	body := "![choice](attachment:" + file["id"].(string) + ")"
	opts := []map[string]any{{"key": "A", "label": "Choice A", "body": body}}
	review := crewWrite(t, a, true, "review.request", id, taskRevision(t, a, id), map[string]any{"options": opts}, 200)
	if len(review["attachments"].([]any)) != 1 {
		t.Fatal("snapshot missing evidence", review)
	}
	crewWrite(t, a, false, "attachment.archive", file["id"].(string), 1, map[string]any{}, 200)
	held := readTask(t, a, id)
	if held["held_since"] == "" || held["readiness"] != "waiting" {
		t.Fatal("attachment withdrawal missed hold timestamp", held)
	}
	crewWrite(t, a, true, "review.request", id, taskRevision(t, a, id), map[string]any{"options": opts}, 400)
	historic := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "reviews", "id": review["id"]}, 200))[0]
	if historic["status"] != "withdrawn" || len(historic["options"].([]any)) != 1 || len(historic["attachments"].([]any)) != 1 {
		t.Fatal("snapshot rewritten", historic)
	}
	other := newTask(t, a, map[string]any{"draft": "Another task"})
	crewWrite(t, a, true, "review.request", other["id"].(string), 1, map[string]any{"options": opts}, 400)
}

func TestReviewChoicesMigrationPreservesLegacyTimes(t *testing.T) {
	a := newTestApp(t)
	agent := crewOp(t, a, "agent.create", nil, map[string]any{"name": "Migration coder", "kind": "external"})
	task := newTask(t, a, map[string]any{"assigned_agent": agent["id"], "readiness": "ready"})
	id := task["id"].(string)
	crewWrite(t, a, true, "task.claim", id, taskRevision(t, a, id), map[string]any{"assigned_agent": agent["id"]}, 200)
	claimEvents := eventsOf(t, a, id, "task.claim")
	claimedAt := claimEvents[0].GetString("created")
	held := newTask(t, a, map[string]any{"draft": "Legacy review"})
	hid := held["id"].(string)
	review := crewWrite(t, a, false, "review.request", hid, taskRevision(t, a, hid), map[string]any{}, 200)
	updated := apiWebhookRecord(t, a, "tasks", hid).GetString("updated")
	closed := newTask(t, a, map[string]any{"status": "done"})
	// Reconstruct the previous schema, preserving task/history records.
	tasks, err := a.app.FindCollectionByNameOrId("crew_tasks")
	if err != nil {
		t.Fatal(err)
	}
	tasks.Fields.RemoveByName("held_since")
	tasks.Fields.RemoveByName("claimed_at")
	if err = a.app.Save(tasks); err != nil {
		t.Fatal(err)
	}
	reviews, err := a.app.FindCollectionByNameOrId("crew_reviews")
	if err != nil {
		t.Fatal(err)
	}
	reviews.Fields.RemoveByName("options")
	reviews.Fields.RemoveByName("option_decisions")
	if err = a.app.Save(reviews); err != nil {
		t.Fatal(err)
	}
	if err = runFixtureMigration(t, a.app, "../../pb_migrations/1801300000_crew_review_choices.js"); err != nil {
		t.Fatal(err)
	}
	if got := apiWebhookRecord(t, a, "tasks", id).GetString("claimed_at"); got != claimedAt {
		t.Fatal("legacy claim event not recovered", got, claimedAt)
	}
	migrated := apiWebhookRecord(t, a, "tasks", hid)
	if migrated.GetString("held_since") != updated || migrated.GetString("updated") != updated {
		t.Fatal("legacy hold fallback or updated changed", migrated.PublicExport())
	}
	if apiWebhookRecord(t, a, "tasks", closed["id"].(string)).GetString("held_since") != "" {
		t.Fatal("terminal task acquired hold")
	}
	oldReview := apiWebhookRecord(t, a, "reviews", review["id"].(string))
	if oldReview.GetString("options") != "" && oldReview.GetString("options") != "null" {
		t.Fatal("legacy options invented", oldReview.PublicExport())
	}
	crewWrite(t, a, false, "review.decide", review["id"].(string), 1, map[string]any{"decision": "approved"}, 200)
}
