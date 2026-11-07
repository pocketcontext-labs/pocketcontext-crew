package bundle

import (
	"crypto/sha256"
	"fmt"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"testing"
	"time"
)

func parentBridgeFixture(t *testing.T, cross bool) (*testApp, *core.Record, map[string]any, string) {
	t.Helper()
	a, c, _, _ := webhookFixture(t)
	c.Set("dispatch_mode", "parent_bridge")
	c.Set("enabled", false)
	if err := a.app.Save(c); err != nil {
		t.Fatal(err)
	}
	recipient := c.GetString("agent")
	if cross {
		agent := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Bridge recipient"}, "")
		recipient = agent["id"].(string)
		webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": recipient, "bot_ref": "synthetic-recipient"}, "")
	}
	event := webhookOperation(t, a, "webhook.test", c.Id, c.GetInt("revision"), map[string]any{"recipient_agent_id": recipient}, "bridge-test")
	c = apiWebhookRecord(t, a, "webhook_configs", c.Id)
	webhookOperation(t, a, "webhook.runtime.report", c.Id, c.GetInt("revision"), map[string]any{"event_id": event["event_id"], "context": "webhook", "native_handoff": false, "parent_wake": true, "execution_protocol": true}, "")
	executionOperation(t, a, "execution.test_ack", "", 0, map[string]any{"event_id": event["event_id"], "epoch": event["epoch"]}, "bridge-test-ack", false, 200)
	return a, apiWebhookRecord(t, a, "webhook_configs", c.Id), event, recipient
}
func bridgePrepare(t *testing.T, a *testApp, event map[string]any, key string) map[string]any {
	return executionOperation(t, a, "webhook.bridge.prepare", "", 0, map[string]any{"event_id": event["event_id"], "epoch": event["epoch"], "worker_id": "routine-one"}, key, false, 200)
}
func bridgeParent(t *testing.T, a *testApp, r map[string]any, key string) map[string]any {
	return executionOperation(t, a, "webhook.bridge.parent", r["id"].(string), int(r["revision"].(float64)), map[string]any{"native_handoff": true, "execution_protocol": true}, key, false, 200)
}
func TestParentBridgeRequiresCorrelatedAutomaticRecipient(t *testing.T) {
	a, c, event, recipient := parentBridgeFixture(t, true)
	executionOperation(t, a, "webhook.enable", c.Id, c.GetInt("revision"), nil, "early-enable", false, 400)
	r := bridgePrepare(t, a, event, "wake-one")
	if r["next_step"] != "wake_parent" {
		t.Fatal(r)
	}
	for _, key := range []string{"wake-one", "wake-other-key"} {
		if replay := bridgePrepare(t, a, event, key); replay["next_step"] != "reconcile" {
			t.Fatal("wake replay granted authority", replay)
		}
	}
	before := r
	r = bridgeParent(t, a, r, "parent-one")
	if r["next_step"] != "send_test" {
		t.Fatal(r)
	}
	if replay := bridgeParent(t, a, before, "parent-one"); replay["next_step"] != "reconcile" {
		t.Fatal("send replay granted authority", replay)
	}
	if replay := bridgeParent(t, a, r, "parent-other-key"); replay["next_step"] != "reconcile" {
		t.Fatal("new key granted duplicate send", replay)
	}
	executionOperation(t, a, "webhook.enable", c.Id, c.GetInt("revision"), nil, "before-recipient", false, 400)
	executionOperation(t, a, "webhook.bridge.ack", r["id"].(string), int(r["revision"].(float64)), map[string]any{"recipient_agent_id": recipient, "automatic": false}, "human-ack", false, 400)
	executionOperation(t, a, "webhook.bridge.ack", r["id"].(string), int(r["revision"].(float64)), map[string]any{"recipient_agent_id": c.GetString("agent"), "automatic": true}, "wrong-ack", false, 409)
	// Recipient may acknowledge before the parent can record the send result.
	r = executionOperation(t, a, "webhook.bridge.ack", r["id"].(string), int(r["revision"].(float64)), map[string]any{"recipient_agent_id": recipient, "automatic": true}, "recipient-ack", false, 200)
	r = executionOperation(t, a, "webhook.bridge.sent", r["id"].(string), int(r["revision"].(float64)), map[string]any{"sent": true, "message_ref": "synthetic-send"}, "late-send", false, 200)
	if r["state"] != "recipient_received" || r["recipient_received_at"] == "" {
		t.Fatal("late send erased recipient", r)
	}
	executionOperation(t, a, "webhook.enable", c.Id, c.GetInt("revision"), nil, "enable", false, 200)
	// New connection test immediately makes the previous successful proof stale.
	c = apiWebhookRecord(t, a, "webhook_configs", c.Id)
	webhookOperation(t, a, "webhook.test", c.Id, c.GetInt("revision"), map[string]any{"recipient_agent_id": recipient}, "new-test")
	c = apiWebhookRecord(t, a, "webhook_configs", c.Id)
	got := a.request(t, "POST", "/api/crew/read", a.token, `{"collection":"webhook_configs"}`, 200)
	cfg := got["items"].([]any)[0].(map[string]any)
	if cfg["setup"].(map[string]any)["can_enable"] != false {
		t.Fatal("old test enabled new setup", cfg)
	}
	executionOperation(t, a, "webhook.bridge.ack", r["id"].(string), int(r["revision"].(float64)), map[string]any{"recipient_agent_id": recipient, "automatic": true}, "stale-ack", false, 409)
}
func TestParentBridgeSelfTestAndExpiredWake(t *testing.T) {
	a, c, event, _ := parentBridgeFixture(t, false)
	r := bridgePrepare(t, a, event, "self-wake")
	r = bridgeParent(t, a, r, "self-parent")
	if r["next_step"] != "test_complete" {
		t.Fatal(r)
	}
	executionOperation(t, a, "webhook.enable", c.Id, c.GetInt("revision"), nil, "self-enable", false, 200)
	c = apiWebhookRecord(t, a, "webhook_configs", c.Id)
	event = webhookOperation(t, a, "webhook.test", c.Id, c.GetInt("revision"), nil, "expire-test")
	r = bridgePrepare(t, a, event, "expire-wake")
	stored := apiWebhookRecord(t, a, "webhook_bridges", r["id"].(string))
	stored.Set("deadline_at", time.Now().Add(-time.Second).UTC().Format(time.RFC3339))
	a.app.Save(stored)
	executionOperation(t, a, "webhook.bridge.parent", stored.Id, stored.GetInt("revision"), map[string]any{"native_handoff": true, "execution_protocol": true}, "expired-parent", false, 409)
	stored.Set("deadline_at", "not-a-date")
	a.app.Save(stored)
	executionOperation(t, a, "webhook.bridge.parent", stored.Id, stored.GetInt("revision"), map[string]any{"native_handoff": true, "execution_protocol": true}, "invalid-deadline", false, 409)
}
func TestParentBridgeTaskRequiresParentAndPreservesExecutionFence(t *testing.T) {
	for _, cross := range []bool{false, true} {
		t.Run(map[bool]string{false: "self", true: "cross"}[cross], func(t *testing.T) {
			a, c, event, recipient := parentBridgeFixture(t, cross)
			r := bridgeParent(t, a, bridgePrepare(t, a, event, "wake"), "parent")
			if cross {
				r = executionOperation(t, a, "webhook.bridge.ack", r["id"].(string), int(r["revision"].(float64)), map[string]any{"recipient_agent_id": recipient, "automatic": true}, "ack", false, 200)
			}
			webhookOperation(t, a, "webhook.enable", c.Id, c.GetInt("revision"), nil, "")
			task := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Synthetic bridge task", "assigned_agent": recipient, "readiness": "ready"}, "")
			ds := apiWebhookDeliveries(t, a, task["id"].(string))
			if len(ds) != 1 {
				t.Fatal(ds)
			}
			d := ds[0]
			data := map[string]any{"event_id": d.GetString("event_id"), "epoch": d.GetString("epoch"), "generation": d.GetInt("generation"), "worker_id": "parent-worker", "role": "dispatcher", "native_handoff": true}
			executionOperation(t, a, "execution.begin", "", 0, data, "before-parent", false, 409)
			if !cross {
				legacy := map[string]any{"event_id": d.GetString("event_id"), "epoch": d.GetString("epoch"), "generation": d.GetInt("generation"), "worker_id": "legacy-worker", "phase": "work"}
				executionOperation(t, a, "execution.acquire", "", 0, legacy, "legacy-before-parent", false, 409)
			}
			ev := map[string]any{"event_id": d.GetString("event_id"), "epoch": d.GetString("epoch")}
			r = bridgeParent(t, a, bridgePrepare(t, a, ev, "task-wake"), "task-parent")
			if r["next_step"] != "dispatch_task" {
				t.Fatal(r)
			}
			run := executionOperation(t, a, "execution.begin", "", 0, data, "begin", false, 200)
			want := "self_work"
			if cross {
				want = "handoff"
			}
			if run["next_step"] != want {
				t.Fatal(run)
			}
			if replay := executionOperation(t, a, "execution.begin", "", 0, data, "begin", false, 200); replay["next_step"] != "reconcile" {
				t.Fatal(replay)
			}
		})
	}
}

func TestParentBridgeMigrationPreservesBindingAndPauses(t *testing.T) {
	a, c, task, event := webhookFixture(t)
	beforeInstructions, beforeCipher, beforeURL := c.GetString("instructions"), c.GetString("secret_ciphertext"), c.GetString("url")
	canonicalHash := fmt.Sprintf("%x", sha256.Sum256([]byte(beforeInstructions)))
	// Rehearse the upgrade on a pre-bridge collection layout.
	bridges, err := a.app.FindCollectionByNameOrId("crew_webhook_bridges")
	if err != nil {
		t.Fatal(err)
	}
	if err = a.app.Delete(bridges); err != nil {
		t.Fatal(err)
	}
	c.Set("instructions", "historical instructions")
	a.app.Save(c)
	if err = runFixtureMigration(t, a.app, "../../pb_migrations/1800500000_crew_parent_bridge.js"); err != nil {
		t.Fatal(err)
	}
	c = apiWebhookRecord(t, a, "webhook_configs", c.Id)
	if c.GetString("instructions") != beforeInstructions || c.GetString("managed_hash") != canonicalHash {
		t.Fatal("migration canonical differs")
	}
	if c.GetString("previous_instructions") != "historical instructions" || c.GetString("secret_ciphertext") != beforeCipher || c.GetString("url") != beforeURL || c.GetBool("enabled") || c.GetInt("applied_revision") != 0 {
		t.Fatal("migration changed binding or retained enabled setup")
	}
	if apiWebhookRecord(t, a, "webhook_deliveries", event.Id).GetString("state") != "cancelled" || len(apiWebhookDeliveries(t, a, task.Id)) != 1 {
		t.Fatal("migration retained old pending event or created a new one")
	}
	if apiWebhookRecord(t, a, "tasks", task.Id).GetInt("wake_generation") != task.GetInt("wake_generation")+1 {
		t.Fatal("migration did not fence old generation")
	}
}

func TestParentBridgeMappingChangeAndExpiredRecipient(t *testing.T) {
	a, c, event, recipient := parentBridgeFixture(t, true)
	r := bridgeParent(t, a, bridgePrepare(t, a, event, "wake"), "parent")
	stored := apiWebhookRecord(t, a, "webhook_bridges", r["id"].(string))
	stored.Set("deadline_at", time.Now().Add(-time.Second).UTC().Format(time.RFC3339))
	a.app.Save(stored)
	executionOperation(t, a, "webhook.bridge.ack", stored.Id, stored.GetInt("revision"), map[string]any{"recipient_agent_id": recipient, "automatic": true}, "late-ack", false, 409)
	mappings, err := a.app.FindRecordsByFilter("crew_webhook_mappings", "agent={:agent}", "", 0, 0, map[string]any{"agent": recipient})
	if err != nil || len(mappings) != 1 {
		t.Fatal(err)
	}
	m := mappings[0]
	webhookOperation(t, a, "webhook.mapping.update", m.Id, m.GetInt("revision"), map[string]any{"agent": recipient, "bot_ref": "changed-recipient"}, "")
	executionOperation(t, a, "webhook.bridge.sent", stored.Id, stored.GetInt("revision"), map[string]any{"sent": true}, "stale-send", false, 409)
	executionOperation(t, a, "webhook.enable", c.Id, c.GetInt("revision"), nil, "stale-enable", false, 400)
	// A new event can use the new mapping, but old attempt records never authorize a retry.
	replay := bridgePrepare(t, a, event, "wake")
	if replay["next_step"] != "reconcile" {
		t.Fatal(replay)
	}
}
