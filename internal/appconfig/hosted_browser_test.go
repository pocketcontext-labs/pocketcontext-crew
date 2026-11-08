//go:build crew_core_testkit

package appconfig

import (
	"context"
	"encoding/json"
	"html"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sync"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"github.com/pocketcontext-labs/pocketcontext-core/appserver"
)

// Opt-in: POCKETCONTEXT_HOSTED_BROWSER_TEST=1 with the command in core_testkit_test.go.
func TestHostedEmailBrowser(t *testing.T) {
	if os.Getenv("POCKETCONTEXT_HOSTED_BROWSER_TEST") != "1" {
		t.Skip("opt-in hosted email browser test")
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	a := newTestApp(t)
	setOwnerEmail(t, a)
	const email = "owner@example.test"
	var mu sync.Mutex
	mailURL := ""
	count := 0
	link := regexp.MustCompile(`href="([^"]+)"`)
	a.app.OnMailerRecordOTPSend("users").BindFunc(func(e *core.MailerRecordEvent) error {
		match := link.FindStringSubmatch(e.Message.HTML)
		mu.Lock()
		defer mu.Unlock()
		if len(match) == 2 {
			mailURL = html.UnescapeString(match[1])
			count++
		}
		return nil // capture only: synthetic test never sends mail
	})
	testServer, err := Runtime.NewTestServer(a.app, appserver.TestServerOptions{Domain: syntheticDomain, Hosted: true, MCP: true, HostedConfig: syntheticHostedConfig(), ReaderDir: filepath.Join(root, "ui", "dist"), Cache: t.TempDir(),
		MCPHandler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]bool{"authenticated": appserver.MCPAuthToken(r.Context()) != ""})
		})})
	if err != nil {
		t.Fatal(err)
	}
	hosted := testServer.Public()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/__test/mailbox" {
			mu.Lock()
			defer mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"url": mailURL, "count": count})
			return
		}
		// Simulate TLS termination upstream of the hosted plaintext listener.
		r.TLS = nil
		hosted.ServeHTTP(w, r)
	}))
	defer server.Close()
	_, port, _ := net.SplitHostPort(server.Listener.Addr().String())
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", filepath.Join(root, "tests", "hosted_email_browser.mjs"))
	cmd.Env = append(os.Environ(), "POCKETCONTEXT_SYNTHETIC_PORT="+port, "POCKETCONTEXT_SYNTHETIC_EMAIL="+email)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("hosted browser: %v\n%s", err, out)
	}
	t.Log(string(out))
}
