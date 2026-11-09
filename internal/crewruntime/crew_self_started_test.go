package crewruntime

import (
	"encoding/json"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

const selfStartName = "Synthetic webhook agent"

func selfStartWrite(t *testing.T, a *testApp, action, id string, revision int, data map[string]any, reported string, owner bool, status int) map[string]any {
	t.Helper()
	b := map[string]any{"action": action, "data": data}
	if reported != "" {
		b["reported_agent"] = reported
	}
	if id != "" {
		b["id"] = id
	}
	if revision > 0 {
		b["expected_revision"] = revision
	}
	raw, _ := json.Marshal(b)
	route := "/api/crew/agent-write"
	if owner {
		route = "/api/crew/write"
	}
	return a.request(t, "POST", route, a.token, string(raw), status)
}

func selfStartDeliveries(t *testing.T, a *testApp, task string) []*core.Record {
	t.Helper()
	rows, err := a.app.FindRecordsByFilter("crew_webhook_deliveries", "task={:task}", "created", 0, 0, map[string]any{"task": task})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func selfStartEvents(t *testing.T, a *testApp, task string) []*core.Record {
	t.Helper()
	rows, err := a.app.FindRecordsByFilter("crew_events", "parent={:task} && action='task.self_started'", "", 0, 0, map[string]any{"task": task})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func assertSelfStartWoke(t *testing.T, a *testApp, task, reason string) {
	t.Helper()
	wakes := selfStartDeliveries(t, a, task)
	if len(wakes) != 1 || !strings.Contains(wakes[0].GetString("payload"), `"reason":"`+reason+`"`) {
		t.Fatal("expected one wake with reason", reason, len(wakes))
	}
	record := apiWebhookRecord(t, a, "tasks", task)
	if record.GetInt("execution_required_generation") != record.GetInt("wake_generation") || record.GetInt("wake_generation") == 0 {
		t.Fatal("wake did not govern the task", record.GetInt("execution_required_generation"), record.GetInt("wake_generation"))
	}
	if len(selfStartEvents(t, a, task)) != 0 {
		t.Fatal("woken task recorded as self-started")
	}
}

func TestSelfStartedTaskEmitsNoWakeOrGovernance(t *testing.T) {
	a, config, _, _ := webhookFixture(t)
	assignee := config.GetString("agent")
	created := selfStartWrite(t, a, "task.create", "", 0, map[string]any{"title": "Synthetic self-started work", "assigned_agent": assignee, "readiness": "ready", "status": "in_progress"}, selfStartName, false, 200)
	id := created["id"].(string)
	if rows := selfStartDeliveries(t, a, id); len(rows) != 0 {
		t.Fatal("self-started task woke the dispatcher", len(rows))
	}
	task := apiWebhookRecord(t, a, "tasks", id)
	if task.GetInt("execution_required_generation") != 0 || task.GetInt("wake_generation") != 0 {
		t.Fatal("self-started task was governed or bumped", task.GetInt("execution_required_generation"), task.GetInt("wake_generation"))
	}
	events := selfStartEvents(t, a, id)
	if len(events) != 1 || events[0].GetString("reason") != "created" || events[0].GetString("reported_agent") != selfStartName {
		t.Fatal("self-started event missing", len(events))
	}
	var changes map[string]any
	if err := events[0].UnmarshalJSONField("changes", &changes); err != nil || changes["assignee"] != assignee || changes["reason"] != "created" {
		t.Fatal("self-started event data", changes, err)
	}
	updated := selfStartWrite(t, a, "task.update", id, task.GetInt("revision"), map[string]any{"description": "Synthetic progress"}, selfStartName, false, 200)
	if updated["description"] != "Synthetic progress" {
		t.Fatal("creator could not update its self-started task", updated)
	}
}

func TestSelfStartedSuppressionKeepsOtherCreateWakes(t *testing.T) {
	a, config, _, _ := webhookFixture(t)
	assignee := config.GetString("agent")
	other := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Synthetic other agent"}, "")
	webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": other["id"], "bot_ref": "synthetic-other"}, "")
	for _, tc := range []struct {
		name, reported, status string
		agent                  any
		owner                  bool
	}{
		{name: "self-created todo", reported: selfStartName, status: "todo", agent: assignee},
		{name: "another agent", reported: selfStartName, status: "in_progress", agent: other["id"]},
		{name: "owner-created", reported: selfStartName, status: "in_progress", agent: assignee, owner: true},
		{name: "owner-created without attribution", status: "todo", agent: assignee, owner: true},
		{name: "empty reported agent", status: "in_progress", agent: assignee},
		{name: "non-matching reported agent", reported: "Synthetic other agent", status: "in_progress", agent: assignee},
		{name: "name differs by case", reported: strings.ToLower(selfStartName), status: "in_progress", agent: assignee},
	} {
		t.Run(tc.name, func(t *testing.T) {
			created := selfStartWrite(t, a, "task.create", "", 0, map[string]any{"title": "Synthetic " + tc.name, "assigned_agent": tc.agent, "readiness": "ready", "status": tc.status}, tc.reported, tc.owner, 200)
			assertSelfStartWoke(t, a, created["id"].(string), "created")
		})
	}
}

func TestSelfCreatedWaitingTaskWakesWhenOwnerSetsReady(t *testing.T) {
	a, config, _, _ := webhookFixture(t)
	created := selfStartWrite(t, a, "task.create", "", 0, map[string]any{"title": "Synthetic waiting self task", "assigned_agent": config.GetString("agent"), "status": "in_progress"}, selfStartName, false, 200)
	id := created["id"].(string)
	if len(selfStartDeliveries(t, a, id)) != 0 || len(selfStartEvents(t, a, id)) != 0 {
		t.Fatal("waiting task woke or was recorded as self-started")
	}
	selfStartWrite(t, a, "task.update", id, int(created["revision"].(float64)), map[string]any{"readiness": "ready"}, "", true, 200)
	assertSelfStartWoke(t, a, id, "ready")
}

// A claim on a triage-woken task must keep its assigned wake: the claim bumps
// the generation, so without a new event the claimant would be stranded on 409s.
func TestGovernedTriageClaimStillWakesClaimant(t *testing.T) {
	a, config, _, _ := webhookFixture(t)
	agent := config.GetString("agent")
	routing, err := a.app.FindFirstRecordByFilter("crew_webhook_routing", "id!=''")
	if err != nil {
		t.Fatal(err)
	}
	webhookOperation(t, a, "webhook.routing.update", "", routing.GetInt("revision"), map[string]any{"triage_agent": agent}, "")
	created := selfStartWrite(t, a, "task.create", "", 0, map[string]any{"title": "Synthetic triage work", "readiness": "ready"}, selfStartName, false, 200)
	id := created["id"].(string)
	first := selfStartDeliveries(t, a, id)
	if len(first) != 1 {
		t.Fatal("triage task did not wake", len(first))
	}
	run := beginSelf(t, a, first[0], "synthetic-triage")
	task := apiWebhookRecord(t, a, "tasks", id)
	raw, _ := json.Marshal(map[string]any{"action": "task.claim", "id": id, "expected_revision": task.GetInt("revision"), "reported_agent": selfStartName, "data": map[string]any{"assigned_agent": agent}, "execution": run["execution"]})
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 200)
	wakes := selfStartDeliveries(t, a, id)
	claimed := apiWebhookRecord(t, a, "tasks", id)
	if len(wakes) != 2 || !strings.Contains(wakes[1].GetString("payload"), `"reason":"assigned"`) || wakes[1].GetString("agent") != agent {
		t.Fatal("claim did not wake the claimant", len(wakes))
	}
	if claimed.GetInt("wake_generation") != first[0].GetInt("generation")+1 || claimed.GetInt("execution_required_generation") != claimed.GetInt("wake_generation") {
		t.Fatal("claim did not start a new governed generation", claimed.GetInt("wake_generation"), claimed.GetInt("execution_required_generation"))
	}
	if len(selfStartEvents(t, a, id)) != 0 {
		t.Fatal("claim recorded as self-started")
	}
}
