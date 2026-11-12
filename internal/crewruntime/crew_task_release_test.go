package crewruntime

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

// In-session approval (release labels since 0.23.0) and Won't do (0.19.0). All records are
// synthetic.

func deliveryCauses(t *testing.T, a *testApp, task string) []map[string]bool {
	t.Helper()
	out := []map[string]bool{}
	for _, d := range apiWebhookDeliveries(t, a, task) {
		var payload map[string]any
		if err := json.Unmarshal([]byte(d.GetString("payload")), &payload); err != nil {
			t.Fatal(err)
		}
		causes := map[string]bool{}
		for _, v := range payload["causes"].([]any) {
			causes[v.(string)] = true
		}
		out = append(out, causes)
	}
	return out
}

func readTasks(t *testing.T, a *testApp, filter map[string]any) []string {
	t.Helper()
	filter["collection"] = "tasks"
	filter["fields"] = []string{"title"}
	raw, _ := json.Marshal(filter)
	titles := []string{}
	for _, x := range a.request(t, "POST", "/api/crew/read", a.token, string(raw), 200)["items"].([]any) {
		titles = append(titles, x.(map[string]any)["title"].(string))
	}
	return titles
}

func TestWontDoIsTerminal(t *testing.T) {
	a, config, _, _ := webhookFixture(t)
	bot := config.GetString("agent")
	task := newTask(t, a, map[string]any{"title": "Synthetic dropped work", "assigned_agent": bot, "readiness": "ready"})
	id := task["id"].(string)
	if n := len(apiWebhookDeliveries(t, a, id)); n != 1 {
		t.Fatal("ready bot task not woken once", n)
	}
	generation := apiWebhookRecord(t, a, "tasks", id).GetInt("wake_generation")
	dropped := crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "wont_do"}, 200)
	if dropped["status"] != "wont_do" {
		t.Fatal("wont_do not stored", dropped)
	}
	if apiWebhookRecord(t, a, "tasks", id).GetInt("wake_generation") <= generation {
		t.Fatal("Won't do did not advance the wake generation")
	}
	for _, d := range apiWebhookDeliveries(t, a, id) {
		if s := d.GetString("state"); s == "pending" || s == "in_flight" {
			t.Fatal("queued wake survived Won't do", d.PublicExport())
		}
	}
	// Owner comments and Ready changes never wake a Won't do task.
	crewWrite(t, a, false, "task.comment", id, taskRevision(t, a, id), map[string]any{"body": "Synthetic owner note"}, 200)
	crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"readiness": "waiting"}, 200)
	crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"readiness": "ready"}, 200)
	if n := len(apiWebhookDeliveries(t, a, id)); n != 1 {
		t.Fatal("Won't do task was woken", n)
	}
	// Moving between Done and Won't do is not a reopening; leaving them is.
	crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "done"}, 200)
	crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "wont_do"}, 200)
	if n := len(apiWebhookDeliveries(t, a, id)); n != 1 {
		t.Fatal("terminal-to-terminal change woke the task", n)
	}
	crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "todo"}, 200)
	causes := deliveryCauses(t, a, id)
	if len(causes) != 2 || !causes[1]["reopened"] {
		t.Fatal("leaving Won't do is not a reopening wake", causes)
	}
	// A pending review blocks Won't do like Done.
	review := newTask(t, a, map[string]any{"title": "Synthetic reviewed work", "draft": "Synthetic draft"})
	rid := review["id"].(string)
	crewWrite(t, a, false, "review.request", rid, taskRevision(t, a, rid), map[string]any{}, 200)
	crewWrite(t, a, false, "task.update", rid, taskRevision(t, a, rid), map[string]any{"status": "wont_do"}, 400)
	// The status filter selects Won't do; an unknown status is refused.
	if got := readTasks(t, a, map[string]any{"status": []string{"wont_do"}}); len(got) != 0 {
		t.Fatal("reopened task still listed as Won't do", got)
	}
	crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "wont_do"}, 200)
	if got := readTasks(t, a, map[string]any{"status": []string{"done", "wont_do"}}); len(got) != 1 || got[0] != "Synthetic dropped work" {
		t.Fatal("status filter wont_do", got)
	}
	raw, _ := json.Marshal(map[string]any{"collection": "tasks", "status": "cancelled"})
	a.request(t, "POST", "/api/crew/read", a.token, string(raw), 400)
	crewWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "cancelled"}, 400)
}

func TestWontDoEndsClaim(t *testing.T) {
	a := newTestApp(t)
	agent := crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "synthetic-release-project", "kind": "external"}, 200)
	task := newTask(t, a, map[string]any{"title": "Synthetic claimed ticket", "assigned_agent": agent["id"], "readiness": "ready"})
	id := task["id"].(string)
	sessionWrite(t, a, false, "task.claim", id, int(task["revision"].(float64)), map[string]any{"assigned_agent": agent["id"]}, "session-a", 200)
	dropped := sessionWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "wont_do"}, "session-a", 200)
	if dropped["status"] != "wont_do" || dropped["claimed_by"] != "" || dropped["claim_until"] != "" || dropped["claim_state"] != "" {
		t.Fatal("Won't do did not end the claim", dropped)
	}
	events := eventsOf(t, a, id, "task.update")
	if len(events) != 1 || !strings.Contains(events[0].GetString("changes"), `"claim_cleared":true`) {
		t.Fatal("claim end not audited", events)
	}
}

func TestInSessionApproval(t *testing.T) {
	a := newTestApp(t)
	agent := crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "synthetic-approval-project", "kind": "external"}, 200)
	task := newTask(t, a, map[string]any{"title": "Synthetic shipped ticket", "assigned_agent": agent["id"], "readiness": "ready"})
	id := task["id"].(string)
	if _, ok := task["release"]; ok || task["review_mode"] != "" || task["approved_by"] != "" || task["approved_at"] != "" {
		t.Fatal("new task carries release or approval", task)
	}
	sessionWrite(t, a, false, "task.claim", id, taskRevision(t, a, id), map[string]any{"assigned_agent": agent["id"]}, "session-a", 200)
	// in_session is refused unless the task is or becomes Done, and
	// approved_at is never written by clients.
	sessionWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"review_mode": "in_session"}, "session-a", 400)
	sessionWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "wont_do", "review_mode": "in_session"}, "session-a", 400)
	sessionWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "done", "review_mode": "in_session", "approved_at": "2026-01-01 00:00:00.000Z"}, "session-a", 400)
	sessionWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "done", "review_mode": "session"}, "session-a", 400)
	sessionWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"approved_by": "Synthetic Owner"}, "session-a", 400)
	sessionWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"release": "0.19.0"}, "session-a", 400)
	sessionWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"approved_by": strings.Repeat("a", 101), "status": "done", "review_mode": "in_session"}, "session-a", 400)
	// The close step: Done with a release label and in-session approval in
	// one update. approved_by defaults to owner.
	before := time.Now().Add(-time.Second)
	closed := sessionWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "done", "labels": []string{"release-0.19.0"}, "review_mode": "in_session"}, "session-a", 200)
	if closed["status"] != "done" || closed["review_mode"] != "in_session" || closed["approved_by"] != "owner" || closed["claim_state"] != "" {
		t.Fatal("in-session close", closed)
	}
	stamped := apiWebhookRecord(t, a, "tasks", id).GetDateTime("approved_at").Time()
	if stamped.Before(before) || stamped.After(time.Now().Add(time.Second)) {
		t.Fatal("approved_at not stamped with server time", stamped)
	}
	events := eventsOf(t, a, id, "task.update")
	last := events[len(events)-1].GetString("changes")
	for _, part := range []string{`"review_mode":"in_session"`, `"approved_by":"owner"`, `"approved_at":"`} {
		if !strings.Contains(last, part) {
			t.Fatalf("event changes lack %s: %s", part, last)
		}
	}
	// A later update while still Done keeps the stamp and may name the owner.
	time.Sleep(10 * time.Millisecond)
	named := sessionWrite(t, a, true, "task.update", id, taskRevision(t, a, id), map[string]any{"approved_by": " Synthetic Owner "}, "", 200)
	if named["approved_by"] != "Synthetic Owner" || !apiWebhookRecord(t, a, "tasks", id).GetDateTime("approved_at").Time().Equal(stamped) {
		t.Fatal("approved_by change restamped or not trimmed", named)
	}
	// The release label finds the task.
	newTask(t, a, map[string]any{"title": "Synthetic unreleased ticket"})
	if got := readTasks(t, a, map[string]any{"label": "release-0.19.0"}); len(got) != 1 || got[0] != "Synthetic shipped ticket" {
		t.Fatal("release label filter", got)
	}
	// SQL sees the new columns.
	raw, _ := json.Marshal(map[string]any{"sql": "SELECT labels, review_mode, approved_by FROM tasks WHERE id = '" + id + "'"})
	rows := a.request(t, "POST", "/api/crew/query", a.token, string(raw), 200)["rows"].([]any)
	if len(rows) != 1 || !strings.Contains(fmt.Sprint(rows[0].([]any)[0]), "release-0.19.0") || rows[0].([]any)[1] != "in_session" || rows[0].([]any)[2] != "Synthetic Owner" {
		t.Fatal("SQL view", rows)
	}
	// Leaving Done clears the approval but keeps the release label.
	reopened := sessionWrite(t, a, true, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "todo"}, "", 200)
	if reopened["review_mode"] != "" || reopened["approved_by"] != "" || reopened["approved_at"] != "" || !strings.Contains(fmt.Sprint(reopened["labels"]), "release-0.19.0") {
		t.Fatal("leaving Done kept the approval", reopened)
	}
	events = eventsOf(t, a, id, "task.update")
	if last := events[len(events)-1].GetString("changes"); !strings.Contains(last, `"approval_cleared":true`) {
		t.Fatal("approval clearing not audited", last)
	}
	// Created Done with an approver; switching to crew clears the approval.
	direct := newTask(t, a, map[string]any{"title": "Synthetic direct close", "status": "done", "review_mode": "in_session", "approved_by": "Synthetic Owner", "labels": []string{"release-0.19.0"}})
	if direct["approved_by"] != "Synthetic Owner" || direct["approved_at"] == "" {
		t.Fatal("create with in-session approval", direct)
	}
	did := direct["id"].(string)
	crewMode := crewWrite(t, a, false, "task.update", did, taskRevision(t, a, did), map[string]any{"review_mode": "crew"}, 200)
	if crewMode["review_mode"] != "crew" || crewMode["approved_by"] != "" || crewMode["approved_at"] != "" {
		t.Fatal("crew mode kept the in-session approval", crewMode)
	}
	// A review request on a Done task leaves Done and clears the approval.
	crewWrite(t, a, false, "task.update", did, taskRevision(t, a, did), map[string]any{"review_mode": "in_session", "draft": "Synthetic draft"}, 200)
	crewWrite(t, a, false, "review.request", did, taskRevision(t, a, did), map[string]any{}, 200)
	if got := readTask(t, a, did); got["status"] != "needs_review" || got["review_mode"] != "" || got["approved_at"] != "" {
		t.Fatal("review request kept the approval", got)
	}
}
