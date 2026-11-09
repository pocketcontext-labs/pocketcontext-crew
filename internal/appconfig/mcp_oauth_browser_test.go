package appconfig

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/pocketcontext-labs/pocketcontext-core/appserver"
)

// Opt-in integration check. Build ui/dist and install ui's Playwright Chromium first, then run:
// POCKETCONTEXT_MCP_BROWSER_TEST=1 go test -tags "$(cat build-tags.txt)" ./internal/appconfig -run TestMCPOAuthBrowser -count=1
func TestMCPOAuthBrowser(t *testing.T) {
	if os.Getenv("POCKETCONTEXT_MCP_BROWSER_TEST") != "1" {
		t.Skip("opt-in Playwright OAuth browser test")
	}
	t.Setenv("POCKETCONTEXT_MCP_REDIRECT_EXCEPTIONS", `["cursor://anysphere.cursor-mcp/oauth/callback"]`)
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	a := newTestApp(t)
	server, err := Runtime.NewTestServer(a.app, appserver.TestServerOptions{Domain: syntheticDomain, MCP: true, ReaderDir: filepath.Join(root, "ui", "dist"), Cache: t.TempDir(),
		MCPHandler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]bool{"authenticated": appserver.MCPAuthToken(r.Context()) != ""})
		})})
	if err != nil {
		t.Fatal(err)
	}
	certServer := httptest.NewTLSServer(http.NotFoundHandler())
	tlsConfig := certServer.TLS.Clone()
	certServer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	address, shutdown, err := server.StartTLS(ctx, syntheticDomain, tlsConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		stop, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = shutdown(stop)
	}()
	code, err := server.IssueCode(a.user.Id, 2*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	_, port, err := net.SplitHostPort(address)
	if err != nil {
		t.Fatal(err)
	}
	commandCtx, done := context.WithTimeout(context.Background(), 120*time.Second)
	defer done()
	command := exec.CommandContext(commandCtx, "node", filepath.Join(root, "tests", "mcp_oauth_browser.mjs"))
	command.Env = append(os.Environ(), "POCKETCONTEXT_SYNTHETIC_SIGNIN=https://knowledge.example.com/bundle/login#"+code, "POCKETCONTEXT_SYNTHETIC_PORT="+port)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("OAuth browser: %v\n%s", err, output)
	}
	t.Log(string(output))
}
