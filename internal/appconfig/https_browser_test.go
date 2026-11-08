//go:build crew_core_testkit

package appconfig

import (
	"context"
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

// Opt-in integration check: ordinary Go tests do not require Node or browsers.
// Build ui/dist and install ui's Playwright Chromium first, then run:
// POCKETCONTEXT_HTTPS_BROWSER_TEST=1 go test -modfile=tests/core-testkit.mod -tags "$(cat build-tags.txt),crew_core_testkit" ./internal/appconfig -run TestPublicHTTPSPhoneBrowser -count=1
func TestPublicHTTPSPhoneBrowser(t *testing.T) {
	if os.Getenv("POCKETCONTEXT_HTTPS_BROWSER_TEST") != "1" {
		t.Skip("opt-in Playwright phone browser test")
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	reader := filepath.Join(root, "ui", "dist")
	if _, err := os.Stat(filepath.Join(reader, "index.html")); err != nil {
		t.Fatal("build the reader before this test:", err)
	}
	a := newTestApp(t)
	certServer := httptest.NewTLSServer(http.NotFoundHandler())
	tlsConfig := certServer.TLS.Clone()
	certServer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := Runtime.NewTestServer(a.app, appserver.TestServerOptions{Domain: syntheticDomain, ReaderDir: reader, Cache: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	address, shutdown, err := server.StartTLS(ctx, syntheticDomain, tlsConfig)
	if err != nil {
		t.Fatal("phone test HTTPS listener:", err)
	}
	code, err := server.IssueCode(a.user.Id, 2*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	_, port, err := net.SplitHostPort(address)
	if err != nil {
		t.Fatal(err)
	}
	commandCtx, done := context.WithTimeout(context.Background(), 90*time.Second)
	defer done()
	command := exec.CommandContext(commandCtx, "node", filepath.Join(root, "tests", "https_reader_browser.mjs"))
	command.Env = append(os.Environ(), "POCKETCONTEXT_SYNTHETIC_SIGNIN=https://knowledge.example.com/bundle/login#"+code, "POCKETCONTEXT_SYNTHETIC_PORT="+port)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("HTTPS phone browser: %v\n%s", err, output)
	}
	t.Log(string(output))
	cancel()
	stop, stopDone := context.WithTimeout(context.Background(), 5*time.Second)
	defer stopDone()
	if err := shutdown(stop); err != nil {
		t.Fatal(err)
	}
}
