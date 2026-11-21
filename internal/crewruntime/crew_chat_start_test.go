package crewruntime

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatTaskContextReadsLatestSavedComment(t *testing.T) {
	a, config, task, event := webhookFixture(t)
	name := selfStartName
	session := func() map[string]any {
		return readJSON(t, a, map[string]any{"collection": "session", "agent": name}, 200)
	}
	before := session()
	rev := task.GetInt("revision")
	comment := "Keep the approved approach. Next, verify the synthetic build."
	sessionWrite(t, a, false, "task.comment", task.Id, rev, map[string]any{"body": comment}, "synthetic-chat", 200)
	if after := session(); after["prompt"] != before["prompt"] || strings.Contains(after["prompt"].(string), comment) {
		t.Fatal("task context leaked into the stable startup prompt")
	}
	read := func() map[string]any {
		result := readJSON(t, a, map[string]any{"collection": "tasks", "id": task.Id, "assigned_agent": config.GetString("agent"), "fields": []string{"status", "last_saved_step", "webhook_holder"}}, 200)
		return result["items"].([]any)[0].(map[string]any)
	}
	got := read()
	if got["last_saved_step"] != comment || got["webhook_holder"] != "" || got["status"] != "todo" || taskRevision(t, a, task.Id) != rev {
		t.Fatal("reading a handoff must return current context without starting a task", got)
	}
	beginSelf(t, a, event, "synthetic-run")
	if got := read(); got["webhook_holder"] != name {
		t.Fatal("webhook holder missing", got)
	}
	for _, owner := range []bool{true, false} {
		lost := sessionWrite(t, a, owner, "task.claim", task.Id, rev, map[string]any{"assigned_agent": name}, "synthetic-chat", 409)
		if msg := assertRefusal(t, lost, "execution_required"); !strings.Contains(msg, name) {
			t.Fatal("refusal does not identify the webhook agent", msg)
		}
	}
}

func TestChatAndWebhookCompeteForSameTask(t *testing.T) {
	for _, route := range []string{"/api/crew/write", "/api/crew/agent-write"} {
		t.Run(route, func(t *testing.T) {
			a, config, task, event := webhookFixture(t)
			chat := map[string]any{"action": "task.claim", "id": task.Id, "expected_revision": task.GetInt("revision"), "reported_agent": "synthetic-chat", "data": map[string]any{"assigned_agent": config.GetString("agent")}}
			webhook := map[string]any{"action": "execution.begin", "idempotency_key": "webhook-start", "data": map[string]any{"event_id": event.GetString("event_id"), "generation": event.GetInt("generation"), "epoch": event.GetString("epoch"), "role": "dispatcher", "worker_id": "synthetic-worker"}}
			start := make(chan struct{})
			post := func(path string, data map[string]any) <-chan *httptest.ResponseRecorder {
				done := make(chan *httptest.ResponseRecorder, 1)
				raw, err := json.Marshal(data)
				if err != nil {
					t.Fatal(err)
				}
				req := httptest.NewRequest("POST", path, bytes.NewReader(raw))
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Authorization", a.token)
				go func() {
					<-start
					rec := httptest.NewRecorder()
					a.handler.ServeHTTP(rec, req)
					done <- rec
				}()
				return done
			}
			c, w := post(route, chat), post("/api/crew/agent-write", webhook)
			close(start)
			cr, wr := <-c, <-w
			switch {
			case cr.Code == 200 && wr.Code == 409:
				if !strings.Contains(wr.Body.String(), "synthetic-chat") {
					t.Fatal(wr.Body)
				}
			case cr.Code == 409 && wr.Code == 200:
				if !strings.Contains(cr.Body.String(), selfStartName) {
					t.Fatal(cr.Body)
				}
			default:
				t.Fatalf("chat %d: %s; webhook %d: %s", cr.Code, cr.Body, wr.Code, wr.Body)
			}
		})
	}
}

func TestChatClaimFencesBothWebhookStartsUntilRelease(t *testing.T) {
	a, config, task, event := webhookFixture(t)
	won := sessionWrite(t, a, false, "task.claim", task.Id, task.GetInt("revision"), map[string]any{"assigned_agent": config.GetString("agent")}, "synthetic-chat", 200)
	data := map[string]any{"event_id": event.GetString("event_id"), "generation": event.GetInt("generation"), "epoch": event.GetString("epoch"), "role": "dispatcher", "worker_id": "synthetic-worker"}
	executionOperation(t, a, "execution.begin", "", 0, data, "try-begin", false, 409)
	delete(data, "role")
	data["phase"] = "work"
	lost := executionOperation(t, a, "execution.acquire", "", 0, data, "try-acquire", false, 409)
	if !strings.Contains(assertRefusal(t, lost, "already_claimed"), "synthetic-chat") {
		t.Fatal("webhook cannot identify the chat holder", lost)
	}
	sessionWrite(t, a, false, "task.release", task.Id, int(won["revision"].(float64)), map[string]any{}, "synthetic-chat", 200)
	run := executionOperation(t, a, "execution.acquire", "", 0, data, "after-release", false, 200)
	executionOperation(t, a, "execution.complete", run["id"].(string), int(run["revision"].(float64)), map[string]any{"worker_id": data["worker_id"], "fence": run["fence"], "outcome": "completed"}, "save-result", false, 200)
	sessionWrite(t, a, false, "task.claim", task.Id, taskRevision(t, a, task.Id), map[string]any{"assigned_agent": config.GetString("agent")}, "next-chat", 200)
	executionOperation(t, a, "execution.acquire", "", 0, data, "after-release", false, 409)
}

func TestChatHolderTracksWebhookHandoff(t *testing.T) {
	a, _, _, _ := webhookFixture(t)
	recipient := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Synthetic recipient"}, "")
	webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": recipient["id"], "bot_ref": "synthetic-recipient"}, "")
	task := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Synthetic handed off", "assigned_agent": recipient["id"], "readiness": "ready"}, "")
	id := task["id"].(string)
	event := selfStartDeliveries(t, a, id)[0]
	data := map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "phase": "dispatch", "worker_id": "synthetic-first", "native_handoff": true}
	dispatch := executionOperation(t, a, "execution.acquire", "", 0, data, "dispatch", false, 200)
	wantHolder := func(name string) {
		t.Helper()
		result := readJSON(t, a, map[string]any{"collection": "tasks", "id": id, "fields": []string{"webhook_holder"}}, 200)
		if holder := result["items"].([]any)[0].(map[string]any)["webhook_holder"]; holder != name {
			t.Fatalf("holder %v, want %s", holder, name)
		}
	}
	wantHolder(selfStartName)
	executionOperation(t, a, "execution.handoff", dispatch["id"].(string), int(dispatch["revision"].(float64)), map[string]any{"worker_id": data["worker_id"], "fence": dispatch["fence"]}, "handoff", false, 200)
	wantHolder("Synthetic recipient")
	data["phase"], data["worker_id"] = "work", "synthetic-second"
	executionOperation(t, a, "execution.acquire", "", 0, data, "recipient", false, 200)
	wantHolder("Synthetic recipient")
}
