package crewruntime

// Webhook delivery uses the application's existing database connection and writer.
// Credentials are encrypted with a machine-private key, never a project key.
import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

const webhookKeyStore = "crew.webhook.keypath"
const webhookURLStore = "crew.webhook.baseurl"

var webhookKeyMu sync.Mutex

func configureWebhookRuntime(app core.App, p *Project, domain string) {
	app.Store().Set(webhookKeyStore, filepath.Join(p.Cache, "crew-webhook.key"))
	if domain != "" {
		app.Store().Set(webhookURLStore, "https://"+domain)
	}
}

func webhookInstanceURL(app core.App) string {
	value, _ := app.Store().Get(webhookURLStore).(string)
	return value
}

func webhookUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:]), nil
}

func webhookKey(app core.App, create bool) ([]byte, error) {
	path, _ := app.Store().Get(webhookKeyStore).(string)
	if path == "" {
		return nil, errors.New("webhook private storage unavailable")
	}
	webhookKeyMu.Lock()
	defer webhookKeyMu.Unlock()
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) && create {
		for _, check := range []struct{ collection, filter string }{{"crew_webhook_configs", "secret_ciphertext != ''"}, {"crew_webhook_idempotency", "id != ''"}} {
			if _, e := app.FindCollectionByNameOrId(check.collection); e == nil {
				records, e := app.FindRecordsByFilter(check.collection, check.filter, "", 1, 0)
				if e != nil || len(records) > 0 {
					return nil, errors.New("webhook credential key unavailable; restore the private key")
				}
			}
		}
		if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return nil, errors.New("webhook private storage unavailable")
		}
		b = make([]byte, 32)
		if _, err = rand.Read(b); err != nil {
			return nil, errors.New("webhook key generation failed")
		}
		if err = writeAtomic(path, b, 0600); err != nil {
			return nil, errors.New("webhook private storage unavailable")
		}
	}
	if err != nil || len(b) != 32 {
		return nil, errors.New("webhook credential key unavailable")
	}
	return b, nil
}

func webhookSeal(app core.App, plain string) (string, error) {
	if len(plain) == 0 || len(plain) > 8192 || strings.ContainsAny(plain, "\r\n") {
		return "", errors.New("invalid webhook credential")
	}
	key, err := webhookKey(app, true)
	if err != nil {
		return "", err
	}
	block, _ := aes.NewCipher(key)
	aead, _ := cipher.NewGCM(block)
	nonce := make([]byte, aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", errors.New("webhook credential encryption failed")
	}
	sealed := aead.Seal(nonce, nonce, []byte(plain), []byte("crew-webhook-v1"))
	return "v1:" + base64.RawStdEncoding.EncodeToString(sealed), nil
}

func webhookUnseal(app core.App, encrypted string) (string, error) {
	key, err := webhookKey(app, false)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(encrypted, "v1:") {
		return "", errors.New("webhook credential unavailable")
	}
	b, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(encrypted, "v1:"))
	if err != nil {
		return "", errors.New("webhook credential unavailable")
	}
	block, _ := aes.NewCipher(key)
	aead, _ := cipher.NewGCM(block)
	if len(b) < aead.NonceSize() {
		return "", errors.New("webhook credential unavailable")
	}
	plain, err := aead.Open(nil, b[:aead.NonceSize()], b[aead.NonceSize():], []byte("crew-webhook-v1"))
	if err != nil {
		return "", errors.New("webhook credential unavailable")
	}
	return string(plain), nil
}

func webhookFingerprint(app core.App, input string) (string, error) {
	key, err := webhookKey(app, true)
	if err != nil {
		return "", err
	}
	h := hmac.New(sha256.New, key)
	h.Write([]byte("crew-idempotency-v1\x00"))
	h.Write([]byte(input))
	return hex.EncodeToString(h.Sum(nil)), nil
}

var webhookBlockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"), netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("64:ff9b::/96"), netip.MustParsePrefix("64:ff9b:1::/48"),
}

func webhookPublicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	// Native globally routed IPv6 only; exclude transition/translation mechanisms.
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	for _, p := range webhookBlockedPrefixes {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

func webhookParseEndpoint(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 2048 || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" {
		return nil, errors.New("webhook endpoint must be a public HTTPS URL without credentials or fragment")
	}
	if u.Port() != "" {
		p, e := strconv.Atoi(u.Port())
		if e != nil || p < 1 || p > 65535 {
			return nil, errors.New("invalid webhook endpoint port")
		}
	}
	// Credentials in query strings cannot be safely redacted or rotated.
	if u.RawQuery != "" {
		return nil, errors.New("webhook endpoint query parameters are unsupported")
	}
	return u, nil
}

func webhookResolve(ctx context.Context, host string) ([]netip.Addr, error) {
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return nil, errors.New("webhook destination DNS unavailable")
	}
	for _, ip := range ips {
		if !webhookPublicIP(ip) {
			return nil, errors.New("webhook destination is not public")
		}
	}
	return ips, nil
}

func webhookValidateEndpoint(raw string) error {
	u, err := webhookParseEndpoint(raw)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = webhookResolve(ctx, u.Hostname())
	return err
}

func webhookHTTPClient() *http.Client {
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true, ForceAttemptHTTP2: false, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 8 * time.Second}
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, errors.New("invalid webhook destination")
		}
		ips, err := webhookResolve(ctx, host)
		if err != nil {
			return nil, err
		}
		d := net.Dialer{Timeout: 5 * time.Second}
		// Dial resolved and validated literal addresses, never resolve the name again.
		for _, ip := range ips {
			c, e := d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if e == nil {
				return c, nil
			}
		}
		return nil, errors.New("webhook connection failed")
	}
	return &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func webhookDate(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }
func webhookTime(raw string) time.Time {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.999Z"} {
		if t, e := time.Parse(layout, raw); e == nil {
			return t
		}
	}
	return time.Time{}
}

func webhookRouting(app core.App) (*core.Record, error) {
	return app.FindFirstRecordByFilter("crew_webhook_routing", "id != ''")
}

// restoreWebhookState is called before serving a restored database. It preserves
// history, invalidates external payloads, and never silently resumes dispatch.
func restoreWebhookState(app core.App) error {
	if _, err := app.FindCollectionByNameOrId("crew_webhook_routing"); err != nil {
		return nil
	} // pre-feature backups
	return app.RunInTransaction(func(tx core.App) error {
		r, err := webhookRouting(tx)
		if err != nil {
			return err
		}
		epoch, err := webhookUUID()
		if err != nil {
			return err
		}
		r.Set("epoch", epoch)
		r.Set("paused", true)
		r.Set("revision", r.GetInt("revision")+1)
		if err = tx.Save(r); err != nil {
			return err
		}
		configs, err := tx.FindAllRecords("crew_webhook_configs")
		if err != nil {
			return err
		}
		for _, c := range configs {
			c.Set("enabled", false)
			c.Set("revision", c.GetInt("revision")+1)
			if err = tx.Save(c); err != nil {
				return err
			}
		}
		rows, err := tx.FindRecordsByFilter("crew_webhook_deliveries", "state = 'pending' || state = 'in_flight'", "", 0, 0)
		if err != nil {
			return err
		}
		for _, d := range rows {
			d.Set("state", "cancelled")
			d.Set("last_error", "restored_instance")
			d.Set("revision", d.GetInt("revision")+1)
			if err = tx.Save(d); err != nil {
				return err
			}
		}
		return nil
	})
}

type webhookDispatcher struct {
	app    core.App
	client *http.Client
	now    func() time.Time
	next   map[string]time.Time
}

func newWebhookDispatcher(app core.App) *webhookDispatcher {
	return &webhookDispatcher{app: app, client: webhookHTTPClient(), now: time.Now, next: map[string]time.Time{}}
}
func (w *webhookDispatcher) run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = w.tick(ctx)
		}
	}
}

func webhookEligible(app core.App, d, c *core.Record) bool {
	r, err := webhookRouting(app)
	if err != nil || r.GetString("epoch") != d.GetString("epoch") {
		return false
	}
	var payload map[string]any
	if json.Unmarshal([]byte(d.GetString("payload")), &payload) != nil {
		return false
	}
	if c.GetInt("destination_version") != d.GetInt("destination_version") {
		return false
	}
	agent, err := app.FindRecordById("crew_agents", d.GetString("agent"))
	if err != nil || agent.GetBool("archived") {
		return false
	}
	if c.GetString("scope") != "global" {
		return false
	}
	dispatcher, err := app.FindRecordById("crew_agents", c.GetString("agent"))
	if err != nil || dispatcher.GetBool("archived") {
		return false
	}
	if payload["event_type"] == "webhook.test" {
		return !r.GetBool("paused")
	}
	if r.GetBool("paused") || !c.GetBool("enabled") {
		return false
	}
	mapping, err := app.FindFirstRecordByFilter("crew_webhook_mappings", "agent = {:agent}", dbx.Params{"agent": d.GetString("agent")})
	if err != nil || mapping.GetString("bot_ref") == "" || payload["mapping_revision"] != float64(mapping.GetInt("revision")) || payload["recipient_bot_ref"] != mapping.GetString("bot_ref") || payload["dispatcher_agent_id"] != c.GetString("agent") {
		return false
	}
	var subscriptions []string
	if json.Unmarshal([]byte(c.GetString("subscriptions")), &subscriptions) != nil {
		return false
	}
	matched := false
	causes, _ := payload["causes"].([]any)
	if len(causes) == 0 {
		causes = []any{payload["reason"]}
	}
	for _, subscription := range subscriptions {
		for _, cause := range causes {
			if cause == subscription {
				matched = true
			}
		}
	}
	if !matched {
		return false
	}
	t, err := app.FindRecordById("crew_tasks", d.GetString("task"))
	if err != nil {
		return false
	}
	if t.GetBool("archived") || t.GetString("readiness") != "ready" || (t.GetString("status") != "todo" && t.GetString("status") != "in_progress") || t.GetInt("wake_generation") != d.GetInt("generation") {
		return false
	}
	pending, err := app.FindRecordsByFilter("crew_reviews", "task = {:task} && status = 'pending'", "", 1, 0, dbx.Params{"task": t.Id})
	if err != nil || len(pending) > 0 {
		return false
	}
	if d.GetString("target_kind") == "triage" {
		return t.GetString("assigned_agent") == "" && r.GetString("triage_agent") == d.GetString("agent")
	}
	return t.GetString("assigned_agent") == d.GetString("agent")
}

func (w *webhookDispatcher) tick(ctx context.Context) error {
	now := w.now()
	// Recover expired leases after a crash. Attempt count was committed before I/O.
	filter := "((state = 'pending' && next_attempt_at <= {:now}) || (state = 'in_flight' && lease_until <= {:now}))"
	params := dbx.Params{"now": webhookDate(now)}
	for destination, next := range w.next {
		if next.After(now) {
			key := fmt.Sprintf("limited%d", len(params))
			filter += " && config != {:" + key + "}"
			params[key] = destination
		} else {
			delete(w.next, destination)
		}
	}
	rows, err := w.app.FindRecordsByFilter("crew_webhook_deliveries", filter, "created", 100, 0, params)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if row.GetString("state") == "in_flight" && webhookTime(row.GetString("lease_until")).After(now) {
			continue
		}
		if webhookTime(row.GetString("next_attempt_at")).After(now) || w.next[row.GetString("config")].After(now) {
			continue
		}
		var delivery, config *core.Record
		err = w.app.RunInTransaction(func(tx core.App) error {
			d, e := tx.FindRecordById("crew_webhook_deliveries", row.Id)
			if e != nil {
				return e
			}
			if d.GetString("state") != "pending" && d.GetString("state") != "in_flight" {
				return nil
			}
			// The row may have been leased or rescheduled after candidate selection.
			if d.GetString("state") == "in_flight" && webhookTime(d.GetString("lease_until")).After(now) {
				return nil
			}
			if d.GetString("state") == "pending" && webhookTime(d.GetString("next_attempt_at")).After(now) {
				return nil
			}
			c, e := tx.FindRecordById("crew_webhook_configs", d.GetString("config"))
			if e != nil || !webhookEligible(tx, d, c) {
				d.Set("state", "cancelled")
				d.Set("last_error", "stale_event")
				d.Set("revision", d.GetInt("revision")+1)
				return tx.Save(d)
			}
			if d.GetInt("attempts") >= 12 || (!webhookTime(d.GetString("deadline_at")).IsZero() && !webhookTime(d.GetString("deadline_at")).After(now)) {
				d.Set("state", "failed")
				d.Set("last_error", "retry_exhausted")
				d.Set("revision", d.GetInt("revision")+1)
				return tx.Save(d)
			}
			d.Set("state", "in_flight")
			d.Set("lease_until", webhookDate(now.Add(30*time.Second)))
			d.Set("attempts", d.GetInt("attempts")+1)
			d.Set("revision", d.GetInt("revision")+1)
			if e = tx.Save(d); e != nil {
				return e
			}
			// Append the start with the consumed attempt, before network I/O.
			// A crash leaves an explicit unknown outcome in immutable history.
			attemptsCollection, e := tx.FindCollectionByNameOrId("crew_webhook_attempts")
			if e != nil {
				return e
			}
			started := core.NewRecord(attemptsCollection)
			started.Set("delivery", d.Id)
			started.Set("phase", "started")
			started.Set("attempt", d.GetInt("attempts"))
			started.Set("retry_cycle", d.GetInt("retry_cycle"))
			started.Set("started_at", webhookDate(now))
			started.Set("revision", 1)
			if e = tx.Save(started); e != nil {
				return e
			}
			delivery = d
			config = c
			return nil
		})
		if err != nil {
			return err
		}
		if delivery == nil {
			continue
		}
		w.next[delivery.GetString("config")] = now.Add(6 * time.Second)
		code, retryAfter, fail := w.send(ctx, delivery, config)
		if err = w.finish(delivery, code, retryAfter, fail, now); err != nil {
			return err
		}
		return nil // bounded work per tick; no network operation holds a DB transaction
	}
	return nil
}

func (w *webhookDispatcher) send(ctx context.Context, d, c *core.Record) (int, string, string) {
	if _, err := webhookParseEndpoint(c.GetString("url")); err != nil {
		return 0, "", "invalid_destination"
	}
	credential, err := webhookUnseal(w.app, c.GetString("secret_ciphertext"))
	if err != nil {
		return 0, "", "credential_unavailable"
	}
	if c.GetString("adapter") != "grok-dispatch-v1" {
		return 0, "", "unsupported_adapter"
	}
	payload := []byte(d.GetString("payload"))
	if len(payload) > 8192 {
		return 0, "", "payload_too_large"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.GetString("url"), bytes.NewReader(payload))
	if err != nil {
		return 0, "", "invalid_destination"
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+credential)
	resp, err := w.client.Do(req)
	if err != nil {
		return 0, "", "transport_error"
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	return resp.StatusCode, resp.Header.Get("Retry-After"), ""
}

func webhookRetryDelay(attempt int) time.Duration {
	max := 30 * time.Second * time.Duration(1<<min(max(attempt-1, 0), 7))
	if max > time.Hour {
		max = time.Hour
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(max)))
	if err != nil {
		return max
	}
	return time.Duration(n.Int64())
}

func (w *webhookDispatcher) finish(sent *core.Record, code int, retryAfter, fail string, started time.Time) error {
	now := w.now()
	return w.app.RunInTransaction(func(tx core.App) error {
		d, err := tx.FindRecordById("crew_webhook_deliveries", sent.Id)
		if err != nil {
			return err
		}
		col, err := tx.FindCollectionByNameOrId("crew_webhook_attempts")
		if err != nil {
			return err
		}
		a := core.NewRecord(col)
		a.Set("delivery", d.Id)
		a.Set("phase", "finished")
		a.Set("attempt", sent.GetInt("attempts"))
		a.Set("retry_cycle", sent.GetInt("retry_cycle"))
		a.Set("status_code", code)
		a.Set("error_code", fail)
		a.Set("started_at", webhookDate(started))
		a.Set("finished_at", webhookDate(now))
		a.Set("revision", 1)
		if err = tx.Save(a); err != nil {
			return err
		}
		// A concurrent disable/reassignment may have cancelled the row during I/O.
		if d.GetString("state") != "in_flight" || d.GetInt("revision") != sent.GetInt("revision") {
			return nil
		}
		d.Set("lease_until", "")
		d.Set("revision", d.GetInt("revision")+1)
		c, e := tx.FindRecordById("crew_webhook_configs", d.GetString("config"))
		if e != nil || !webhookEligible(tx, d, c) {
			d.Set("state", "cancelled")
			d.Set("last_error", "stale_event")
			return tx.Save(d)
		}
		if code >= 200 && code < 300 {
			d.Set("state", "accepted")
			d.Set("accepted_at", webhookDate(now))
			d.Set("last_error", "")
			return tx.Save(d)
		}
		retry := fail == "transport_error" || code == 408 || code == 429 || code >= 500
		if fail == "" {
			fail = "http_" + strconv.Itoa(code)
		}
		next := now.Add(webhookRetryDelay(d.GetInt("attempts")))
		if retryAfter != "" {
			if sec, e := strconv.Atoi(retryAfter); e == nil && sec >= 0 {
				n := now.Add(time.Duration(min(sec, 86401)) * time.Second)
				if n.After(next) {
					next = n
				}
			} else if n, e := http.ParseTime(retryAfter); e == nil && n.After(next) {
				next = n
			}
		}
		deadline := webhookTime(d.GetString("deadline_at"))
		if !retry || d.GetInt("attempts") >= 12 || (!deadline.IsZero() && !next.Before(deadline)) {
			d.Set("state", "failed")
		} else {
			d.Set("state", "pending")
			d.Set("next_attempt_at", webhookDate(next))
		}
		d.Set("last_error", fail)
		return tx.Save(d)
	})
}

// Native stopped-backup restore creates this marker before starting the server.
// It is deliberately explicit: an arbitrary copied database is not detectable.
func restoreLocalWebhookMarker(app core.App, p *Project) error {
	marker := filepath.Join(p.Dir, "crew-restore.json")
	if _, err := os.Stat(marker); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if err := restoreWebhookState(app); err != nil {
		return err
	}
	return os.Remove(marker)
}

func webhookCredentialReady(app core.App, encrypted string) error {
	_, err := webhookUnseal(app, encrypted)
	return err
}
