package crewruntime

import (
	"encoding/json"
	"testing"
)

func TestDelegationRecipientReplies(t *testing.T) {
	a := newTestApp(t)
	makeAgent := func(name string) string {
		return crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": name, "kind": "external"}, 200)["id"].(string)
	}
	coordinator, recipient := makeAgent("Synthetic coordinator"), makeAgent("Synthetic recipient")
	parent := newTask(t, a, map[string]any{"title": "Group question", "readiness": "ready", "assigned_agent": coordinator})["id"].(string)
	claim := func(id, agent, reporter string) {
		sessionWrite(t, a, false, "task.claim", id, taskRevision(t, a, id), map[string]any{"assigned_agent": agent}, reporter, 200)
	}
	write := func(action, id, reporter, key string, rev int, data map[string]any, want int) map[string]any {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"action": action, "id": id, "reported_agent": reporter, "expected_revision": rev, "idempotency_key": key, "data": data})
		return a.request(t, "POST", "/api/crew/agent-write", a.token, string(body), want)
	}
	claim(parent, coordinator, "coordinator chat")
	revision := taskRevision(t, a, parent)
	question := map[string]any{"title": "Welche Sprache?", "assigned_agent": recipient, "labels": []string{"language"}}
	child := write("task.delegate", parent, "coordinator chat", "question", revision, question, 200)
	id := child["id"].(string)
	if child["delegation_parent"] != parent || child["assigned_agent"] != recipient || child["readiness"] != "ready" {
		t.Fatalf("delegated task = %#v", child)
	}
	if retry := write("task.delegate", parent, "coordinator chat", "question", revision, question, 200); retry["id"] != id {
		t.Fatal("duplicate child", retry)
	}
	second := write("task.delegate", parent, "coordinator chat", "other", revision, map[string]any{"assigned_agent": coordinator, "title": "Altra domanda"}, 200)
	claim(id, recipient, "recipient chat")
	rev := taskRevision(t, a, id)
	answer := map[string]any{"body": "Sì, parlerò francese."}
	write("task.reply", id, "another chat", "wrong", rev, answer, 409)
	reply := write("task.reply", id, "recipient chat", "answer", rev, answer, 200)
	if reply["reported_agent"] != "recipient chat" || reply["agent"] != recipient || reply["body"] != answer["body"] {
		t.Fatal("wrong reply", reply)
	}
	if replay := write("task.reply", id, "recipient chat", "answer", rev, answer, 200); replay["event_id"] != reply["event_id"] {
		t.Fatal("duplicate reply", replay)
	}
	write("task.reply", id, "recipient chat", "different", rev, answer, 409)
	query, _ := json.Marshal(map[string]any{"collection": "tasks", "parent": parent, "fields": []string{"delegation_reply"}})
	items := a.request(t, "POST", "/api/crew/read", a.token, string(query), 200)["items"].([]any)
	if len(items) != 2 {
		t.Fatal("wrong recipients", items)
	}
	for _, raw := range items {
		item := raw.(map[string]any)
		switch item["id"] {
		case id:
			if item["delegation_reply"].(map[string]any)["event_id"] != reply["event_id"] {
				t.Fatal(item)
			}
		case second["id"]:
			if item["delegation_reply"] != nil {
				t.Fatal("invented reply", item)
			}
		default:
			t.Fatal("unrelated task", item)
		}
	}
}
