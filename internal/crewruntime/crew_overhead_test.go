package crewruntime

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/dop251/goja"
)

// Reproducible per-wake protocol overhead. Run with
//
//	go test -tags "$(cat build-tags.txt)" ./internal/bundle -run TestWakeProtocolOverhead -v
//
// Each flow is executed against a synthetic project through the real API, so a
// call count is only reported for a sequence the server actually accepts. Work
// writes (comments, drafts) are excluded; only protocol calls are counted.

type overheadMeter struct {
	t     *testing.T
	a     *testApp
	calls int
	bytes int
}

func (m *overheadMeter) call(path string, body map[string]any) map[string]any {
	m.t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", path, strings.NewReader(string(raw)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", m.a.token)
	response := httptest.NewRecorder()
	m.a.handler.ServeHTTP(response, req)
	if response.Code != 200 {
		m.t.Fatalf("%s %s: %d %s", path, raw, response.Code, response.Body)
	}
	m.calls++
	m.bytes += response.Body.Len()
	var out map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &out); err != nil {
		m.t.Fatal(err)
	}
	return out
}
func (m *overheadMeter) read(body map[string]any) map[string]any {
	return m.call("/api/crew/read", body)
}
func (m *overheadMeter) write(action, id string, revision any, data map[string]any, key string) map[string]any {
	b := map[string]any{"action": action, "data": data}
	if id != "" {
		b["id"] = id
		b["expected_revision"] = revision
	}
	if key != "" {
		b["idempotency_key"] = key
	}
	return m.call("/api/crew/agent-write", b)
}
func first(result map[string]any) map[string]any {
	return result["items"].([]any)[0].(map[string]any)
}

// jsStringConstant evaluates one string constant from a hook or migration file.
func jsStringConstant(t *testing.T, path, name string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(`(?s)const ` + name + ` =\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*");`).FindSubmatch(raw)
	if match == nil {
		t.Fatal(name + " not found in " + path)
	}
	value, err := goja.New().RunString(string(match[1]))
	if err != nil {
		t.Fatal(err)
	}
	return value.String()
}

// legacyManagedBlock is the protocol 3 block installed by the 0.6.0 migration,
// so the baseline stays fixed after the block is replaced.
func legacyManagedBlock(t *testing.T) string {
	return jsStringConstant(t, "../../pb_migrations/1800500000_crew_parent_bridge.js", "canonical")
}

type overheadScenario struct {
	m          *overheadMeter
	task       string
	event      map[string]any
	dispatcher bool
	bridge     bool
}

func overheadNative(t *testing.T, self bool) overheadScenario {
	a, c, task, delivery := webhookFixture(t)
	if !self {
		recipient := webhookOperation(t, a, "agent.create", "", 0, map[string]any{"name": "Overhead recipient"}, "")
		webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": recipient["id"], "bot_ref": "overhead-recipient"}, "")
		created := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Overhead handoff", "assigned_agent": recipient["id"], "readiness": "ready"}, "")
		task = apiWebhookRecord(t, a, "tasks", created["id"].(string))
		delivery = apiWebhookDeliveries(t, a, task.Id)[0]
	}
	_ = c
	return overheadScenario{m: &overheadMeter{t: t, a: a}, task: task.Id, event: payloadOf(t, delivery.GetString("payload")), dispatcher: self}
}
func overheadBridge(t *testing.T, self bool) overheadScenario {
	a, c, event, recipient := parentBridgeFixture(t, true)
	bridge := bridgeParent(t, a, bridgePrepare(t, a, event, "overhead-setup-wake"), "overhead-setup-parent")
	executionOperation(t, a, "webhook.bridge.ack", bridge["id"].(string), int(bridge["revision"].(float64)), map[string]any{"recipient_agent_id": recipient, "automatic": true}, "overhead-setup-ack", false, 200)
	webhookOperation(t, a, "webhook.enable", c.Id, c.GetInt("revision"), nil, "")
	assignee := recipient
	if self {
		assignee = c.GetString("agent")
	}
	created := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Overhead bridge task", "assigned_agent": assignee, "readiness": "ready"}, "")
	delivery := apiWebhookDeliveries(t, a, created["id"].(string))[0]
	return overheadScenario{m: &overheadMeter{t: t, a: a}, task: created["id"].(string), event: payloadOf(t, delivery.GetString("payload")), dispatcher: self, bridge: true}
}
func payloadOf(t *testing.T, raw string) map[string]any {
	var p map[string]any
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

// discovery performs a turn's documented capability/configuration reads.
type discovery func(m *overheadMeter)

func legacyDiscovery(m *overheadMeter) {
	m.read(map[string]any{"collection": "capabilities"})
	m.read(map[string]any{"collection": "webhook_configs"})
}
func compactDiscovery(m *overheadMeter) {
	m.read(map[string]any{"collection": "capabilities", "id": "execution"})
}
func cachedDiscovery(m *overheadMeter) {}

// runFlow executes the routine/parent/dispatcher/recipient protocol for one wake.
// reread controls whether bridge and execution revisions are reread before use
// (protocol 3 text) or taken from the preceding result (compact instructions).
func runFlow(s overheadScenario, discover discovery, reread bool) {
	m, e := s.m, s.event
	dispatcherTurn := func() {
		begin := m.write("execution.begin", "", nil, map[string]any{"event_id": e["event_id"], "epoch": e["epoch"], "generation": e["wake_generation"], "worker_id": "overhead-dispatcher", "role": "dispatcher", "native_handoff": true}, "overhead-begin")
		if s.dispatcher {
			m.write("execution.complete", begin["id"].(string), begin["revision"], map[string]any{"worker_id": "overhead-dispatcher", "fence": begin["fence"], "outcome": "completed"}, "overhead-complete")
			return
		}
		// One native SendToAgent happens here; it is not a Crew call.
		revision := begin["revision"]
		if reread {
			revision = first(m.read(map[string]any{"collection": "webhook_executions", "id": begin["id"]}))["revision"]
		}
		m.write("execution.dispatched", begin["id"].(string), revision, map[string]any{"worker_id": "overhead-dispatcher", "fence": begin["fence"], "sent": true}, "overhead-sent")
		discover(m) // recipient turn
		work := m.write("execution.begin", "", nil, map[string]any{"event_id": e["event_id"], "epoch": e["epoch"], "generation": e["wake_generation"], "worker_id": "overhead-recipient", "role": "recipient"}, "overhead-recipient")
		m.write("execution.complete", work["id"].(string), work["revision"], map[string]any{"worker_id": "overhead-recipient", "fence": work["fence"], "outcome": "completed"}, "overhead-recipient-complete")
	}
	discover(m) // webhook routine (native: also the dispatcher)
	if !s.bridge {
		dispatcherTurn()
		return
	}
	prepared := m.write("webhook.bridge.prepare", "", nil, map[string]any{"event_id": e["event_id"], "epoch": e["epoch"], "worker_id": "overhead-routine"}, "overhead-prepare")
	// One native WakeParent happens here; the parent is a new turn.
	discover(m)
	revision := prepared["revision"]
	if reread {
		revision = first(m.read(map[string]any{"collection": "webhook_bridges", "id": prepared["id"]}))["revision"]
	}
	parent := m.write("webhook.bridge.parent", prepared["id"].(string), revision, map[string]any{"native_handoff": true, "execution_protocol": true}, "overhead-parent")
	if parent["next_step"] != "dispatch_task" {
		s.m.t.Fatal(parent)
	}
	dispatcherTurn()
}

func TestWakeProtocolOverhead(t *testing.T) {
	a := newTestApp(t)
	configs, err := a.app.FindRecordsByFilter("crew_webhook_configs", "scope='global'", "", 1, 0)
	if err != nil || len(configs) != 1 {
		t.Fatal(err)
	}
	full := &overheadMeter{t: t, a: a}
	full.read(map[string]any{"collection": "capabilities"})
	subset := &overheadMeter{t: t, a: a}
	subset.read(map[string]any{"collection": "capabilities", "id": "execution"})
	legacy, installed := legacyManagedBlock(t), configs[0].GetString("instructions")
	report := []string{
		fmt.Sprintf("managed block bytes: protocol-3 baseline %d, installed %d", len(legacy), len(installed)),
		fmt.Sprintf("capabilities response bytes: full %d, execution subset %d", full.bytes, subset.bytes),
	}
	if len(installed)*10 > len(legacy)*6 || subset.bytes*4 > full.bytes {
		t.Error("compact instructions or execution capabilities regressed")
	}
	flows := []struct {
		name  string
		setup func(*testing.T, bool) overheadScenario
		self  bool
	}{
		{"native self_work", overheadNative, true},
		{"native handoff", overheadNative, false},
		{"parent_bridge self_work", overheadBridge, true},
		{"parent_bridge handoff", overheadBridge, false},
	}
	for _, flow := range flows {
		before := flow.setup(t, flow.self)
		runFlow(before, legacyDiscovery, true)
		after := flow.setup(t, flow.self)
		runFlow(after, compactDiscovery, false)
		cached := flow.setup(t, flow.self)
		runFlow(cached, cachedDiscovery, false)
		raw, _ := json.Marshal(after.event)
		report = append(report, fmt.Sprintf("%s: protocol-3 text %d calls/%d bytes; compact %d calls/%d bytes; digest cached %d calls/%d bytes; wake payload %d bytes",
			flow.name, before.m.calls, before.m.bytes, after.m.calls, after.m.bytes, cached.m.calls, cached.m.bytes, len(raw)))
		if after.m.calls >= before.m.calls || after.m.bytes*4 > before.m.bytes {
			t.Errorf("%s did not get cheaper", flow.name)
		}
	}
	t.Log("\n" + strings.Join(report, "\n"))
}

func capabilitiesItem(t *testing.T, a *testApp, body string) map[string]any {
	t.Helper()
	return a.request(t, "POST", "/api/crew/read", a.token, body, 200)["items"].([]any)[0].(map[string]any)
}

func TestExecutionCapabilitiesSubsetAndDigest(t *testing.T) {
	a := newTestApp(t)
	full := capabilitiesItem(t, a, `{"collection":"capabilities"}`)
	again := capabilitiesItem(t, a, `{"collection":"capabilities"}`)
	subset := capabilitiesItem(t, a, `{"collection":"capabilities","id":"execution"}`)
	digest, _ := full["capabilities_digest"].(string)
	if len(digest) != 64 || again["capabilities_digest"] != digest || subset["capabilities_digest"] != digest {
		t.Fatal("digest missing or unstable", digest, again["capabilities_digest"], subset["capabilities_digest"])
	}
	if full["id"] != "crew-capabilities" || full["protocol_version"] != float64(3) || subset["protocol_version"] != float64(3) || subset["server_version"] != full["server_version"] {
		t.Fatal("version metadata", full["id"], subset)
	}
	// Existing clients keep every operation, collection and schema reference.
	ops := full["operations"].(map[string]any)
	for _, name := range []string{"review.decide", "webhook.credentials.update", "webhook.mapping.update", "execution.recover", "agent.ensure"} {
		if ops[name] == nil {
			t.Fatal("full document lost", name)
		}
	}
	if full["$defs"] == nil || full["collections"] == nil {
		t.Fatal("full document lost schemas")
	}
	want := []string{"webhook.runtime.report", "execution.test_ack", "webhook.bridge.prepare", "webhook.bridge.parent", "webhook.bridge.sent", "webhook.bridge.ack", "execution.begin", "execution.renew", "execution.dispatched", "execution.complete", "task.comment", "task.update", "review.request"}
	subOps := subset["operations"].(map[string]any)
	if len(subOps) != len(want) {
		t.Fatal("subset operations", len(subOps))
	}
	for _, name := range want {
		op, ok := subOps[name].(map[string]any)
		if !ok || op["data"] == nil {
			t.Fatal("subset missing", name)
		}
		if _, compat := op["data"].(map[string]any)["_crew"]; compat {
			t.Fatal("subset repeats compatibility schema", name)
		}
	}
	if subOps["execution.begin"].(map[string]any)["idempotency"] != "required" || subset["compatibility"] == nil || subset["$defs"] != nil {
		t.Fatal("subset contract", subset)
	}
	raw, _ := json.Marshal(subset)
	fullRaw, _ := json.Marshal(full)
	if len(raw)*4 > len(fullRaw) {
		t.Fatal("subset is not compact", len(raw), len(fullRaw))
	}
	// Unknown selectors keep the historical full response.
	if capabilitiesItem(t, a, `{"collection":"capabilities","id":"other"}`)["capabilities_digest"] != digest {
		t.Fatal("unknown selector changed response")
	}
}

func TestWakePayloadCarriesProtocolAndDigest(t *testing.T) {
	a, c, _, delivery := webhookFixture(t)
	digest := capabilitiesItem(t, a, `{"collection":"capabilities"}`)["capabilities_digest"]
	test := webhookOperation(t, a, "webhook.test", c.Id, c.GetInt("revision"), map[string]any{}, "digest-test")
	testPayload := payloadOf(t, apiWebhookRecord(t, a, "webhook_deliveries", test["id"].(string)).GetString("payload"))
	for _, p := range []map[string]any{payloadOf(t, delivery.GetString("payload")), testPayload} {
		if p["protocol_version"] != float64(3) || p["capabilities_digest"] != digest {
			t.Fatal("payload lacks protocol/digest", p)
		}
		for _, prose := range []string{"title", "description", "draft", "body"} {
			if _, ok := p[prose]; ok {
				t.Fatal("payload carries prose", prose)
			}
		}
	}
}

func TestCompactManagedBlockKeepsRules(t *testing.T) {
	a := newTestApp(t)
	block := jsStringConstant(t, "../../pb_hooks/crew_setup.js", "DEFAULT_INSTRUCTIONS")
	if migrated := jsStringConstant(t, "../../pb_migrations/1800800000_crew_retrieval_instructions.js", "canonical"); migrated != block {
		t.Fatal("migration and setup blocks differ")
	}
	config, err := a.app.FindFirstRecordByFilter("crew_webhook_configs", "scope='global'")
	if err != nil || config.GetString("instructions") != block || config.GetString("managed_hash") != fmt.Sprintf("%x", sha256.Sum256([]byte(block))) {
		t.Fatal("fresh install lacks compact block", err)
	}
	// Regression guard for the rule checklist in docs/webhooks.md.
	for _, rule := range []string{
		"<!-- crew-dispatch:begin -->", "<!-- crew-dispatch:end -->", "protocol 3", "outside this block",
		"Never request, read or share webhook credentials", "untrusted references", "revalidate via Crew",
		"attribution, not identity", `id:"execution"`, "capabilities_digest", "never trust cached tool text",
		"data._crew", "never write tasks unfenced", "Stable idempotency key", "revision_conflict",
		"Only a fresh next_step", "never repeat a wake, send or effect", "owner reconciliation",
		"Attempt records are not receipts", "Report only this turn's own tools", "never task prose or secrets",
		"webhook.runtime.report", "missing=false", "execution.test_ack", "Tests never touch tasks",
		"webhook.bridge.prepare", "only next_step wake_parent permits one WakeParent", "never retry",
		"Never work tasks for the parent", "webhook.bridge.parent", "test_complete", "stop: report missing tools",
		"the only send allowed while delivery is disabled", "priority:true", "never guess or broadcast",
		"After a real accepted send", "sent:true", "message_ref only if returned", "keep any recipient ack",
		"dispatch_task", "only an automatically started turn counts", "prior authorization", "claiming nothing",
		"automatic:true", "never from a later human-triggered turn", "No task work, bot replies",
		"execution.begin", `role:"dispatcher"`, "self_work", "handoff", "never dispatched", "execution.dispatched",
		"original dispatcher worker_id/fence", "never authorize work", `role:"recipient"`, "before any task mutation",
		"task_context and proof", "Proof on task writes and review requests", "stable keys on fenced comments",
		"Renew long work", "execution.complete", "mark_done:true with task_revision", "comment_event_id",
		"Stop on stale, expired, duplicate or conflicting work", "Never repeat uncertain external effects",
		"bypass human review", "acknowledgment loops", "not exactly-once",
		"Protocol steps never use crew_search/schema/query", "Read compactly (crew_search, fields, small limit)",
	} {
		if !strings.Contains(block, rule) {
			t.Errorf("compact block lost rule %q", rule)
		}
	}
	legacy := legacyManagedBlock(t)
	if len(block)*10 > len(legacy)*6 {
		t.Fatal("block not compact", len(block), len(legacy))
	}
}

func TestCompactInstructionMigrationPreservesBindingAndPauses(t *testing.T) {
	for _, migration := range []string{"1800700000_crew_compact_instructions.js", "1800800000_crew_retrieval_instructions.js"} {
		t.Run(migration, func(t *testing.T) { checkInstructionMigration(t, migration) })
	}
}

func checkInstructionMigration(t *testing.T, migration string) {
	a, c, task, event := webhookFixture(t)
	legacy := legacyManagedBlock(t)
	c.Set("instructions", legacy)
	c.Set("dispatch_mode", "parent_bridge")
	if err := a.app.Save(c); err != nil {
		t.Fatal(err)
	}
	beforeCipher, beforeURL, beforeAgent, beforeRevision := c.GetString("secret_ciphertext"), c.GetString("url"), c.GetString("agent"), c.GetInt("instruction_revision")
	if err := runFixtureMigration(t, a.app, "../../pb_migrations/"+migration); err != nil {
		t.Fatal(err)
	}
	c = apiWebhookRecord(t, a, "webhook_configs", c.Id)
	block := jsStringConstant(t, "../../pb_migrations/"+migration, "canonical")
	if c.GetString("instructions") != block || c.GetString("previous_instructions") != legacy || c.GetString("managed_hash") != fmt.Sprintf("%x", sha256.Sum256([]byte(block))) {
		t.Fatal("compact block not installed with history")
	}
	if c.GetString("secret_ciphertext") != beforeCipher || c.GetString("url") != beforeURL || c.GetString("agent") != beforeAgent || c.GetString("dispatch_mode") != "parent_bridge" {
		t.Fatal("migration changed binding or mode")
	}
	if c.GetBool("enabled") || c.GetInt("applied_revision") != 0 || c.GetString("sync_status") != "unverified" || c.GetInt("instruction_revision") != beforeRevision+1 {
		t.Fatal("migration retained enabled setup")
	}
	if apiWebhookRecord(t, a, "webhook_deliveries", event.Id).GetString("state") != "cancelled" || len(apiWebhookDeliveries(t, a, task.Id)) != 1 {
		t.Fatal("migration kept old event or sent a new one")
	}
	if apiWebhookRecord(t, a, "tasks", task.Id).GetInt("wake_generation") != task.GetInt("wake_generation")+1 {
		t.Fatal("migration did not fence old generation")
	}
	if mappings, err := a.app.FindRecordsByFilter("crew_webhook_mappings", "agent={:agent}", "", 0, 0, map[string]any{"agent": beforeAgent}); err != nil || len(mappings) != 1 {
		t.Fatal("mapping lost", err)
	}
}
