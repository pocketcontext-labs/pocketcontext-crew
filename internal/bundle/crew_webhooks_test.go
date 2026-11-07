package bundle

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

type webhookRoundTrip func(*http.Request) (*http.Response, error)

func (f webhookRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func webhookOperation(t *testing.T, a *testApp, action, id string, revision int, data map[string]any, key string) map[string]any {
	t.Helper()
	b := map[string]any{"action": action, "data": data, "reported_agent": "synthetic-bot"}
	if id != "" {
		b["id"] = id
	}
	if revision > 0 || action == "webhook.mapping.update" {
		b["expected_revision"] = revision
	}
	if key != "" {
		b["idempotency_key"] = key
	}
	raw, _ := json.Marshal(b)
	route := "/api/crew/agent-write"
	// Lifecycle tests change eligibility as the owner; agent fencing has dedicated tests.
	if action == "webhook.credentials.update" || action == "task.update" || action == "task.comment" {
		route = "/api/crew/write"
	}
	return a.request(t, "POST", route, a.token, string(raw), 200)
}
func webhookFixture(t *testing.T) (*testApp, *core.Record, *core.Record, *core.Record) {
	t.Helper()
	a := newTestApp(t)
	agent := webhookOperation(t, a, "agent.ensure", "", 0, map[string]any{"name": "Synthetic webhook agent"}, "ensure")
	configs, err := a.app.FindRecordsByFilter("crew_webhook_configs", "scope='global'", "", 1, 0)
	if err != nil || len(configs) != 1 {
		t.Fatal("global config missing", err)
	}
	global := configs[0]
	c := webhookOperation(t, a, "webhook.integration.update", global.Id, global.GetInt("revision"), map[string]any{"agent": agent["id"]}, "")
	webhookOperation(t, a, "webhook.mapping.update", "", 0, map[string]any{"agent": agent["id"], "bot_ref": "synthetic-bot"}, "")
	global, _ = a.app.FindRecordById("crew_webhook_configs", global.Id)
	c["revision"] = float64(global.GetInt("revision"))
	c = webhookOperation(t, a, "webhook.credentials.update", global.Id, int(c["revision"].(float64)), map[string]any{"url": "https://93.184.216.34/receiver", "secret": "synthetic-bearer"}, "")
	c = webhookOperation(t, a, "webhook.instructions.sync", global.Id, int(c["revision"].(float64)), map[string]any{"instruction_revision": c["instruction_revision"], "routine_ref": "synthetic-routine", "status": "reported"}, "")
	test := webhookOperation(t, a, "webhook.test", global.Id, int(c["revision"].(float64)), map[string]any{}, "fixture-test")
	global, _ = a.app.FindRecordById("crew_webhook_configs", global.Id)
	c = webhookOperation(t, a, "webhook.runtime.report", global.Id, global.GetInt("revision"), map[string]any{"event_id": test["event_id"], "context": "webhook", "native_handoff": true, "execution_protocol": true}, "fixture-runtime")
	webhookOperation(t, a, "execution.test_ack", "", 0, map[string]any{"event_id": test["event_id"], "epoch": test["epoch"]}, "fixture-ack")
	testDelivery, _ := a.app.FindRecordById("crew_webhook_deliveries", test["id"].(string))
	testDelivery.Set("state", "accepted")
	if err := a.app.Save(testDelivery); err != nil {
		t.Fatal(err)
	}
	c = webhookOperation(t, a, "webhook.enable", global.Id, int(c["revision"].(float64)), map[string]any{}, "")
	task := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Synthetic actionable task", "assigned_agent": agent["id"], "readiness": "ready"}, "")
	config, e := a.app.FindRecordById("crew_webhook_configs", c["id"].(string))
	if e != nil {
		t.Fatal(e)
	}
	tr, e := a.app.FindRecordById("crew_tasks", task["id"].(string))
	if e != nil {
		t.Fatal(e)
	}
	delivery, e := a.app.FindFirstRecordByFilter("crew_webhook_deliveries", "task={:task}", map[string]any{"task": tr.Id})
	if e != nil {
		t.Fatal(e)
	}
	return a, config, tr, delivery
}

func TestWebhookDestinationSecurity(t *testing.T) {
	for _, s := range []string{"127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.100.100.200", "0.0.0.0", "224.0.0.1", "240.1.1.1", "192.0.2.1", "198.18.1.1", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1", "64:ff9b::a00:1", "2002:7f00:1::"} {
		if webhookPublicIP(netip.MustParseAddr(s)) {
			t.Errorf("accepted private/reserved %s", s)
		}
	}
	for _, s := range []string{"93.184.216.34", "2606:4700:4700::1111"} {
		if !webhookPublicIP(netip.MustParseAddr(s)) {
			t.Errorf("refused public %s", s)
		}
	}
	for _, s := range []string{"http://example.com", "https://u:p@example.com", "https://example.com/#x", "https://example.com/?key=secret", "https://127.0.0.1", "https://[::ffff:127.0.0.1]"} {
		if webhookValidateEndpoint(s) == nil {
			t.Errorf("accepted unsafe endpoint %s", s)
		}
	}
	client := webhookHTTPClient()
	if client.Transport.(*http.Transport).Proxy != nil {
		t.Fatal("proxy can bypass destination checks")
	}
	if _, err := client.Get("https://127.0.0.1:1"); err == nil {
		t.Fatal("transport allowed private destination")
	}
	calls := 0
	client.Transport = webhookRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://127.0.0.1"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})
	response, err := client.Get("https://example.com")
	if err != nil || response.StatusCode != 302 || calls != 1 {
		t.Fatal("redirect followed", err, calls)
	}
}

func TestWebhookCredentialEncryptionAndMissingKey(t *testing.T) {
	a := newTestApp(t)
	one, err := webhookSeal(a.app, "synthetic-secret")
	if err != nil {
		t.Fatal(err)
	}
	two, err := webhookSeal(a.app, "synthetic-secret")
	if err != nil || one == two || strings.Contains(one, "synthetic-secret") {
		t.Fatal("encryption does not use fresh nonce")
	}
	plain, err := webhookUnseal(a.app, one)
	if err != nil || plain != "synthetic-secret" {
		t.Fatal("credential round trip", err)
	}
	if _, err = webhookUnseal(a.app, one+"x"); err == nil {
		t.Fatal("tamper accepted")
	}
	col, _ := a.app.FindCollectionByNameOrId("crew_webhook_configs")
	c := core.NewRecord(col)
	c.Set("agent", "synthetic-agent")
	c.Set("secret_ciphertext", one)
	c.Set("revision", 1)
	if err = a.app.Save(c); err != nil {
		t.Fatal(err)
	}
	path := a.app.Store().Get(webhookKeyStore).(string)
	if err = os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err = webhookSeal(a.app, "replacement"); err == nil {
		t.Fatal("silently replaced missing key")
	}
	if _, err = webhookFingerprint(a.app, "input"); err == nil {
		t.Fatal("silently replaced idempotency key")
	}
}

func TestWebhookDispatcherAcceptanceAndNoReplay(t *testing.T) {
	a, _, task, d := webhookFixture(t)
	w := newWebhookDispatcher(a.app)
	calls := 0
	w.client = &http.Client{Transport: webhookRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Header.Get("Authorization") != "Bearer synthetic-bearer" {
			t.Error("wrong receiver auth")
		}
		var p map[string]any
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			t.Fatal(err)
		}
		if p["event_id"] != d.GetString("event_id") || p["epoch"] == "" {
			t.Error("missing event identity")
		}
		return &http.Response{StatusCode: 202, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	if err := w.tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := w.tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	result, _ := a.app.FindRecordById("crew_webhook_deliveries", d.Id)
	if calls != 1 || result.GetString("state") != "accepted" {
		t.Fatal("not accepted exactly once", calls, result.PublicExport())
	}
	tr, _ := a.app.FindRecordById("crew_tasks", task.Id)
	if tr.GetString("status") != "todo" {
		t.Fatal("delivery changed task completion")
	}
	attempts, _ := a.app.FindAllRecords("crew_webhook_attempts")
	if len(attempts) != 2 {
		t.Fatal("immutable start and outcome audit missing")
	}
	phases := map[string]bool{}
	for _, attempt := range attempts {
		phases[attempt.GetString("phase")] = true
	}
	if !phases["started"] || !phases["finished"] {
		t.Fatal("attempt phases missing")
	}
}

func TestWebhookInFlightInvalidationAndRetry(t *testing.T) {
	a, c, task, d := webhookFixture(t)
	w := newWebhookDispatcher(a.app)
	w.client = &http.Client{Transport: webhookRoundTrip(func(r *http.Request) (*http.Response, error) {
		webhookOperation(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"readiness": "waiting"}, "")
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	if err := w.tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	result, _ := a.app.FindRecordById("crew_webhook_deliveries", d.Id)
	if result.GetString("state") != "cancelled" {
		t.Fatal("in-flight cancellation lost")
	}
	task, _ = a.app.FindRecordById("crew_tasks", task.Id)
	if task.GetInt("wake_generation") <= d.GetInt("generation") {
		t.Fatal("delivered wake not invalidated")
	}
	if webhookEligible(a.app, d, c) {
		t.Fatal("old generation eligible")
	}
}

func TestWebhookRetryLeaseAndExhaustion(t *testing.T) {
	a, _, _, d := webhookFixture(t)
	w := newWebhookDispatcher(a.app)
	now := time.Now().UTC().Truncate(time.Millisecond)
	w.now = func() time.Time { return now }
	d.Set("state", "in_flight")
	d.Set("attempts", 1)
	d.Set("lease_until", webhookDate(now.Add(-time.Minute)))
	if err := a.app.Save(d); err != nil {
		t.Fatal(err)
	}
	w.client = &http.Client{Transport: webhookRoundTrip(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 429, Header: http.Header{"Retry-After": []string{"120"}}, Body: io.NopCloser(strings.NewReader("do not save this body"))}, nil
	})}
	if err := w.tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	row, _ := a.app.FindRecordById("crew_webhook_deliveries", d.Id)
	if row.GetString("state") != "pending" || row.GetInt("attempts") != 2 || webhookTime(row.GetString("next_attempt_at")).Before(now.Add(120*time.Second)) {
		t.Fatal("lease/retry not recovered", row.PublicExport())
	}
	row.Set("attempts", 11)
	row.Set("next_attempt_at", webhookDate(now))
	if err := a.app.Save(row); err != nil {
		t.Fatal(err)
	}
	now = now.Add(121 * time.Second)
	if err := w.tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	row, _ = a.app.FindRecordById("crew_webhook_deliveries", d.Id)
	if row.GetString("state") != "failed" || row.GetInt("attempts") != 12 {
		t.Fatal("retry limit ignored", row.PublicExport())
	}
}

func TestWebhookRestoreEpochAndNativeMarker(t *testing.T) {
	a, c, _, d := webhookFixture(t)
	rt, _ := webhookRouting(a.app)
	epoch := rt.GetString("epoch")
	p := &Project{Dir: t.TempDir()}
	marker := filepath.Join(p.Dir, "crew-restore.json")
	if err := os.WriteFile(marker, []byte(`{"version":1}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := restoreLocalWebhookMarker(a.app, p); err != nil {
		t.Fatal(err)
	}
	rt, _ = webhookRouting(a.app)
	if rt.GetString("epoch") == epoch || !rt.GetBool("paused") {
		t.Fatal("restore did not change epoch/pause")
	}
	c, _ = a.app.FindRecordById("crew_webhook_configs", c.Id)
	if c.GetBool("enabled") {
		t.Fatal("restore enabled receiver")
	}
	if webhookEligible(a.app, d, c) {
		t.Fatal("old epoch remains eligible")
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("marker not consumed")
	}
	newEpoch := rt.GetString("epoch")
	if err := restoreLocalWebhookMarker(a.app, p); err != nil {
		t.Fatal(err)
	}
	rt, _ = webhookRouting(a.app)
	if rt.GetString("epoch") != newEpoch {
		t.Fatal("ordinary restart changed epoch")
	}
}

func TestWebhookDueQueueIsNotBlockedByBackoff(t *testing.T) {
	a, c, task, d := webhookFixture(t)
	future := webhookDate(time.Now().Add(time.Hour))
	d.Set("next_attempt_at", future)
	if err := a.app.Save(d); err != nil {
		t.Fatal(err)
	}
	col, _ := a.app.FindCollectionByNameOrId("crew_webhook_deliveries")
	for i := 0; i < 105; i++ {
		row := core.NewRecord(col)
		row.Set("config", c.Id)
		row.Set("agent", d.GetString("agent"))
		row.Set("state", "pending")
		row.Set("next_attempt_at", future)
		row.Set("event_id", RandomHex(16))
		row.Set("revision", 1)
		if err := a.app.Save(row); err != nil {
			t.Fatal(err)
		}
	}
	webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Later due task", "assigned_agent": task.GetString("assigned_agent"), "readiness": "ready"}, "")
	calls := 0
	w := newWebhookDispatcher(a.app)
	w.client = &http.Client{Transport: webhookRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	if err := w.tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("due delivery starved behind backed-off rows")
	}
}

func TestWebhookAttemptStartSurvivesUnknownOutcome(t *testing.T) {
	a, _, _, d := webhookFixture(t)
	w := newWebhookDispatcher(a.app)
	// Interrupt exactly after the durable lease/start record, before any result.
	w.client = &http.Client{Transport: webhookRoundTrip(func(r *http.Request) (*http.Response, error) { panic("synthetic process interruption") })}
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("synthetic interruption not reached")
			}
		}()
		_ = w.tick(context.Background())
	}()
	row, _ := a.app.FindRecordById("crew_webhook_deliveries", d.Id)
	if row.GetString("state") != "in_flight" || row.GetInt("attempts") != 1 {
		t.Fatal("attempt lease not durable")
	}
	attempts, _ := a.app.FindAllRecords("crew_webhook_attempts")
	if len(attempts) != 1 || attempts[0].GetString("phase") != "started" || attempts[0].GetString("finished_at") != "" {
		t.Fatal("unknown outcome not visible in immutable history")
	}
	// Restart after lease expiry creates a new attempt; it never rewrites the old one.
	restarted := newWebhookDispatcher(a.app)
	restarted.now = func() time.Time { return time.Now().Add(time.Minute) }
	restarted.client = &http.Client{Transport: webhookRoundTrip(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	if err := restarted.tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	attempts, _ = a.app.FindAllRecords("crew_webhook_attempts")
	if len(attempts) != 3 {
		t.Fatal("restart did not preserve start and append new attempt outcome")
	}
	starts, finishes := 0, 0
	for _, attempt := range attempts {
		if attempt.GetInt("attempt") == 1 {
			if attempt.GetString("phase") != "started" || attempt.GetString("finished_at") != "" {
				t.Fatal("crashed attempt history rewritten")
			}
		}
		if attempt.GetString("phase") == "started" {
			starts++
		} else {
			finishes++
		}
	}
	if starts != 2 || finishes != 1 {
		t.Fatal("unexpected attempt history phases")
	}
}
