package crewruntime

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

const archiveAgent = "Synthetic archive agent"

func archiveRecord(t *testing.T, a *testApp, id string) *core.Record {
	t.Helper()
	record, err := a.app.FindRecordById("crew_tasks", id)
	if err != nil {
		t.Fatal(err)
	}
	return record
}

// doneGoverned finishes the fixture task as the owner, leaving its marker set.
func doneGoverned(t *testing.T, a *testApp, id string) *core.Record {
	t.Helper()
	selfStartWrite(t, a, "task.update", id, archiveRecord(t, a, id).GetInt("revision"), map[string]any{"status": "done"}, "", true, 200)
	task := archiveRecord(t, a, id)
	if task.GetInt("execution_required_generation") == 0 || task.GetString("status") != "done" {
		t.Fatal("task is not done and governed", task.GetInt("execution_required_generation"), task.GetString("status"))
	}
	return task
}

func archiveWrite(t *testing.T, a *testApp, id string, data map[string]any, status int) map[string]any {
	t.Helper()
	return selfStartWrite(t, a, "task.update", id, archiveRecord(t, a, id).GetInt("revision"), data, archiveAgent, false, status)
}

func assertRefusal(t *testing.T, body map[string]any, code string) string {
	t.Helper()
	reason, _ := dig(body, "data", "reason").(map[string]any)
	if reason == nil || reason["code"] != code {
		t.Fatal("wrong refusal", body)
	}
	message, _ := reason["message"].(string)
	if top, _ := body["message"].(string); !strings.HasPrefix(top, message) {
		t.Fatal("top-level message differs from the reason", body)
	}
	return message
}

func dig(value any, keys ...string) any {
	for _, key := range keys {
		m, ok := value.(map[string]any)
		if !ok {
			return nil
		}
		value = m[key]
	}
	return value
}

func TestAgentArchivesDoneGovernedTask(t *testing.T) {
	for _, tc := range []struct {
		name  string
		extra map[string]any
	}{
		{name: "plain", extra: map[string]any{}},
		{name: "null execution", extra: map[string]any{"execution": nil}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, _, task, _ := webhookFixture(t)
			before := doneGoverned(t, a, task.Id)
			deliveries := len(selfStartDeliveries(t, a, task.Id))
			b := map[string]any{"action": "task.update", "id": task.Id, "expected_revision": before.GetInt("revision"), "reported_agent": archiveAgent, "data": map[string]any{"archived": true}}
			for k, v := range tc.extra {
				b[k] = v
			}
			raw, _ := json.Marshal(b)
			a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 200)
			after := archiveRecord(t, a, task.Id)
			if !after.GetBool("archived") || after.GetString("status") != "done" {
				t.Fatal("task was not archived")
			}
			if after.GetInt("execution_required_generation") != before.GetInt("execution_required_generation") {
				t.Fatal("marker changed", after.GetInt("execution_required_generation"))
			}
			if after.GetInt("wake_generation") != before.GetInt("wake_generation") {
				t.Fatal("generation bumped", after.GetInt("wake_generation"))
			}
			if got := len(selfStartDeliveries(t, a, task.Id)); got != deliveries {
				t.Fatal("archive emitted a delivery", got)
			}
			events, err := a.app.FindRecordsByFilter("crew_events", "parent={:task} && action='task.update' && reported_agent={:agent}", "", 0, 0, map[string]any{"task": task.Id, "agent": archiveAgent})
			if err != nil || len(events) != 1 {
				t.Fatal("audit event missing", len(events), err)
			}
		})
	}
}

// Supplied proof is always validated, even when no proof would be needed: the
// _crew envelope is removed before the guard and its proof is checked the same way.
func TestSuppliedProofIsAlwaysValidated(t *testing.T) {
	a, _, task, event := webhookFixture(t)
	run := beginSelf(t, a, event, "synthetic-envelope")
	done := doneGoverned(t, a, task.Id)
	raw := func(data map[string]any, extra map[string]any) string {
		b := map[string]any{"action": "task.update", "id": task.Id, "expected_revision": done.GetInt("revision"), "reported_agent": archiveAgent, "data": data}
		for k, v := range extra {
			b[k] = v
		}
		out, _ := json.Marshal(b)
		return string(out)
	}
	// The done task invalidated the execution, so its proof is obsolete.
	body := a.request(t, "POST", "/api/crew/agent-write", a.token, raw(map[string]any{"archived": true, "_crew": map[string]any{"execution": run["execution"]}}, nil), 409)
	assertRefusal(t, body, "execution_conflict")
	body = a.request(t, "POST", "/api/crew/agent-write", a.token, raw(map[string]any{"archived": true}, map[string]any{"execution": run["execution"]}), 409)
	assertRefusal(t, body, "execution_conflict")
	a.request(t, "POST", "/api/crew/agent-write", a.token, raw(map[string]any{"archived": true}, map[string]any{"execution": "synthetic-not-proof"}), 400)
	// Unknown envelope keys are refused before the guard.
	a.request(t, "POST", "/api/crew/agent-write", a.token, raw(map[string]any{"archived": true, "_crew": map[string]any{"owner": true}}, nil), 400)
	if archiveRecord(t, a, task.Id).GetBool("archived") {
		t.Fatal("a refused write archived the task")
	}
	// Without proof and without a live execution the write applies.
	a.request(t, "POST", "/api/crew/agent-write", a.token, raw(map[string]any{"archived": true, "description": "x", "_crew": map[string]any{"idempotency_key": "synthetic-only"}}, nil), 200)
	if !archiveRecord(t, a, task.Id).GetBool("archived") {
		t.Fatal("unproved write without a live execution was refused")
	}
}

// execution_required_generation no longer blocks work clients by itself; only a
// live execution does.
func TestAgentWritesGovernedTaskWithoutLiveExecution(t *testing.T) {
	t.Run("extra fields", func(t *testing.T) {
		a, _, task, _ := webhookFixture(t)
		doneGoverned(t, a, task.Id)
		archiveWrite(t, a, task.Id, map[string]any{"archived": true, "description": "Synthetic extra"}, 200)
	})
	t.Run("agent restores", func(t *testing.T) {
		a, _, task, _ := webhookFixture(t)
		doneGoverned(t, a, task.Id)
		archiveWrite(t, a, task.Id, map[string]any{"archived": true}, 200)
		archiveWrite(t, a, task.Id, map[string]any{"archived": false}, 200)
		if archiveRecord(t, a, task.Id).GetBool("archived") {
			t.Fatal("agent could not restore the task")
		}
	})
	for _, status := range []string{"todo", "in_progress"} {
		t.Run("status "+status, func(t *testing.T) {
			a, _, task, _ := webhookFixture(t)
			if status != "todo" {
				record := archiveRecord(t, a, task.Id)
				record.Set("status", status)
				if err := a.app.Save(record); err != nil {
					t.Fatal(err)
				}
			}
			if archiveRecord(t, a, task.Id).GetInt("execution_required_generation") == 0 {
				t.Fatal("fixture task is not governed")
			}
			archiveWrite(t, a, task.Id, map[string]any{"description": "Synthetic unfenced update"}, 200)
			archiveWrite(t, a, task.Id, map[string]any{"archived": true}, 200)
		})
	}
	t.Run("agent waiting releases governance", func(t *testing.T) {
		a, _, task, _ := webhookFixture(t)
		archiveWrite(t, a, task.Id, map[string]any{"readiness": "waiting"}, 200)
		if got := archiveRecord(t, a, task.Id).GetInt("execution_required_generation"); got != 0 {
			t.Fatal("agent Waiting did not release governance", got)
		}
	})
	t.Run("handoff limited", func(t *testing.T) {
		a, _, task, _ := webhookFixture(t)
		done := doneGoverned(t, a, task.Id)
		done.Set("handoff_limited", true)
		if err := a.app.Save(done); err != nil {
			t.Fatal(err)
		}
		archiveWrite(t, a, task.Id, map[string]any{"archived": true}, 200)
	})
	t.Run("revision conflict", func(t *testing.T) {
		a, _, task, _ := webhookFixture(t)
		done := doneGoverned(t, a, task.Id)
		selfStartWrite(t, a, "task.update", task.Id, done.GetInt("revision")-1, map[string]any{"archived": true}, archiveAgent, false, 409)
		if archiveRecord(t, a, task.Id).GetBool("archived") {
			t.Fatal("stale revision archived the task")
		}
	})
}

// A live execution still fences other writers: without proof the write is
// refused, wrong proof is refused, and the holder's own proof succeeds.
func TestLiveExecutionRequiresProof(t *testing.T) {
	a, _, task, event := webhookFixture(t)
	run := beginSelf(t, a, event, "synthetic-live")
	assertRefusal(t, archiveWrite(t, a, task.Id, map[string]any{"description": "Synthetic stale writer"}, 409), "execution_required")
	for _, action := range []string{"task.comment", "review.request"} {
		data := map[string]any{}
		if action == "task.comment" {
			data["body"] = "Synthetic stale comment"
		}
		body := selfStartWrite(t, a, action, task.Id, archiveRecord(t, a, task.Id).GetInt("revision"), data, archiveAgent, false, 409)
		assertRefusal(t, body, "execution_required")
	}
	proof, _ := run["execution"].(map[string]any)
	wrong := map[string]any{"id": proof["id"], "worker_id": proof["worker_id"], "fence": proof["fence"].(float64) + 1}
	b, _ := json.Marshal(map[string]any{"action": "task.update", "id": task.Id, "expected_revision": archiveRecord(t, a, task.Id).GetInt("revision"), "reported_agent": archiveAgent, "data": map[string]any{"description": "Synthetic wrong fence"}, "execution": wrong})
	assertRefusal(t, a.request(t, "POST", "/api/crew/agent-write", a.token, string(b), 409), "execution_conflict")
	b, _ = json.Marshal(map[string]any{"action": "task.update", "id": task.Id, "expected_revision": archiveRecord(t, a, task.Id).GetInt("revision"), "reported_agent": archiveAgent, "data": map[string]any{"description": "Synthetic fenced"}, "execution": proof})
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(b), 200)
	if archiveRecord(t, a, task.Id).GetString("description") != "Synthetic fenced" {
		t.Fatal("holder proof did not apply")
	}
}

func TestArchiveExemptionOwnerUnchanged(t *testing.T) {
	a, _, task, _ := webhookFixture(t)
	selfStartWrite(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"archived": true}, "", true, 200)
	if !archiveRecord(t, a, task.Id).GetBool("archived") {
		t.Fatal("owner could not archive an unfinished governed task")
	}
	b, _, other, _ := webhookFixture(t)
	selfStartWrite(t, b, "task.update", other.Id, other.GetInt("revision"), map[string]any{"readiness": "waiting"}, "", true, 200)
	if archiveRecord(t, b, other.Id).GetInt("execution_required_generation") != 0 {
		t.Fatal("owner Waiting did not release the task")
	}
}

// Nothing can be current on a done task, so the guard invalidates whatever is
// left, whatever its lease says, and that invalidation commits with the archive.
func TestArchiveInvalidatesStaleExecutionAndPersists(t *testing.T) {
	for _, tc := range []struct {
		name, state string
		lease       time.Duration
	}{
		{name: "running with a lease", state: "running", lease: time.Hour},
		{name: "running past its lease", state: "running", lease: -time.Hour},
		{name: "handed off", state: "handed_off"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, _, task, event := webhookFixture(t)
			run := beginSelf(t, a, event, "synthetic-stale")
			stored, err := a.app.FindRecordById("crew_webhook_executions", run["id"].(string))
			if err != nil {
				t.Fatal(err)
			}
			stored.Set("state", tc.state)
			stored.Set("lease_until", "")
			if tc.lease != 0 {
				stored.Set("lease_until", time.Now().Add(tc.lease).UTC().Format(time.RFC3339))
			}
			if tc.state == "handed_off" {
				stored.Set("handoff_deadline_at", time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
			}
			if err := a.app.Save(stored); err != nil {
				t.Fatal(err)
			}
			// Direct saves skip the transition that normally invalidates on completion.
			record := archiveRecord(t, a, task.Id)
			record.Set("status", "done")
			if err := a.app.Save(record); err != nil {
				t.Fatal(err)
			}
			archiveWrite(t, a, task.Id, map[string]any{"archived": true}, 200)
			if !archiveRecord(t, a, task.Id).GetBool("archived") {
				t.Fatal("task was not archived")
			}
			saved, _ := a.app.FindRecordById("crew_webhook_executions", stored.Id)
			if saved.GetString("state") != "invalidated" || saved.GetString("outcome_code") != "work_no_longer_eligible" {
				t.Fatal("invalidation did not persist", saved.GetString("state"))
			}
		})
	}
}

func TestExecutionRequiredNamesHolder(t *testing.T) {
	t.Run("running", func(t *testing.T) {
		a, _, task, event := webhookFixture(t)
		run := beginSelf(t, a, event, "synthetic-secret-worker")
		execution, _ := a.app.FindRecordById("crew_webhook_executions", run["id"].(string))
		body := archiveWrite(t, a, task.Id, map[string]any{"archived": true}, 409)
		message := assertRefusal(t, body, "execution_required")
		for _, want := range []string{"Supply its execution proof", execution.Id, event.GetString("event_id"), "state running", "lease_until " + execution.GetString("lease_until"), ", live)"} {
			if !strings.Contains(message, want) {
				t.Fatal("holder detail missing", want, message)
			}
		}
		assertNoHandles(t, body, execution)
	})
	t.Run("handed off", func(t *testing.T) {
		a, config, _, _ := webhookFixture(t)
		recipient := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Synthetic recipient"}, "")
		webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": recipient["id"], "bot_ref": "synthetic-recipient"}, "")
		task := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Synthetic handed off", "assigned_agent": recipient["id"], "readiness": "ready"}, "")
		id := task["id"].(string)
		event := selfStartDeliveries(t, a, id)[0]
		run := executionOperation(t, a, "execution.begin", "", 0, map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation"), "role": "dispatcher", "worker_id": "synthetic-secret-dispatcher", "native_handoff": true}, "handoff", false, 200)
		if run["state"] != "handed_off" || config.GetString("agent") == recipient["id"] {
			t.Fatal("fixture did not hand off", run)
		}
		execution, _ := a.app.FindRecordById("crew_webhook_executions", run["id"].(string))
		body := archiveWrite(t, a, id, map[string]any{"archived": true}, 409)
		message := assertRefusal(t, body, "execution_required")
		for _, want := range []string{execution.Id, "state handed_off", "handoff_deadline_at " + execution.GetString("handoff_deadline_at"), ", live)"} {
			if !strings.Contains(message, want) {
				t.Fatal("holder detail missing", want, message)
			}
		}
		assertNoHandles(t, body, execution)
	})
	t.Run("not live", func(t *testing.T) {
		a, _, task, event := webhookFixture(t)
		run := beginSelf(t, a, event, "synthetic-expired")
		stored, _ := a.app.FindRecordById("crew_webhook_executions", run["id"].(string))
		stored.Set("lease_until", time.Now().Add(-time.Minute).UTC().Format(time.RFC3339))
		if err := a.app.Save(stored); err != nil {
			t.Fatal(err)
		}
		// An expired lease no longer fences other writers.
		archiveWrite(t, a, task.Id, map[string]any{"archived": true}, 200)
	})
	t.Run("none", func(t *testing.T) {
		a, _, task, _ := webhookFixture(t)
		archiveWrite(t, a, task.Id, map[string]any{"archived": true}, 200)
	})
}

func assertNoHandles(t *testing.T, body map[string]any, execution *core.Record) {
	t.Helper()
	raw, _ := json.Marshal(body)
	text := string(raw)
	for _, secret := range []string{"worker_id", "fence", "synthetic-secret"} {
		if strings.Contains(text, secret) {
			t.Fatal("refusal exposed", secret, text)
		}
	}
	for _, field := range []string{"worker_id", "dispatch_worker_id"} {
		if value := execution.GetString(field); value != "" && strings.Contains(text, value) {
			t.Fatal("refusal exposed", field, text)
		}
	}
}
