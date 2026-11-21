package crewruntime

import "testing"

func TestAgentStartupTogglePreservesDispatcherAndOtherRecipients(t *testing.T) {
	a, config, _, _ := webhookFixture(t)
	dispatcher := apiWebhookRecord(t, a, "agents", config.GetString("agent"))
	dm, err := a.app.FindFirstRecordByFilter("crew_webhook_mappings", "agent={:id}", map[string]any{"id": dispatcher.Id})
	if err != nil {
		t.Fatal(err)
	}
	agent := crewWrite(t, a, true, "agent.create", "", 0, map[string]any{"name": "Synthetic manual agent", "kind": "external"}, 200)
	id := agent["id"].(string)
	sessionUpdate(t, a, true, 0, map[string]any{"agent": id, "instructions": "Keep the synthetic agent's workflow."}, "synthetic", 200)
	enable := map[string]any{"enabled": true, "mapping_revision": 0, "config_revision": config.GetInt("revision"), "bot_ref": "synthetic-new-ref"}
	updated := crewWrite(t, a, true, "webhook.startup.update", id, int(agent["revision"].(float64)), enable, 200)
	if updated["kind"] != "bot" || updated["startup_disabled"] != false {
		t.Fatal(updated)
	}
	if session := readJSON(t, a, map[string]any{"collection": "session", "agent": id}, 200); session["body"] != "Keep the synthetic agent's workflow." {
		t.Fatal(session)
	}
	crewWrite(t, a, true, "webhook.startup.update", id, int(agent["revision"].(float64)), enable, 409)
	checkWake := func(assignee string, n int) {
		t.Helper()
		task := newTask(t, a, map[string]any{"title": "Synthetic startup check", "assigned_agent": assignee, "readiness": "ready"})
		if got := len(apiWebhookDeliveries(t, a, task["id"].(string))); got != n {
			t.Fatalf("agent %s: got %d wakes, want %d", assignee, got, n)
		}
	}
	checkWake(id, 1)
	off := crewWrite(t, a, true, "webhook.startup.update", dispatcher.Id, dispatcher.GetInt("revision"), map[string]any{"enabled": false, "mapping_revision": dm.GetInt("revision")}, 200)
	checkWake(dispatcher.Id, 0)
	checkWake(id, 1)
	if got := apiWebhookRecord(t, a, "webhook_configs", config.Id); !got.GetBool("enabled") || got.GetInt("revision") != config.GetInt("revision") {
		t.Fatal("shared configuration was altered")
	}
	if got := apiWebhookRecord(t, a, "webhook_mappings", dm.Id); got.GetInt("revision") != dm.GetInt("revision") || got.GetString("bot_ref") != dm.GetString("bot_ref") {
		t.Fatal("shared dispatcher mapping was altered")
	}
	enable["mapping_revision"] = dm.GetInt("revision")
	enable["bot_ref"] = dm.GetString("bot_ref")
	crewWrite(t, a, true, "webhook.startup.update", dispatcher.Id, int(off["revision"].(float64)), enable, 200)
	checkWake(dispatcher.Id, 1)
}

func TestAgentStartupEnableIsAtomic(t *testing.T) {
	a, config, _, _ := webhookFixture(t)
	manual := crewWrite(t, a, true, "agent.create", "", 0, map[string]any{"name": "Synthetic manual", "kind": "external"}, 200)
	id := manual["id"].(string)
	rev := int(manual["revision"].(float64))
	enable := map[string]any{"enabled": true, "mapping_revision": 0, "config_revision": config.GetInt("revision") - 1, "bot_ref": "synthetic-other"}
	crewWrite(t, a, true, "webhook.startup.update", id, rev, enable, 409)
	enable["config_revision"] = config.GetInt("revision")
	enable["bot_ref"] = "synthetic-bot" // The dispatcher's recipient cannot be taken.
	crewWrite(t, a, true, "webhook.startup.update", id, rev, enable, 409)
	r := apiWebhookRecord(t, a, "agents", id)
	if r.GetString("kind") != "external" || r.GetInt("revision") != rev {
		t.Fatal("failed operation modified agent")
	}
	if session := readJSON(t, a, map[string]any{"collection": "session", "agent": id}, 200); session["revision"] != float64(0) {
		t.Fatal("failed operation modified instructions")
	}
	enable["bot_ref"] = "synthetic-other"
	before := readJSON(t, a, map[string]any{"collection": "session", "agent": id}, 200)
	crewWrite(t, a, true, "webhook.startup.update", id, rev, enable, 200)
	after := readJSON(t, a, map[string]any{"collection": "session", "agent": id}, 200)
	if before["body"] != after["body"] {
		t.Fatal("built-in session instructions changed")
	}
}
