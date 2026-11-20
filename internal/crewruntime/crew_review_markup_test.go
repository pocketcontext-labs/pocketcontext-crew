package crewruntime

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type markupFixture struct {
	Name   string `json:"name"`
	Body   string `json:"body"`
	Valid  bool   `json:"valid"`
	Errors []struct {
		Code string `json:"code"`
		Line int    `json:"line"`
	} `json:"errors"`
	Blocks []map[string]any `json:"blocks"`
}

func markupFixtures(t *testing.T) []markupFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "review_markup.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Cases []markupFixture `json:"cases"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Cases) == 0 {
		t.Fatal("no markup fixtures")
	}
	return doc.Cases
}

// warningsOf returns {code,line} pairs of the result's warnings for one option
// key and field, failing on malformed entries.
func warningsOf(t *testing.T, result map[string]any, option, field string) [][2]any {
	t.Helper()
	list, _ := result["warnings"].([]any)
	out := [][2]any{}
	for _, raw := range list {
		w := raw.(map[string]any)
		for _, k := range []string{"code", "option", "field", "line", "opener", "message"} {
			if _, ok := w[k]; !ok {
				t.Fatal("warning lacks", k, w)
			}
		}
		if w["option"] == option && w["field"] == field {
			out = append(out, [2]any{w["code"], int(w["line"].(float64))})
		}
	}
	return out
}

func expectedWarnings(c markupFixture) [][2]any {
	out := [][2]any{}
	for _, e := range c.Errors {
		out = append(out, [2]any{e.Code, e.Line})
	}
	return out
}

// Every shared fixture goes through the hook path: the draft and an option of
// review.request, and the task.create that set the draft, warn with the
// fixture's codes and lines and never block.
func TestReviewMarkupFixturesWarnOnReviewRequest(t *testing.T) {
	a := newTestApp(t)
	for _, c := range markupFixtures(t) {
		task := newTask(t, a, map[string]any{"title": "Synthetic markup task", "draft": c.Body})
		want := expectedWarnings(c)
		if got := warningsOf(t, task, "", "draft"); !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: task.create warnings %v, want %v", c.Name, got, want)
		}
		id := task["id"].(string)
		review := crewWrite(t, a, true, "review.request", id, taskRevision(t, a, id), map[string]any{"options": []map[string]any{{"key": "a", "label": "A", "body": c.Body}}}, 200)
		if review["status"] != "pending" {
			t.Fatal(c.Name, review)
		}
		if got := warningsOf(t, review, "", "draft"); !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: draft warnings %v, want %v", c.Name, got, want)
		}
		if got := warningsOf(t, review, "a", "body"); !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: option warnings %v, want %v", c.Name, got, want)
		}
		if _, present := review["warnings"]; c.Valid && present {
			t.Fatal(c.Name, "valid markup warned", review["warnings"])
		}
		// Targets from the server parse: feedback on each fixture block is
		// accepted exactly when the block is addressable.
		targets := []string{}
		for _, b := range c.Blocks {
			if target, _ := b["target"].(string); target != "" {
				targets = append(targets, target)
			}
		}
		feedback := []map[string]any{}
		for _, target := range targets {
			feedback = append(feedback, map[string]any{"target": target, "note": "Synthetic feedback on " + target})
		}
		rid := review["id"].(string)
		crewWrite(t, a, false, "review.decide", rid, 1, map[string]any{"decision": "changes_requested", "option_decisions": []map[string]any{{"key": "a", "decision": "rejected", "feedback": []map[string]any{{"target": "copy-9", "note": "Synthetic"}}}}}, 400)
		decided := crewWrite(t, a, false, "review.decide", rid, 1, map[string]any{"decision": "changes_requested", "option_decisions": []map[string]any{{"key": "a", "decision": "rejected", "feedback": feedback}}}, 200)
		entry := decided["option_decisions"].([]any)[0].(map[string]any)
		stored, _ := entry["feedback"].([]any)
		if len(stored) != len(targets) {
			t.Fatal(c.Name, "feedback not stored", entry)
		}
	}
}

func TestTaskDescriptionDraftWarnings(t *testing.T) {
	a := newTestApp(t)
	block := ":::variant{channel=x}\n\nSynthetic post\n\n:::"
	description := "The request\n\n" + block
	task := crewWrite(t, a, true, "task.create", "", 0, map[string]any{"title": "Synthetic request", "description": description, "draft": block}, 200)
	if got := warningsOf(t, task, "", "description"); !reflect.DeepEqual(got, [][2]any{{"task_description_contains_draft", 3}}) || task["description"] != description {
		t.Fatal("create must warn and preserve the description", task)
	}
	id := task["id"].(string)
	// A documented example inside fenced code is literal. The following real block warns.
	raw := "```md\n" + block + "\n```\n\n:::copy{label=\"Example\"}\n\nA second draft\n\n:::"
	task = crewWrite(t, a, true, "task.update", id, taskRevision(t, a, id), map[string]any{"description": raw}, 200)
	if got := warningsOf(t, task, "", "description"); !reflect.DeepEqual(got, [][2]any{{"task_description_contains_draft", 9}}) {
		t.Fatal("update must warn only for the actual copy block", task)
	}
	task = crewWrite(t, a, true, "task.update", id, taskRevision(t, a, id), map[string]any{"draft": block}, 200)
	if _, warned := task["warnings"]; warned || readTask(t, a, id)["description"] != raw {
		t.Fatal("a draft-only edit must preserve the brief without warning", task)
	}
}

func TestMarkupWarningsOnNoteTaskAndCommentWrites(t *testing.T) {
	a := newTestApp(t)
	bad := ":::variant{channel=myspace}\n\nText\n\n:::"
	good := ":::variant{channel=linkedin}\n\nText\n\n:::"
	bucket := crewOp(t, a, "bucket.create", nil, map[string]any{"name": "Synthetic markup bucket"})
	note := crewWrite(t, a, true, "note.create", "", 0, map[string]any{"bucket": bucket["id"], "title": "Synthetic markup note", "body": "Intro\n\n" + bad}, 200)
	if got := warningsOf(t, note, "", "body"); !reflect.DeepEqual(got, [][2]any{{"review_markup_invalid_attribute", 3}}) {
		t.Fatal("note.create", note["warnings"])
	}
	note = crewWrite(t, a, true, "note.update", note["id"].(string), 1, map[string]any{"body": good}, 200)
	if _, present := note["warnings"]; present {
		t.Fatal("clean note warned", note)
	}
	note = crewWrite(t, a, false, "note.update", note["id"].(string), 2, map[string]any{"body": ":::poll\n\nx\n\n:::"}, 200)
	if got := warningsOf(t, note, "", "body"); !reflect.DeepEqual(got, [][2]any{{"review_markup_unknown_directive", 1}}) {
		t.Fatal("note.update", note["warnings"])
	}
	task := crewWrite(t, a, true, "task.create", "", 0, map[string]any{"title": "Synthetic markup task", "description": bad, "draft": good}, 200)
	if got := warningsOf(t, task, "", "description"); len(got) != 1 || len(warningsOf(t, task, "", "draft")) != 0 {
		t.Fatal("task.create", task["warnings"])
	}
	id := task["id"].(string)
	task = crewWrite(t, a, true, "task.update", id, taskRevision(t, a, id), map[string]any{"draft": ":::variant{channel=x}\n\nUnclosed"}, 200)
	if got := warningsOf(t, task, "", "draft"); !reflect.DeepEqual(got, [][2]any{{"review_markup_unclosed", 1}}) || len(warningsOf(t, task, "", "description")) != 0 {
		t.Fatal("task.update", task["warnings"])
	}
	task = crewWrite(t, a, true, "task.update", id, taskRevision(t, a, id), map[string]any{"title": "Synthetic markup task renamed"}, 200)
	if _, present := task["warnings"]; present {
		t.Fatal("update without text fields warned", task)
	}
	for _, agent := range []bool{true, false} {
		comment := crewWrite(t, a, agent, "task.comment", id, taskRevision(t, a, id), map[string]any{"body": ":::variant{channel=x}\n\nOne\n\n:::\n\n:::variant{channel=x}\n\nTwo\n\n:::"}, 200)
		if got := warningsOf(t, comment, "", "body"); !reflect.DeepEqual(got, [][2]any{{"review_markup_duplicate_channel", 7}}) {
			t.Fatal("task.comment", agent, comment["warnings"])
		}
		clean := crewWrite(t, a, agent, "task.comment", id, taskRevision(t, a, id), map[string]any{"body": "re:Crew at 10:30 and ::"}, 200)
		if _, present := clean["warnings"]; present {
			t.Fatal("clean comment warned", clean)
		}
	}
	// Warnings are never stored: reads carry none.
	if _, present := readTask(t, a, id)["warnings"]; present {
		t.Fatal("warnings stored on the task")
	}
}

const feedbackBody = ":::variant{channel=linkedin}\n\nSynthetic LinkedIn text.\n\n:::\n\n:::variant{channel=x}\n\nSynthetic X text.\n\n:::\n\n:::copy{label=\"Synthetic reply\"}\n\nHi!\n\n:::\n\n:::note\n\nWhy.\n\n:::"

func feedbackReview(t *testing.T, a *testApp, agent bool) (string, string) {
	t.Helper()
	task := newTask(t, a, map[string]any{"draft": "Synthetic draft with options"})
	id := task["id"].(string)
	options := []map[string]any{{"key": "a", "label": "A", "body": feedbackBody}, {"key": "b", "label": "B", "body": "Synthetic plain option"}}
	review := crewWrite(t, a, agent, "review.request", id, taskRevision(t, a, id), map[string]any{"options": options}, 200)
	if _, present := review["warnings"]; present {
		t.Fatal("valid markup warned", review["warnings"])
	}
	return id, review["id"].(string)
}

func TestReviewOptionFeedbackValidation(t *testing.T) {
	a := newTestApp(t)
	_, rid := feedbackReview(t, a, true)
	long := strings.Repeat("x", 20001)
	refused := []any{
		[]map[string]any{{"target": "email", "note": "Synthetic"}},
		[]map[string]any{{"target": "linkedin", "note": "One"}, {"target": "linkedin", "note": "Two"}},
		[]map[string]any{{"target": "", "note": "Note blocks are not addressable"}},
		[]map[string]any{{"target": "copy-2", "note": "Synthetic"}},
		[]map[string]any{{"target": "a.linkedin", "note": "Synthetic"}},
		[]map[string]any{{"target": "linkedin", "note": "  "}},
		[]map[string]any{{"target": "linkedin", "note": long}},
		[]map[string]any{{"target": "linkedin", "note": "Synthetic", "extra": true}},
		[]map[string]any{{"target": "linkedin"}},
		"linkedin",
	}
	for _, fb := range refused {
		out := crewWrite(t, a, false, "review.decide", rid, 1, map[string]any{"decision": "approved", "option_decisions": []map[string]any{{"key": "a", "decision": "approved", "feedback": fb}, {"key": "b", "decision": "rejected"}}}, 400)
		if out["message"] == nil {
			t.Fatal(fb, out)
		}
	}
	// The plain option has no addressable blocks.
	crewWrite(t, a, false, "review.decide", rid, 1, map[string]any{"decision": "approved", "option_decisions": []map[string]any{{"key": "a", "decision": "approved"}, {"key": "b", "decision": "rejected", "feedback": []map[string]any{{"target": "linkedin", "note": "Synthetic"}}}}}, 400)
	if r := apiWebhookRecord(t, a, "reviews", rid); r.GetString("status") != "pending" || r.GetInt("revision") != 1 || r.GetString("option_decisions") != "[]" {
		t.Fatal("refused feedback recorded something", r.PublicExport())
	}
	// Delegated decision through the work-client route.
	decided := crewWrite(t, a, true, "review.decide", rid, 1, map[string]any{"decision": "approved", "option_decisions": []map[string]any{
		{"key": "a", "decision": "approved", "note": "Synthetic whole-option note", "feedback": []map[string]any{{"target": "linkedin", "note": "Drop the last paragraph"}, {"target": "x", "note": "Shorter"}, {"target": "copy-1", "note": "Less formal"}}},
		{"key": "b", "decision": "rejected", "feedback": []map[string]any{}},
	}}, 200)
	entries := decided["option_decisions"].([]any)
	a0 := entries[0].(map[string]any)
	if a0["note"] != "Synthetic whole-option note" || len(a0["feedback"].([]any)) != 3 || a0["feedback_text"] != "[linkedin] Drop the last paragraph\n[x] Shorter\n[copy-1] Less formal" {
		t.Fatal("decision result", a0)
	}
	if b0 := entries[1].(map[string]any); b0["feedback"] != nil || b0["feedback_text"] != nil || b0["note"] != "" {
		t.Fatal("empty feedback stored", b0)
	}
	rows := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "reviews", "id": rid, "fields": []string{"option_decisions"}}, 200))
	read := rows[0]["option_decisions"].([]any)[0].(map[string]any)
	want := []any{map[string]any{"target": "linkedin", "note": "Drop the last paragraph"}, map[string]any{"target": "x", "note": "Shorter"}, map[string]any{"target": "copy-1", "note": "Less formal"}}
	if !reflect.DeepEqual(read["feedback"], want) || read["feedback_text"] != a0["feedback_text"] {
		t.Fatal("crew_read reviews", read)
	}
	// The SQL view exposes the stored JSON, without the derived text.
	query := crewPost(t, a, "/api/crew/query", map[string]any{"sql": "SELECT option_decisions FROM reviews WHERE id='" + rid + "'"}, 200)
	raw, _ := json.Marshal(query)
	if !strings.Contains(string(raw), "Drop the last paragraph") || strings.Contains(string(raw), "feedback_text") {
		t.Fatal(string(raw))
	}
	// Reader decisions accept feedback too; older decisions keep their shape.
	_, reader := feedbackReview(t, a, false)
	crewWrite(t, a, false, "review.decide", reader, 1, map[string]any{"decision": "changes_requested", "option_decisions": []map[string]any{{"key": "a", "decision": "rejected", "feedback": []map[string]any{{"target": "x", "note": "Synthetic"}}}}}, 200)
	_, legacy := feedbackReview(t, a, false)
	plain := crewWrite(t, a, false, "review.decide", legacy, 1, map[string]any{"decision": "rejected"}, 200)
	for _, e := range plain["option_decisions"].([]any) {
		if len(e.(map[string]any)) != 3 {
			t.Fatal("legacy decision shape changed", e)
		}
	}
}

// A review outcome wake stays reference-only: it names the review, and the
// assignee reads the feedback through Crew.
func TestReviewOutcomeWakeNamesReviewWithoutFeedbackText(t *testing.T) {
	a, _, task, _ := commentFixture(t)
	webhookOperation(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"draft": "Synthetic draft"}, "")
	current := apiWebhookRecord(t, a, "tasks", task.Id)
	review := webhookOperation(t, a, "review.request", task.Id, current.GetInt("revision"), map[string]any{"options": []map[string]any{{"key": "a", "label": "A", "body": feedbackBody}}}, "")
	ownerReview(t, a, "review.decide", review, map[string]any{"decision": "changes_requested", "option_decisions": []map[string]any{{"key": "a", "decision": "rejected", "feedback": []map[string]any{{"target": "linkedin", "note": "Synthetic secret-free feedback"}}}}})
	wakes := reviewOutcomeWakes(t, a, task.Id)
	if len(wakes) != 1 {
		t.Fatal("no review outcome wake", len(wakes))
	}
	raw := wakes[0].GetString("payload")
	var payload map[string]any
	_ = json.Unmarshal([]byte(raw), &payload)
	if payload["review_outcome"] != "changes_requested" || payload["review_id"] != review["id"] {
		t.Fatal("wake lacks the review reference", payload)
	}
	if strings.Contains(raw, "Synthetic secret-free feedback") || strings.Contains(raw, "linkedin") {
		t.Fatal("wake carries review prose", raw)
	}
	rows := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "reviews", "id": payload["review_id"], "fields": []string{"option_decisions"}}, 200))
	entry := rows[0]["option_decisions"].([]any)[0].(map[string]any)
	if entry["feedback_text"] != "[linkedin] Synthetic secret-free feedback" {
		t.Fatal(entry)
	}
}
