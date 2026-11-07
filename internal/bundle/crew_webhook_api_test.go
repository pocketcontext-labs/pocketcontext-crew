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
			updated := webhookOperation(t, a, "webhook.integration.update", config.Id, config.GetInt("revision"), map[string]any{"subscriptions": subs}, "")
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
	configs, err := a.app.FindRecordsByFilter("crew_webhook_configs", "scope='global'", "", 1, 0)
	if err != nil || len(configs) != 1 {
		t.Fatal("missing global integration", err)
	}
	selected := webhookOperation(t, a, "webhook.integration.update", configs[0].Id, configs[0].GetInt("revision"), map[string]any{"agent": agent["id"]}, "")
	data := map[string]any{"url": "https://93.184.216.34/receiver", "secret": "synthetic-private-credential"}
	config := webhookOperation(t, a, "webhook.credentials.update", configs[0].Id, int(selected["revision"].(float64)), data, "setup-config")
	replay := webhookOperation(t, a, "webhook.credentials.update", configs[0].Id, int(selected["revision"].(float64)), data, "setup-config")
	if config["id"] != replay["id"] || config["enabled"] != false || config["secret_configured"] != true || config["url"] != nil {
		t.Fatal("setup isn't disabled, redacted and idempotent", config)
	}
	rawDenied, _ := json.Marshal(map[string]any{"action": "webhook.credentials.update", "id": configs[0].Id, "expected_revision": selected["revision"], "data": data, "idempotency_key": "setup-config"})
	a.request(t, "POST", "/api/crew/agent-write", a.token, string(rawDenied), 403)
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

func TestWebhookGlobalRecipientAndMappingInvalidation(t *testing.T) {
	a, config, _, _ := webhookFixture(t)
	recipient := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Other specialist"}, "")
	mapping := webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": recipient["id"], "bot_ref": "other-grok-bot"}, "")
	same := webhookOperation(t, a, "webhook.mapping.update", mapping["id"].(string), int(mapping["revision"].(float64)), map[string]any{"agent": recipient["id"], "bot_ref": "other-grok-bot"}, "")
	if same["revision"] != mapping["revision"] {
		t.Fatal("no-op mapping update invalidates delivery revision")
	}
	task := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Different recipient", "assigned_agent": recipient["id"], "readiness": "ready"}, "")
	ds := apiWebhookDeliveries(t, a, task["id"].(string))
	if len(ds) != 1 {
		t.Fatal("missing global delivery", len(ds))
	}
	d := ds[0]
	if d.GetString("config") != config.Id || d.GetString("agent") != recipient["id"] {
		t.Fatal("wrong routing", d.PublicExport())
	}
	var payload map[string]any
	json.Unmarshal([]byte(d.GetString("payload")), &payload)
	if payload["dispatcher_agent_id"] != config.GetString("agent") || payload["recipient_agent_id"] != recipient["id"] || payload["recipient_bot_ref"] != "other-grok-bot" {
		t.Fatal(payload)
	}
	apiWebhookAccept(t, a)
	webhookOperation(t, a, "webhook.mapping.update", mapping["id"].(string), int(mapping["revision"].(float64)), map[string]any{"agent": recipient["id"], "bot_ref": "new-grok-bot"}, "")
	fresh := apiWebhookRecord(t, a, "tasks", task["id"].(string))
	if fresh.GetInt("wake_generation") <= d.GetInt("generation") || webhookEligible(a.app, d, config) {
		t.Fatal("old recipient mapping revived")
	}
	if len(apiWebhookDeliveries(t, a, fresh.Id)) != 1 {
		t.Fatal("mapping change replayed work")
	}
	dispatcherMapping, err := a.app.FindFirstRecordByFilter("crew_webhook_mappings", "agent={:agent}", dbx.Params{"agent": config.GetString("agent")})
	if err != nil {
		t.Fatal(err)
	}
	webhookOperation(t, a, "webhook.mapping.update", dispatcherMapping.Id, dispatcherMapping.GetInt("revision"), map[string]any{"agent": config.GetString("agent"), "bot_ref": "replacement-dispatcher"}, "")
	freshConfig := apiWebhookRecord(t, a, "webhook_configs", config.Id)
	if freshConfig.GetBool("enabled") || freshConfig.GetString("url") != "" || freshConfig.GetString("secret_ciphertext") != "" || freshConfig.GetString("sync_status") != "unverified" {
		t.Fatal("changed dispatcher retained old receiver")
	}
}

func TestWebhookGlobalMigrationPreservesLegacyHistoryWithoutDelivery(t *testing.T) {
	a, config, task, delivery := webhookFixture(t)
	// Reconstruct a legacy receiver on synthetic data and apply the real upgrade.
	config.Set("scope", "")
	if err := a.app.Save(config); err != nil {
		t.Fatal(err)
	}
	mappings, err := a.app.FindCollectionByNameOrId("crew_webhook_mappings")
	if err != nil {
		t.Fatal(err)
	}
	if err = a.app.Delete(mappings); err != nil {
		t.Fatal(err)
	}
	if err = runFixtureMigration(t, a.app, "../../pb_migrations/1800300000_crew_global_webhook.js"); err != nil {
		t.Fatal(err)
	}
	old := apiWebhookRecord(t, a, "webhook_configs", config.Id)
	if old.GetString("scope") != "legacy" || old.GetBool("enabled") || old.GetString("secret_ciphertext") == "" {
		t.Fatal("legacy config not preserved disabled")
	}
	prior := apiWebhookRecord(t, a, "webhook_deliveries", delivery.Id)
	if prior.GetString("state") != "cancelled" || prior.GetString("payload") != delivery.GetString("payload") {
		t.Fatal("delivery history lost or still pending")
	}
	fresh := apiWebhookRecord(t, a, "tasks", task.Id)
	if fresh.GetInt("wake_generation") <= task.GetInt("wake_generation") {
		t.Fatal("accepted generations not invalidated")
	}
	globals, err := a.app.FindRecordsByFilter("crew_webhook_configs", "scope='global'", "", 0, 0)
	if err != nil || len(globals) != 1 {
		t.Fatal("global singleton", err)
	}
	if globals[0].GetBool("enabled") || globals[0].GetString("url") != "" || globals[0].GetString("secret_ciphertext") != "" {
		t.Fatal("upgrade silently selected old credentials")
	}
	calls := 0
	w := newWebhookDispatcher(a.app)
	w.client = &http.Client{Transport: webhookRoundTrip(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	if err = w.tick(context.Background()); err != nil || calls != 0 {
		t.Fatal("upgrade sent work", calls, err)
	}
}

func TestWebhookHistoricalIdempotencyReplayRedactsLegacyURL(t *testing.T) {
	a, config, _, _ := webhookFixture(t)
	data := map[string]any{}
	original := webhookOperation(t, a, "webhook.disable", config.Id, config.GetInt("revision"), data, "legacy-disable-replay")
	row, err := a.app.FindFirstRecordByFilter("crew_webhook_idempotency", "operation='webhook.disable' && key='legacy-disable-replay'")
	if err != nil {
		t.Fatal(err)
	}
	// Model a pre-0.4 idempotency result without altering its stored fingerprint.
	original["url"] = "https://example.com/confidential-routine-path"
	original["secret_ciphertext"] = "legacy-private-ciphertext"
	row.Set("result", original)
	if err = a.app.Save(row); err != nil {
		t.Fatal(err)
	}
	replay := webhookOperation(t, a, "webhook.disable", config.Id, config.GetInt("revision"), data, "legacy-disable-replay")
	body, _ := json.Marshal(replay)
	if strings.Contains(string(body), "confidential-routine-path") || strings.Contains(string(body), "legacy-private-ciphertext") || replay["url"] != nil {
		t.Fatal("legacy replay exposed receiver", string(body))
	}
}

func TestWebhookAPIManagedBlockAndStructuredConflicts(t *testing.T) {
	a, c, _, _ := webhookFixture(t)
	block := c.GetString("instructions")
	data := map[string]any{"instruction_revision": c.GetInt("instruction_revision"), "routine_ref": "routine", "status": "verified", "instructions": "Keep my normal role.\n" + block + "\nAlways report in the routine UI."}
	result := webhookOperation(t, a, "webhook.instructions.sync", c.Id, c.GetInt("revision"), data, "")
	if result["applied_hash"] != c.GetString("managed_hash") || result["sync_status"] != "verified" {
		t.Fatal(result)
	}
	data["instructions"] = strings.Replace(block, "Never request", "Always request", 1)
	response := executionOperation(t, a, "webhook.instructions.sync", c.Id, int(result["revision"].(float64)), data, "", false, 409)
	reason := response["data"].(map[string]any)["reason"].(map[string]any)
	if reason["code"] != "instructions_mismatch" {
		t.Fatal(response)
	}
	response = executionOperation(t, a, "webhook.instructions.sync", c.Id, c.GetInt("revision"), data, "", false, 409)
	reason = response["data"].(map[string]any)["reason"].(map[string]any)
	if reason["code"] != "revision_conflict" {
		t.Fatal(response)
	}
}

func TestWebhookAPISetupRequiresCurrentWebhookRuntime(t *testing.T) {
	a, c, _, _ := webhookFixture(t)
	// A new destination makes the existing acknowledgment and runtime report stale.
	result := webhookOperation(t, a, "webhook.credentials.update", c.Id, c.GetInt("revision"), map[string]any{"url": "https://93.184.216.34/new-receiver", "secret": "new-synthetic-key"}, "")
	state := result["setup"].(map[string]any)
	if state["can_test"] != true || state["can_enable"] != false {
		t.Fatal(state)
	}
	event := webhookOperation(t, a, "webhook.test", c.Id, int(result["revision"].(float64)), map[string]any{}, "new-test")
	report := map[string]any{"event_id": event["event_id"], "context": "parent", "native_handoff": true, "execution_protocol": true}
	executionOperation(t, a, "webhook.runtime.report", c.Id, int(result["revision"].(float64)), report, "", false, 400)
	report["context"] = "webhook"
	report["native_handoff"] = false
	result = webhookOperation(t, a, "webhook.runtime.report", c.Id, int(result["revision"].(float64)), report, "")
	executionOperation(t, a, "execution.test_ack", "", 0, map[string]any{"event_id": event["event_id"], "epoch": event["epoch"]}, "new-test-ack", false, 200)
	executionOperation(t, a, "webhook.enable", c.Id, int(result["revision"].(float64)), map[string]any{}, "", false, 400)
	report["native_handoff"] = true
	result = webhookOperation(t, a, "webhook.runtime.report", c.Id, int(result["revision"].(float64)), report, "")
	if result["setup"].(map[string]any)["can_enable"] != true {
		t.Fatal(result)
	}
}

func TestWebhookManagedMigrationPreservesCredentialsAndHistory(t *testing.T) {
	a, c, task, event := webhookFixture(t)
	canonical, canonicalHash := c.GetString("instructions"), c.GetString("managed_hash")
	beforeCipher, beforeURL, beforeAgent := c.GetString("secret_ciphertext"), c.GetString("url"), c.GetString("agent")
	c.Set("instructions", "legacy custom instructions")
	if err := a.app.Save(c); err != nil {
		t.Fatal(err)
	}
	if err := runFixtureMigration(t, a.app, "../../pb_migrations/1800400000_crew_managed_setup.js"); err != nil {
		t.Fatal(err)
	}
	updated := apiWebhookRecord(t, a, "webhook_configs", c.Id)
	if updated.GetString("secret_ciphertext") != beforeCipher || updated.GetString("url") != beforeURL || updated.GetString("agent") != beforeAgent || updated.GetBool("enabled") || updated.GetString("previous_instructions") != "legacy custom instructions" {
		t.Fatal("migration lost configuration")
	}
	if apiWebhookRecord(t, a, "webhook_deliveries", event.Id).GetString("state") != "cancelled" {
		t.Fatal("queued old event remains active")
	}
	if len(apiWebhookDeliveries(t, a, task.Id)) != 1 {
		t.Fatal("migration emitted new wake")
	}
	if updated.GetString("instructions") != canonical || updated.GetString("managed_hash") != canonicalHash {
		t.Fatal("migration differs from canonical managed protocol")
	}
	mappings, err := a.app.FindRecordsByFilter("crew_webhook_mappings", "agent={:agent}", "", 0, 0, dbx.Params{"agent": beforeAgent})
	if err != nil || len(mappings) != 1 {
		t.Fatal("mapping lost", err)
	}
}
