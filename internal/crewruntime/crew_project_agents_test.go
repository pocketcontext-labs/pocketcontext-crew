package crewruntime

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Project coder agents (0.18.0): agent kinds, advisory task claims and the
// session instructions read. All records are synthetic.

func sessionWrite(t *testing.T, a *testApp, owner bool, action, id string, revision int, data map[string]any, reported string, want int) map[string]any {
	t.Helper()
	b := map[string]any{"action": action, "data": data, "reported_agent": reported}
	if id != "" {
		b["id"] = id
		b["expected_revision"] = revision
	}
	raw, _ := json.Marshal(b)
	route := "/api/crew/agent-write"
	if owner {
		route = "/api/crew/write"
	}
	return a.request(t, "POST", route, a.token, string(raw), want)
}

func taskRevision(t *testing.T, a *testApp, id string) int {
	t.Helper()
	return apiWebhookRecord(t, a, "tasks", id).GetInt("revision")
}

func readTask(t *testing.T, a *testApp, id string) map[string]any {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"collection": "tasks", "id": id})
	items := a.request(t, "POST", "/api/crew/read", a.token, string(raw), 200)["items"].([]any)
	if len(items) != 1 {
		t.Fatal("task not readable", items)
	}
	return items[0].(map[string]any)
}

func setClaimUntil(t *testing.T, a *testApp, id string, until time.Time) {
	t.Helper()
	r := apiWebhookRecord(t, a, "tasks", id)
	r.Set("claim_until", until.UTC().Format("2006-01-02T15:04:05.000Z"))
	if err := a.app.Save(r); err != nil {
		t.Fatal(err)
	}
}

func claimUntil(t *testing.T, a *testApp, id string) time.Time {
	t.Helper()
	value := apiWebhookRecord(t, a, "tasks", id).GetString("claim_until")
	ts, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatal("claim_until is not ISO UTC", value, err)
	}
	return ts
}

func assertClaimRefusal(t *testing.T, body map[string]any, code, claimedBy string) {
	t.Helper()
	assertRefusal(t, body, code)
	if body["status"] != float64(409) || dig(body, "data", "claimed_by") != claimedBy {
		t.Fatal("refusal does not name the claimer", body)
	}
	if until, _ := dig(body, "data", "claim_until").(string); claimedBy != "" && until == "" {
		t.Fatal("refusal does not carry claim_until", body)
	}
}

func TestAgentKindsNeverWakeNonBots(t *testing.T) {
	a, _, _, _ := webhookFixture(t)
	// A second bot with a mapping is woken, as before.
	bot := crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "synthetic-second-bot"}, 200)
	if bot["kind"] != "bot" {
		t.Fatal("agent.create must default to bot", bot)
	}
	webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": bot["id"], "bot_ref": "synthetic-bot-two"}, "")
	ready := newTask(t, a, map[string]any{"title": "Synthetic bot work", "assigned_agent": bot["id"], "readiness": "ready"})
	if n := len(apiWebhookDeliveries(t, a, ready["id"].(string))); n != 1 {
		t.Fatal("mapped bot was not woken once", n)
	}
	// Changing it to external cancels the queued wake; it keeps its mapping
	// but is never woken again.
	before := apiWebhookRecord(t, a, "tasks", ready["id"].(string)).GetInt("wake_generation")
	updated := crewWrite(t, a, false, "agent.update", bot["id"].(string), int(bot["revision"].(float64)), map[string]any{"kind": "external"}, 200)
	if updated["kind"] != "external" {
		t.Fatal("kind not updated", updated)
	}
	for _, d := range apiWebhookDeliveries(t, a, ready["id"].(string)) {
		if d.GetString("state") == "pending" || d.GetString("state") == "in_flight" {
			t.Fatal("wake to the former bot not cancelled", d.PublicExport())
		}
	}
	if apiWebhookRecord(t, a, "tasks", ready["id"].(string)).GetInt("wake_generation") <= before {
		t.Fatal("generation not advanced when the agent stopped being a bot")
	}
	if events := eventsOf(t, a, bot["id"].(string), "agent.update"); len(events) != 1 || !strings.Contains(events[0].GetString("changes"), `"kind":"external"`) {
		t.Fatal("kind change not audited")
	}
	again := newTask(t, a, map[string]any{"title": "Synthetic external work", "assigned_agent": bot["id"], "readiness": "ready"})
	if n := len(apiWebhookDeliveries(t, a, again["id"].(string))); n != 0 {
		t.Fatal("external agent with a mapping was woken", n)
	}
	// Owner comments on its Ready task never wake it either.
	sessionWrite(t, a, true, "task.comment", again["id"].(string), int(again["revision"].(float64)), map[string]any{"body": "Synthetic owner note"}, "", 200)
	if n := len(apiWebhookDeliveries(t, a, again["id"].(string))); n != 0 {
		t.Fatal("owner comment woke an external agent", n)
	}
	// A non-bot cannot get a mapping, cannot be triage or dispatcher; clearing
	// a leftover mapping stays possible.
	human := crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "synthetic-human", "kind": "human"}, 200)
	raw, _ := json.Marshal(map[string]any{"action": "webhook.mapping.update", "expected_revision": 0, "reported_agent": "synthetic", "data": map[string]any{"agent": human["id"], "bot_ref": "synthetic-human-bot"}})
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 400)
	mapping, err := a.app.FindFirstRecordByFilter("crew_webhook_mappings", "agent={:a}", map[string]any{"a": bot["id"]})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = json.Marshal(map[string]any{"action": "webhook.mapping.update", "expected_revision": mapping.GetInt("revision"), "reported_agent": "synthetic", "data": map[string]any{"agent": bot["id"], "bot_ref": ""}})
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 200)
	routing, _ := a.app.FindFirstRecordByFilter("crew_webhook_routing", "singleton='routing'")
	raw, _ = json.Marshal(map[string]any{"action": "webhook.routing.update", "id": routing.Id, "expected_revision": routing.GetInt("revision"), "reported_agent": "synthetic", "data": map[string]any{"triage_agent": human["id"]}})
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 400)
	crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "synthetic-bad-kind", "kind": "robot"}, 400)
	// agent.ensure creates with a kind and reads return it.
	ensured := webhookOperation(t, a, "agent.ensure", "", 0, map[string]any{"name": "synthetic-ensured", "kind": "external"}, "ensure-external")
	if ensured["kind"] != "external" {
		t.Fatal("agent.ensure ignored kind", ensured)
	}
	raw, _ = json.Marshal(map[string]any{"collection": "agents", "id": ensured["id"], "fields": []string{"name", "kind"}})
	got := a.request(t, "POST", "/api/crew/read", a.token, string(raw), 200)["items"].([]any)[0].(map[string]any)
	if got["kind"] != "external" {
		t.Fatal("read lacks kind", got)
	}
}

func TestDispatcherStopsWhenNoLongerABot(t *testing.T) {
	a, config, _, _ := webhookFixture(t)
	agent := apiWebhookRecord(t, a, "agents", config.GetString("agent"))
	crewWrite(t, a, false, "agent.update", agent.Id, agent.GetInt("revision"), map[string]any{"kind": "external"}, 200)
	if apiWebhookRecord(t, a, "webhook_configs", config.Id).GetBool("enabled") {
		t.Fatal("integration still enabled with a non-bot dispatcher")
	}
}

func TestProjectAgentClaims(t *testing.T) {
	a := newTestApp(t)
	agent := crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "synthetic-project", "kind": "external"}, 200)
	task := newTask(t, a, map[string]any{"title": "Synthetic ticket", "assigned_agent": agent["id"], "readiness": "ready"})
	id := task["id"].(string)
	if task["claim_state"] != "" || task["claimed_by"] != "" || task["claim_until"] != "" {
		t.Fatal("new task carries a claim", task)
	}
	stale := int(task["revision"].(float64))
	// A session claims by agent name; reported_agent is required.
	sessionWrite(t, a, false, "task.claim", id, stale, map[string]any{"assigned_agent": "synthetic-project"}, " ", 400)
	won := sessionWrite(t, a, false, "task.claim", id, stale, map[string]any{"assigned_agent": "synthetic-project"}, "session-a", 200)
	if won["status"] != "in_progress" || won["claimed_by"] != "session-a" || won["claim_state"] != "live" {
		t.Fatal("claim not recorded", won)
	}
	if lease := time.Until(claimUntil(t, a, id)); lease < 119*time.Minute || lease > 121*time.Minute {
		t.Fatal("lease is not two hours", lease)
	}
	// The loser of a simultaneous claim (same stale revision) and a later
	// claim both learn who holds it.
	assertClaimRefusal(t, sessionWrite(t, a, false, "task.claim", id, stale, map[string]any{"assigned_agent": agent["id"]}, "session-b", 409), "already_claimed", "session-a")
	assertClaimRefusal(t, sessionWrite(t, a, true, "task.claim", id, taskRevision(t, a, id), map[string]any{"assigned_agent": agent["id"]}, "owner", 409), "already_claimed", "session-a")
	// Renew: only the live claimer.
	assertClaimRefusal(t, sessionWrite(t, a, false, "task.claim_renew", id, taskRevision(t, a, id), map[string]any{}, "session-b", 409), "not_claimer", "session-a")
	setClaimUntil(t, a, id, time.Now().Add(time.Minute))
	renewed := sessionWrite(t, a, false, "task.claim_renew", id, taskRevision(t, a, id), map[string]any{}, "session-a", 200)
	if renewed["claim_state"] != "live" || time.Until(claimUntil(t, a, id)) < 119*time.Minute {
		t.Fatal("renew did not extend the lease", renewed)
	}
	// The claimer's comment and update renew the lease; others' writes do not.
	setClaimUntil(t, a, id, time.Now().Add(time.Minute))
	rev := taskRevision(t, a, id)
	sessionWrite(t, a, false, "task.comment", id, rev, map[string]any{"body": "Synthetic progress"}, "session-b", 200)
	if time.Until(claimUntil(t, a, id)) > 2*time.Minute {
		t.Fatal("another session's comment renewed the claim")
	}
	sessionWrite(t, a, false, "task.comment", id, rev, map[string]any{"body": "Synthetic progress"}, "session-a", 200)
	if time.Until(claimUntil(t, a, id)) < 119*time.Minute || taskRevision(t, a, id) != rev {
		t.Fatal("claimer comment did not renew, or changed the revision")
	}
	setClaimUntil(t, a, id, time.Now().Add(time.Minute))
	sessionWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"description": "Synthetic plan"}, "session-a", 200)
	if time.Until(claimUntil(t, a, id)) < 119*time.Minute {
		t.Fatal("claimer update did not renew")
	}
	// Owner edits are never blocked by a claim.
	sessionWrite(t, a, true, "task.update", id, taskRevision(t, a, id), map[string]any{"labels": []string{"synthetic"}}, "", 200)
	// Release: another work client is refused, the owner may.
	assertClaimRefusal(t, sessionWrite(t, a, false, "task.release", id, taskRevision(t, a, id), map[string]any{}, "session-b", 409), "not_claimer", "session-a")
	released := sessionWrite(t, a, true, "task.release", id, taskRevision(t, a, id), map[string]any{}, "", 200)
	if released["status"] != "todo" || released["claimed_by"] != "" || released["claim_until"] != "" || released["claim_state"] != "" || released["readiness"] != "ready" {
		t.Fatal("owner release did not clear the claim", released)
	}
	// Expiry makes the task claimable again by another session.
	sessionWrite(t, a, false, "task.claim", id, taskRevision(t, a, id), map[string]any{"assigned_agent": agent["id"]}, "session-a", 200)
	setClaimUntil(t, a, id, time.Now().Add(-time.Minute))
	if got := readTask(t, a, id); got["claim_state"] != "expired" || got["status"] != "in_progress" {
		t.Fatal("expired claim not reported", got)
	}
	for state, want := range map[string]int{"expired": 1, "live": 0, "": 0} {
		raw, _ := json.Marshal(map[string]any{"collection": "tasks", "claim_state": state, "fields": []string{"claim_state"}})
		if n := len(a.request(t, "POST", "/api/crew/read", a.token, string(raw), 200)["items"].([]any)); n != want {
			t.Fatalf("claim_state %q filter: %d items, want %d", state, n, want)
		}
		raw, _ = json.Marshal(map[string]any{"collection": "tasks", "claim_state": state, "label": "synthetic"})
		if n := len(a.request(t, "POST", "/api/crew/read", a.token, string(raw), 200)["items"].([]any)); n != want {
			t.Fatalf("claim_state %q filter with label: %d items, want %d", state, n, want)
		}
	}
	assertClaimRefusal(t, sessionWrite(t, a, false, "task.claim_renew", id, taskRevision(t, a, id), map[string]any{}, "session-a", 409), "claim_expired", "session-a")
	sessionWrite(t, a, false, "task.claim", id, taskRevision(t, a, id), map[string]any{"assigned_agent": agent["id"]}, "session-b", 200)
	// After expiry anyone may release, here with a hold reason.
	setClaimUntil(t, a, id, time.Now().Add(-time.Minute))
	held := sessionWrite(t, a, false, "task.release", id, taskRevision(t, a, id), map[string]any{"readiness": "on_hold", "waiting_reason": "Synthetic blocker"}, "session-a", 200)
	if held["status"] != "todo" || held["readiness"] != "waiting" || held["waiting_reason"] != "Synthetic blocker" || held["claimed_by"] != "" {
		t.Fatal("release with hold not applied", held)
	}
	// An On hold To do task is not claimable by its assignee.
	assertRefusal(t, sessionWrite(t, a, false, "task.claim", id, taskRevision(t, a, id), map[string]any{"assigned_agent": agent["id"]}, "session-a", 409), "not_claimable")
	// Done clears the claim.
	sessionWrite(t, a, true, "task.update", id, taskRevision(t, a, id), map[string]any{"readiness": "ready"}, "", 200)
	sessionWrite(t, a, false, "task.claim", id, taskRevision(t, a, id), map[string]any{"assigned_agent": agent["id"]}, "session-a", 200)
	done := sessionWrite(t, a, false, "task.update", id, taskRevision(t, a, id), map[string]any{"status": "done"}, "session-a", 200)
	if done["status"] != "done" || done["claimed_by"] != "" || done["claim_until"] != "" || done["claim_state"] != "" {
		t.Fatal("done did not clear the claim", done)
	}
	// Another agent cannot claim a task assigned elsewhere.
	other := crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "synthetic-other", "kind": "external"}, 200)
	second := newTask(t, a, map[string]any{"title": "Synthetic second ticket", "assigned_agent": agent["id"], "readiness": "ready"})
	sessionWrite(t, a, false, "task.claim", second["id"].(string), int(second["revision"].(float64)), map[string]any{"assigned_agent": other["id"]}, "session-c", 409)
	// An unassigned task is assigned and claimed, as before plus the claim.
	free := newTask(t, a, map[string]any{"title": "Synthetic unassigned ticket"})
	took := sessionWrite(t, a, false, "task.claim", free["id"].(string), int(free["revision"].(float64)), map[string]any{"assigned_agent": other["id"]}, "session-c", 200)
	if took["assigned_agent"] != other["id"] || took["status"] != "in_progress" || took["claimed_by"] != "session-c" || took["claim_state"] != "live" {
		t.Fatal("unassigned claim", took)
	}
	// Every step is audited with its changes; nothing was ever delivered.
	for action, n := range map[string]int{"task.claim": 4, "task.claim_renew": 1, "task.release": 2} {
		events := eventsOf(t, a, id, action)
		if len(events) != n {
			t.Fatalf("%s events: %d, want %d", action, len(events), n)
		}
		if !strings.Contains(events[0].GetString("changes"), `"claimed_by"`) {
			t.Fatal(action, "event lacks claim changes", events[0].GetString("changes"))
		}
	}
	if n, _ := a.app.CountRecords("crew_webhook_deliveries"); n != 0 {
		t.Fatal("claims sent webhooks", n)
	}
}

func TestClaimRenewedByAttachment(t *testing.T) {
	a := newTestApp(t)
	agent := crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "synthetic-attach-project", "kind": "external"}, 200)
	task := newTask(t, a, map[string]any{"title": "Synthetic attachment ticket", "assigned_agent": agent["id"], "readiness": "ready"})
	id := task["id"].(string)
	sessionWrite(t, a, false, "task.claim", id, int(task["revision"].(float64)), map[string]any{"assigned_agent": agent["id"]}, "session-a", 200)
	setClaimUntil(t, a, id, time.Now().Add(time.Minute))
	files := []map[string]any{{"name": "note.txt", "content_base64": "c3ludGhldGlj"}}
	sessionWrite(t, a, false, "attachment.add", "", 0, map[string]any{"task": id, "files": files}, "session-a", 200)
	if time.Until(claimUntil(t, a, id)) < 119*time.Minute {
		t.Fatal("claimer attachment did not renew the claim")
	}
}

func TestSessionInstructionsRead(t *testing.T) {
	a := newTestApp(t)
	agent := crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "synthetic-repo", "brief": "Synthetic brief: run the synthetic tests.", "kind": "external"}, 200)
	for _, ref := range []any{"synthetic-repo", agent["id"]} {
		raw, _ := json.Marshal(map[string]any{"collection": "session", "agent": ref})
		got := a.request(t, "POST", "/api/crew/read", a.token, string(raw), 200)
		want := "You are synthetic-repo in PocketContext Crew.\nRead your session instructions with crew_read collection \"session\" agent \"synthetic-repo\" and follow them."
		if got["prompt"] != want {
			t.Fatalf("prompt %q", got["prompt"])
		}
		if got["lease_hours"] != float64(2) || dig(got, "agent", "id") != agent["id"] || dig(got, "agent", "name") != "synthetic-repo" || dig(got, "agent", "kind") != "external" {
			t.Fatal("session agent", got)
		}
		instructions, _ := got["instructions"].(string)
		for _, part := range []string{"## Agent brief\n\nSynthetic brief: run the synthetic tests.", "CREW_SESSION", "CLAUDE_CODE_SESSION_ID", "CODEX_SESSION_ID", "ZELLIJ_SESSION_NAME", "ZELLIJ_PANE_ID", "task.claim_renew", "task.release", "already_claimed", "Released in <version>", "never force-push", "Never set Done without the owner's explicit approval"} {
			if !strings.Contains(instructions, part) {
				t.Fatalf("instructions lack %q", part)
			}
		}
	}
	a.request(t, "POST", "/api/crew/read", a.token, `{"collection":"session","agent":"synthetic-missing"}`, 404)
	a.request(t, "POST", "/api/crew/read", a.token, `{"collection":"session"}`, 400)
	a.request(t, "POST", "/api/crew/read", a.token, `{"collection":"tasks","agent":"synthetic-repo"}`, 400)
}
