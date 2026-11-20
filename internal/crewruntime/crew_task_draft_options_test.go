package crewruntime

import (
	"reflect"
	"strings"
	"testing"
)

func TestTaskDraftOptionsSnapshotAndResubmission(t *testing.T) {
	a := newTestApp(t)
	opts := []map[string]any{{"key": "A", "label": "Main", "body": "Main version"}, {"key": "B", "label": "Alternate", "body": "Alternate version"}}
	task := newTask(t, a, map[string]any{"draft": "Main version"})
	id := task["id"].(string)
	// Work clients can still supply options directly when requesting approval.
	request := crewWrite(t, a, true, "review.request", id, 1, map[string]any{
		"options": opts, "selection": "one", "recipient": " Editor ",
	}, 200)
	saved := readTask(t, a, id)
	if !reflect.DeepEqual(request["options"], saved["draft_options"]) || saved["draft_recipient"] != "Editor" || saved["draft_selection"] != "one" {
		t.Fatal("request did not store its options on the task", saved)
	}
	// Reordering the JSON object properties or trimming a label does not edit the option.
	opts[0]["label"] = " Main "
	task = crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"draft_options": opts, "draft_recipient": "Editor"}, 200)
	if task["status"] != "needs_review" {
		t.Fatal("unchanged options withdrew the review", task)
	}
	opts[0]["body"] = "Edited main version"
	opts[1]["body"] = "Edited alternative"
	// A stale edit cannot change either record.
	crewWrite(t, a, false, "task.update", id, 1, map[string]any{"draft_options": opts}, 409)
	task = crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"draft_options": opts, "draft": "Main version"}, 200)
	if task["draft"] != "Edited main version" || task["waiting_reason"] != "Draft edited" || task["status"] != "in_progress" {
		t.Fatal("option edit lost its mirrored draft or the hold", task)
	}
	review := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "reviews", "id": request["id"]}, 200))[0]
	if review["status"] != "withdrawn" || !reflect.DeepEqual(review["options"], request["options"]) || review["draft"] != "Main version" {
		t.Fatal("old review changed", review)
	}
	resubmitted := crewWrite(t, a, false, "review.request", id, taskRevision(t, a, id), map[string]any{}, 200)
	if !reflect.DeepEqual(resubmitted["options"], task["draft_options"]) || resubmitted["draft"] != task["draft"] || resubmitted["recipient"] != "Editor" || resubmitted["selection"] != "one" {
		t.Fatal("request missed saved working content", resubmitted)
	}
	// Recipient-only changes are also part of the submitted version.
	task = crewWrite(t, a, true, "task.update", id, taskRevision(t, a, id), map[string]any{"draft_recipient": ""}, 200)
	if task["status"] != "in_progress" || !reflect.DeepEqual(task["draft_options"], resubmitted["options"]) {
		t.Fatal("recipient edit did not withdraw and retain options", task)
	}
	task = crewWrite(t, a, true, "task.update", id, taskRevision(t, a, id), map[string]any{"draft_options": opts[1:]}, 200)
	if task["draft"] != "" {
		t.Fatal("removed option still visible in standalone draft", task)
	}
	task = crewWrite(t, a, true, "task.update", id, taskRevision(t, a, id), map[string]any{"draft_options": []any{}, "draft": "Standalone context"}, 200)
	if task["draft_selection"] != "any" || task["draft"] != "Standalone context" || len(task["draft_options"].([]any)) != 0 {
		t.Fatal("expected a standalone draft", task)
	}
}

func TestDraftOptionsCreateWithFiles(t *testing.T) {
	a := newTestApp(t)
	opts := []map[string]any{{"key": "A", "label": "Image", "body": "![first](attachment:new-1)"}}
	task := multipartRequest(t, a, "/api/crew/write", a.token, envelope("task.create", map[string]any{
		"title": "Synthetic file draft", "draft_options": opts, "draft_selection": "one",
	}), []testFile{{"synthetic.png", tinyPNG(t, 3, 3)}}, 200)
	id := task["id"].(string)
	file := task["attachments"].([]any)[0].(map[string]any)["id"].(string)
	choices := task["draft_options"].([]any)
	if choices[0].(map[string]any)["body"] != "![first](attachment:"+file+")" {
		t.Fatal("unresolved draft option attachment", choices)
	}
	review := crewWrite(t, a, false, "review.request", id, taskRevision(t, a, id), map[string]any{}, 200)
	if !reflect.DeepEqual(choices, review["options"]) || len(review["attachments"].([]any)) != 1 {
		t.Fatal(review)
	}
	other := newTask(t, a, map[string]any{})
	crewWrite(t, a, true, "task.update", other["id"].(string), 1, map[string]any{"draft_options": choices}, 400)
	// The bounded SQL read accepts the same fields the task reader exposes.
	query := crewPost(t, a, "/api/crew/query", map[string]any{"sql": "SELECT draft_options, draft_selection, draft_recipient FROM tasks WHERE id='" + id + "'"}, 200)
	if len(query["rows"].([]any)) != 1 {
		t.Fatal(query)
	}
}

func TestDraftOptionsMigrationCopiesPendingOnly(t *testing.T) {
	a := newTestApp(t)
	opts := []map[string]any{{"key": "legacy", "label": "Stored only on the review", "body": "Historical alternative"}}
	makeReview := func() (string, string) {
		task := newTask(t, a, map[string]any{"draft": "Independent context"})
		id := task["id"].(string)
		r := crewWrite(t, a, true, "review.request", id, 1, map[string]any{"options": opts, "selection": "one", "recipient": "Reviewer"}, 200)
		return id, r["id"].(string)
	}
	pendingID, reviewID := makeReview()
	closedID, closedReview := makeReview()
	crewWrite(t, a, false, "review.withdraw", closedReview, 1, map[string]any{}, 200)
	before := apiWebhookRecord(t, a, "tasks", pendingID)
	oldReview := apiWebhookRecord(t, a, "reviews", reviewID)
	tasks, err := a.app.FindCollectionByNameOrId("crew_tasks")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"draft_options", "draft_selection", "draft_recipient"} {
		tasks.Fields.RemoveByName(name)
	}
	if err = a.app.Save(tasks); err != nil {
		t.Fatal(err)
	}
	if err = runFixtureMigration(t, a.app, "../../pb_migrations/1802200000_crew_task_draft_options.js"); err != nil {
		t.Fatal(err)
	}
	after := apiWebhookRecord(t, a, "tasks", pendingID)
	for _, field := range []string{"draft", "revision", "updated", "status"} {
		if before.GetString(field) != after.GetString(field) {
			t.Fatalf("migration changed %s", field)
		}
	}
	if !strings.Contains(after.GetString("draft_options"), "Historical alternative") || after.GetString("draft_selection") != "one" || after.GetString("draft_recipient") != "Reviewer" {
		t.Fatal(after.PublicExport())
	}
	closed := apiWebhookRecord(t, a, "tasks", closedID)
	if closed.GetString("draft_options") != "[]" || closed.GetString("draft_selection") != "any" || closed.GetString("draft_recipient") != "" {
		t.Fatal("withdrawn review resurrected", closed.PublicExport())
	}
	if !reflect.DeepEqual(oldReview.PublicExport(), apiWebhookRecord(t, a, "reviews", reviewID).PublicExport()) {
		t.Fatal("migration changed submitted review")
	}
}
