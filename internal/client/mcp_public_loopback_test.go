package client

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pocketcontext-labs/pocketcontext-crew/internal/bundle"
)

// Exercise a real TCP listener: the SDK inspects http.LocalAddrContextKey, which
// recorder-only protocol tests do not populate. A TLS reverse proxy forwards
// this public Host to our explicitly loopback-bound hosted development listener.
func TestMCPPublicHostedLoopbackListener(t *testing.T) {
	root := t.TempDir()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	for key, value := range map[string]string{"HOME": root, "XDG_CACHE_HOME": filepath.Join(root, "cache"), "XDG_CONFIG_HOME": filepath.Join(root, "config"), "LOCALAPPDATA": filepath.Join(root, "cache"), "APPDATA": filepath.Join(root, "config"), "POCKETCONTEXT_URL": ""} {
		t.Setenv(key, value)
	}
	p, err := bundle.Resolve(filepath.Join(root, "project", "pocketcontext.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(p.Dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err = p.EnsureInstance(); err != nil {
		t.Fatal(err)
	}
	if err = p.SaveConfig(); err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := ln.Addr().String()
	ln.Close()
	ui := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("MCP request reached Vite"); http.NotFound(w, r) }))
	defer ui.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- bundle.ServeContext(ctx, p, bundle.ServeOptions{
			Headless: true, Hosted: true, HostedInit: true, HTTPSDomain: "dev.example.test", MCP: true, MCPHandler: newMCPHandler,
			PublicUIDev: true, UIDev: ui.URL, DevHTTPAddress: address,
			HostedConfig: &bundle.HostedConfig{OwnerEmail: "synthetic@example.test", From: "login@example.test"},
		})
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(15 * time.Second):
			t.Error("server did not stop")
		}
	})
	deadline := time.Now().Add(15 * time.Second)
	for {
		if _, err = bundle.Health(p); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("server did not become healthy")
		}
		time.Sleep(20 * time.Millisecond)
	}
	owner, err := bundle.LocalCall(p, "/api/bundle/token", nil)
	if err != nil {
		t.Fatal(err)
	}
	ownerToken := owner["token"].(string)
	transport := &http.Transport{Proxy: nil}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	request := func(method, path, token, host, origin, contentType string, body []byte, want int) map[string]any {
		t.Helper()
		r, err := http.NewRequest(method, "http://"+address+path, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		r.Host = host
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", contentType)
		r.Header.Set("Accept", "application/json, text/event-stream")
		r.Header.Set("X-Forwarded-Host", "dev.example.test")
		r.Header.Set("X-Forwarded-Proto", "https")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		response, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ := io.ReadAll(response.Body)
		if response.StatusCode != want {
			t.Fatalf("%s %s: status=%d want=%d body=%s", method, path, response.StatusCode, want, raw)
		}
		var result map[string]any
		_ = json.Unmarshal(raw, &result)
		return result
	}
	call := func(path, token, contentType string, body []byte, want int) map[string]any {
		return request("POST", path, token, "dev.example.test", "https://dev.example.test", contentType, body, want)
	}
	registration := call("/oauth/register", "", "application/json", []byte(`{"client_name":"Synthetic loopback client","redirect_uris":["https://client.example.test/callback"],"token_endpoint_auth_method":"none"}`), 201)
	id := registration["client_id"].(string)
	verifier := strings.Repeat("x", 64)
	hash := sha256.Sum256([]byte(verifier))
	q := url.Values{"client_id": {id}, "redirect_uri": {"https://client.example.test/callback"}, "response_type": {"code"}, "code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(hash[:])}, "resource": {"https://dev.example.test/mcp"}, "scope": {"knowledge"}, "state": {"synthetic"}}
	grant := call("/oauth/authorize?"+q.Encode(), ownerToken, "application/json", []byte(`{"approve":true}`), 200)
	redirect, err := url.Parse(grant["redirect"].(string))
	if err != nil {
		t.Fatal(err)
	}
	exchange := url.Values{"client_id": {id}, "code": {redirect.Query().Get("code")}, "redirect_uri": {"https://client.example.test/callback"}, "code_verifier": {verifier}, "resource": {"https://dev.example.test/mcp"}, "grant_type": {"authorization_code"}}
	token := call("/oauth/token", "", "application/x-www-form-urlencoded", []byte(exchange.Encode()), 200)["access_token"].(string)
	initialize := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"synthetic","version":"1"}}}`)
	result := call("/mcp", token, "application/json", initialize, 200)
	if dig(result, "result", "protocolVersion") != "2025-11-25" {
		t.Fatalf("initialize failed: %v", result)
	}
	listed := call("/mcp", token, "application/json", []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`), 200)
	if len(dig(listed, "result", "tools").([]any)) != 5 {
		t.Fatal("missing Crew tools")
	}
	call("/mcp", "", "application/json", initialize, 401)
	call("/mcp", ownerToken, "application/json", initialize, 401)
	request("POST", "/mcp", token, "evil.example.test", "https://dev.example.test", "application/json", initialize, 403)
	request("POST", "/mcp", token, "dev.example.test", "https://evil.example.test", "application/json", initialize, 403)
	request("POST", "/api/bundle/token", ownerToken, "dev.example.test", "https://dev.example.test", "application/json", []byte(`{}`), 404)
	revoke := url.Values{"client_id": {id}, "token": {token}}
	call("/oauth/revoke", "", "application/x-www-form-urlencoded", []byte(revoke.Encode()), 200)
	call("/mcp", token, "application/json", initialize, 401)
}
