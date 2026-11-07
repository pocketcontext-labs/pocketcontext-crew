package bundle

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

func apiWebhookRecord(t *testing.T, a *testApp, collection, id string) *core.Record {
	t.Helper()
	row, err := a.app.FindRecordById("crew_"+collection, id)
	if err != nil {
		t.Fatal(err)
	}
	return row
}
func apiWebhookDeliveries(t *testing.T, a *testApp, task string) []*core.Record {
	t.Helper()
	rows, err := a.app.FindRecordsByFilter("crew_webhook_deliveries", "task={:task}", "created", 0, 0, dbx.Params{"task": task})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}
func apiWebhookAccept(t *testing.T, a *testApp) {
	t.Helper()
	w := newWebhookDispatcher(a.app)
	w.client = &http.Client{Transport: webhookRoundTrip(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 202, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	if err := w.tick(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestWebhookAPISubscriptionsMatchAllCauses(t *testing.T) {
	for _, subs := range [][]string{{"ready"}, {"assigned"}, {"ready", "assigned"}} {
		t.Run(strings.Join(subs, "+"), func(t *testing.T) {
			a, config, _, _ := webhookFixture(t)
			updated := webhookOperation(t, a, "webhook.update", config.Id, config.GetInt("revision"), map[string]any{"subscriptions": subs}, "")
			webhookOperation(t, a, "webhook.enable", config.Id, int(updated["revision"].(float64)), map[string]any{}, "")
			task := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Waiting unassigned synthetic work"}, "")
			if task["readiness"] != "waiting" {
				t.Fatal("new task does not default to waiting")
			}
			if len(apiWebhookDeliveries(t, a, task["id"].(string))) != 0 {
				t.Fatal("waiting task emitted wake")
			}
			ready := webhookOperation(t, a, "task.update", task["id"].(string), 1, map[string]any{"readiness": "ready", "assigned_agent": config.GetString("agent")}, "")
			deliveries := apiWebhookDeliveries(t, a, task["id"].(string))
			if len(deliveries) != 1 {
				t.Fatalf("combined ready+assignment emitted %d events for %v", len(deliveries), subs)
			}
			var payload map[string]any
			if err := json.Unmarshal([]byte(deliveries[0].GetString("payload")), &payload); err != nil {
				t.Fatal(err)
			}
			causes := map[string]bool{}
			for _, v := range payload["causes"].([]any) {
				causes[v.(string)] = true
			}
			if !causes["ready"] || !causes["assigned"] {
				t.Fatal("lost combined causes", payload)
			}
			if ready["revision"] != float64(2) || ready["wake_generation"] != float64(1) {
				t.Fatal("mutation must increment revision/generation once", ready)
			}
			webhookOperation(t, a, "task.comment", task["id"].(string), 2, map[string]any{"body": "Synthetic bookkeeping"}, "")
			current := apiWebhookRecord(t, a, "tasks", task["id"].(string))
			if current.GetInt("wake_generation") != 1 || len(apiWebhookDeliveries(t, a, current.Id)) != 1 {
				t.Fatal("comment triggered another wake")
			}
		})
	}
}

func TestWebhookAPICatchUpLostResponseIsIdempotent(t *testing.T) {
	a, config, task, original := webhookFixture(t)
	data := map[string]any{"tasks": []map[string]any{{"id": task.Id, "expected_revision": task.GetInt("revision")}}}
	result := webhookOperation(t, a, "webhook.catch_up", config.Id, config.GetInt("revision"), data, "synthetic-catch-up")
	// Replay the exact request after its original task revision has become stale.
	replay := webhookOperation(t, a, "webhook.catch_up", config.Id, config.GetInt("revision"), data, "synthetic-catch-up")
	one, _ := json.Marshal(result)
	two, _ := json.Marshal(replay)
	if string(one) != string(two) {
		t.Fatal("lost-response replay returned a different logical result")
	}
	current := apiWebhookRecord(t, a, "tasks", task.Id)
	if current.GetInt("wake_generation") != task.GetInt("wake_generation")+1 || current.GetInt("revision") != task.GetInt("revision")+1 {
		t.Fatal("replay incremented task state", current.PublicExport())
	}
	deliveries := apiWebhookDeliveries(t, a, task.Id)
	if len(deliveries) != 2 {
		t.Fatalf("catch-up replay duplicated events: %d", len(deliveries))
	}
	if apiWebhookRecord(t, a, "webhook_deliveries", original.Id).GetString("state") != "cancelled" {
		t.Fatal("catch-up did not supersede old queued event")
	}
	changed := map[string]any{"action": "webhook.catch_up", "id": config.Id, "expected_revision": config.GetInt("revision"), "idempotency_key": "synthetic-catch-up", "data": map[string]any{"tasks": []map[string]any{{"id": task.Id, "expected_revision": current.GetInt("revision")}}}}
	raw, _ := json.Marshal(changed)
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 409)
	if len(apiWebhookDeliveries(t, a, task.Id)) != 2 {
		t.Fatal("conflicting replay mutated deliveries")
	}
}

func TestWebhookAPITriageRouteChangesInvalidateAcceptedAndPendingEvents(t *testing.T) {
	a, config, assigned, _ := webhookFixture(t)
	webhookOperation(t, a, "task.update", assigned.Id, assigned.GetInt("revision"), map[string]any{"readiness": "waiting"}, "")
	rt, err := webhookRouting(a.app)
	if err != nil {
		t.Fatal(err)
	}
	webhookOperation(t, a, "webhook.routing.update", "", rt.GetInt("revision"), map[string]any{"triage_agent": config.GetString("agent")}, "")
	accepted := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Accepted triage work", "readiness": "ready"}, "")
	apiWebhookAccept(t, a)
	pending := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Pending triage work", "readiness": "ready"}, "")
	oldAccepted := apiWebhookDeliveries(t, a, accepted["id"].(string))[0]
	oldPending := apiWebhookDeliveries(t, a, pending["id"].(string))[0]
	if oldAccepted.GetString("state") != "accepted" {
		t.Fatal("fixture was not delivered")
	}
	rt, _ = webhookRouting(a.app)
	cleared := webhookOperation(t, a, "webhook.routing.update", "", rt.GetInt("revision"), map[string]any{"triage_agent": ""}, "")
	webhookOperation(t, a, "webhook.routing.update", "", int(cleared["revision"].(float64)), map[string]any{"triage_agent": config.GetString("agent")}, "")
	for _, old := range []*core.Record{oldAccepted, oldPending} {
		current := apiWebhookRecord(t, a, "tasks", old.GetString("task"))
		if current.GetInt("wake_generation") <= old.GetInt("generation") {
			t.Fatal("old triage generation survives route away and back")
		}
		if webhookEligible(a.app, old, config) {
			t.Fatal("old triage wake became eligible again")
		}
		if len(apiWebhookDeliveries(t, a, current.Id)) != 1 {
			t.Fatal("routing change replayed backlog")
		}
	}
	if apiWebhookRecord(t, a, "webhook_deliveries", oldPending.Id).GetString("state") != "cancelled" {
		t.Fatal("pending triage wake not cancelled")
	}
}

func TestWebhookAPIDisableInvalidatesAcceptedWorkWithoutReplay(t *testing.T) {
	a, config, task, old := webhookFixture(t)
	apiWebhookAccept(t, a)
	disabled := webhookOperation(t, a, "webhook.disable", config.Id, config.GetInt("revision"), map[string]any{}, "")
	enabled := webhookOperation(t, a, "webhook.enable", config.Id, int(disabled["revision"].(float64)), map[string]any{}, "")
	if enabled["destination_version"] != float64(config.GetInt("destination_version")) {
		t.Fatal("enable/disable changed destination identity")
	}
	config = apiWebhookRecord(t, a, "webhook_configs", config.Id)
	current := apiWebhookRecord(t, a, "tasks", task.Id)
	if current.GetInt("wake_generation") <= old.GetInt("generation") || webhookEligible(a.app, old, config) {
		t.Fatal("accepted event revived after disable/enable")
	}
	if len(apiWebhookDeliveries(t, a, task.Id)) != 1 {
		t.Fatal("enable automatically replayed backlog")
	}
}

func TestWebhookAPISaveDisabledAndCredentialRedaction(t *testing.T) {
	a := newTestApp(t)
	agent := webhookOperation(t, a, "agent.ensure", "", 0, map[string]any{"name": "Synthetic setup agent"}, "setup-agent")
	data := map[string]any{"agent": agent["id"], "url": "https://93.184.216.34/receiver", "adapter": "crew-v1", "subscriptions": []string{"created", "ready"}, "secret": "synthetic-private-credential"}
	config := webhookOperation(t, a, "webhook.create", "", 0, data, "setup-config")
	replay := webhookOperation(t, a, "webhook.create", "", 0, data, "setup-config")
	if config["id"] != replay["id"] || config["enabled"] != false || config["secret_configured"] != true {
		t.Fatal("setup isn't disabled and idempotent", config)
	}
	webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Assigned ready but disabled", "assigned_agent": agent["id"], "readiness": "ready"}, "")
	w := newWebhookDispatcher(a.app)
	calls := 0
	w.client = &http.Client{Transport: webhookRoundTrip(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 202, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	if err := w.tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Fatal("saving disabled configuration sent a request")
	}
	for _, collection := range []string{"webhook_configs", "events", "webhook_deliveries", "webhook_attempts"} {
		raw, _ := json.Marshal(map[string]any{"collection": collection})
		result := a.request(t, "POST", "/api/crew/read", a.token, string(raw), 200)
		body, _ := json.Marshal(result)
		if strings.Contains(string(body), "synthetic-private-credential") || strings.Contains(string(body), "secret_ciphertext") {
			t.Fatalf("%s exposed credentials", collection)
		}
	}
	stored := apiWebhookRecord(t, a, "webhook_configs", config["id"].(string))
	if stored.GetString("secret_ciphertext") == "" || strings.Contains(stored.GetString("secret_ciphertext"), "synthetic-private-credential") {
		t.Fatal("credential not encrypted")
	}
	idempotency, err := a.app.FindAllRecords("crew_webhook_idempotency")
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range idempotency {
		if strings.Contains(row.GetString("result"), "synthetic-private-credential") || strings.Contains(row.GetString("result"), "secret_ciphertext") {
			t.Fatal("idempotency result stores credential material")
		}
	}
}
