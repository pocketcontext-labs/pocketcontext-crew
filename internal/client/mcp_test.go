package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/bundle"
)

// The protocol fixture injects the ordinary user identity that the separately
// tested OAuth middleware supplies in production. A shared stateless SDK handler
// must never retain one HTTP request's identity for the next one.
func mcpTestHandler(api http.Handler) http.Handler {
	s := mcp.NewServer(&mcp.Implementation{Name: "PocketContext test", Version: "test"}, nil)
	s.AddReceivingMiddleware(observeMCPMethods)
	addCrewMCPTools(s, api)
	return mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return s }, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true, MaxRequestBodyBytes: mcpInputLimit})
}
func mcpRequest(t *testing.T, h http.Handler, token, method string, params any) map[string]any {
	t.Helper()
	payload, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	req := httptest.NewRequest("POST", "https://knowledge.example.com/mcp", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2025-11-25")
	caller := &mcpCaller{ctx: req.Context(), host: req.Host, token: token}
	req = req.WithContext(context.WithValue(req.Context(), mcpRequestContextKey{}, caller))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("MCP %s: %d %s", method, rec.Code, rec.Body)
	}
	var result map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if rec.Header().Get("Mcp-Session-Id") != "" {
		t.Fatal("stateless endpoint assigned a session")
	}
	return result
}
func mcpCall(t *testing.T, h http.Handler, token, name string, args any, wantError bool) any {
	t.Helper()
	result := mcpRequest(t, h, token, "tools/call", map[string]any{"name": name, "arguments": args})
	if result["error"] != nil {
		if wantError {
			return result
		}
		t.Fatalf("protocol error: %v", result)
	}
	r, _ := result["result"].(map[string]any)
	if (r["isError"] == true) != wantError {
		t.Fatalf("%s: unexpected result %v", name, result)
	}
	if wantError {
		return r
	}
	content, _ := r["content"].([]any)
	if len(content) == 0 {
		t.Fatalf("%s returned no content: %v", name, result)
	}
	text, _ := dig(content[0], "text").(string)
	var out any
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestMCPToolAnnotations(t *testing.T) {
	// Check the wire response, including explicit false values, rather than
	// struct defaults: clients use this metadata for action permission groups.
	wantReadOnly := map[string]bool{
		"crew_read": true, "crew_search": true, "crew_write": false,
	}
	h := mcpTestHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("tool discovery must not call the knowledge API")
	}))
	listed := mcpRequest(t, h, "synthetic", "tools/list", map[string]any{})
	tools, _ := dig(listed, "result", "tools").([]any)
	if len(tools) != len(wantReadOnly) {
		t.Fatalf("got %d tools, want %d", len(tools), len(wantReadOnly))
	}
	for _, tool := range tools {
		name, _ := dig(tool, "name").(string)
		readOnly, ok := wantReadOnly[name]
		if !ok {
			t.Fatalf("unexpected or duplicate tool %q; review its annotations", name)
		}
		for hint, want := range map[string]bool{
			"readOnlyHint": readOnly, "destructiveHint": !readOnly, "openWorldHint": false,
		} {
			if got := dig(tool, "annotations", hint); got != want {
				t.Errorf("%s: %s = %v, want explicit %t", name, hint, got, want)
			}
		}
		if dig(tool, "inputSchema", "properties", "space") != nil {
			t.Errorf("%s exposes a space argument", name)
		}
		delete(wantReadOnly, name)
	}
}

func TestMCPProtocolAndPrincipalIsolation(t *testing.T) {
	type key struct{}
	var calls atomic.Int64
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Host != "knowledge.example.com" || r.RemoteAddr == "127.0.0.1:0" || r.Header.Get("X-PocketContext-Local-Key") != "" {
			t.Errorf("unsafe in-process authority: %v", r)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"token_seen_by_api": r.Header.Get("Authorization"), "context_seen": r.Context().Value(key{})})
	})
	h := mcpTestHandler(api)
	init := mcpRequest(t, h, "first", "initialize", map[string]any{"protocolVersion": "2025-11-25", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "synthetic", "version": "1"}})
	if dig(init, "result", "protocolVersion") != "2025-11-25" {
		t.Fatalf("protocol negotiation: %v", init)
	}
	listed := mcpRequest(t, h, "first", "tools/list", map[string]any{})
	tools, _ := dig(listed, "result", "tools").([]any)
	if len(tools) != 3 {
		t.Fatalf("missing tools: %v", listed)
	}
	for _, tool := range tools {
		name, _ := dig(tool, "name").(string)
		if strings.Contains(name, "password") || strings.Contains(name, "shell") || strings.Contains(name, "stop") {
			t.Fatalf("administration exposed: %s", name)
		}
		if name == "crew_write" && dig(tool, "annotations", "readOnlyHint") != false {
			t.Fatal("write marked read-only")
		}
	}
	for _, token := range []string{"first", "second", "third"} {
		v := mcpCall(t, h, token, "crew_read", map[string]any{"collection": "agents"}, false)
		if dig(v, "token_seen_by_api") != token {
			t.Fatalf("cross-request identity leak: %v", v)
		}
	}
	before := calls.Load()
	for _, tc := range []struct {
		name string
		args map[string]any
	}{
		{"create", map[string]any{"collection": "users", "fields": map[string]any{"password": "no"}}},
		{"get", map[string]any{"collection": "_superusers", "id": "aaaaaaaaaaaaaaa"}},
		{"update", map[string]any{"collection": "settings/../../users", "id": "aaaaaaaaaaaaaaa", "fields": map[string]any{"expected_revision": 1}}},
		{"batch", map[string]any{"requests": []any{map[string]any{"method": "POST", "url": "/api/collections/users/auth-refresh", "body": map[string]any{}}}}},
		{"batch", map[string]any{"requests": []any{map[string]any{"method": "POST", "url": "https://other.example.com/api/collections/pages/records", "body": map[string]any{}}}}},
		{"batch", map[string]any{"requests": []any{map[string]any{"method": "POST", "url": "/api/collections/pages/records?expand=users", "body": map[string]any{}}}}},
		{"ingest_text", map[string]any{"filename": "../../secret.txt", "text": "x"}},
		{"ingest_file", map[string]any{"filename": "C:\\secret.txt", "content_base64": "eA=="}},
		{"ingest_file", map[string]any{"filename": "note.bin", "content_base64": "invalid"}},
		{"schema", map[string]any{"unknown": "not accepted"}},
		{"publish", map[string]any{"run": "bad", "expected_revision": 1}},
		{"shutdown", map[string]any{}},
	} {
		mcpCall(t, h, "first", tc.name, tc.args, true)
	}
	if calls.Load() != before {
		t.Fatal("invalid MCP arguments reached API")
	}
	// Auth middleware absence fails closed even for initialize/list.
	req := httptest.NewRequest("POST", "https://knowledge.example.com/mcp", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	newMCPHandler(api).ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatal("missing OAuth accepted")
	}
}

// Exercise PocketBase's actual request-body cleanup without an HTTP hop. The
// network-backed knowledge fixture normalizes nil bodies before the router sees
// them, which hid the bodyless GET crash in the production in-process adapter.
func TestMCPTransportDirectRouterRequestBodies(t *testing.T) {
	routes := router.NewRouter(func(w http.ResponseWriter, r *http.Request) (*router.Event, router.EventCleanupFunc) {
		return &router.Event{Response: w, Request: r}, nil
	})
	handler := func(e *router.Event) error {
		var body []byte
		if e.Request.Method == http.MethodPost {
			var err error
			body, err = io.ReadAll(e.Request.Body)
			if err != nil {
				return err
			}
		}
		return e.JSON(http.StatusOK, map[string]string{"body": string(body), "token": e.Request.Header.Get("Authorization")})
	}
	routes.POST("/api/crew/agent-write", handler)
	routes.POST("/api/crew/read", handler)
	api, err := routes.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, method, path, wantBody string
		body                         io.Reader
	}{
		{"nil POST body", "POST", "/api/crew/read", "", nil},
		{"explicit empty POST body", "POST", "/api/crew/read", "", http.NoBody},
		{"JSON POST body", "POST", "/api/crew/read", `{"collection":"agents"}`, strings.NewReader(`{"collection":"agents"}`)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tr := &mcpTransport{ctx: context.Background(), caller: &mcpCaller{ctx: context.Background(), host: "knowledge.example.com", token: "synthetic"}, api: api}
			req, err := http.NewRequest(tc.method, "https://knowledge.example.com"+tc.path, tc.body)
			if err != nil {
				t.Fatal(err)
			}
			resp, err := tr.RoundTrip(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			var got map[string]string
			if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
				t.Fatal(err)
			}
			if resp.StatusCode != http.StatusOK || got["body"] != tc.wantBody || got["token"] != "synthetic" {
				t.Fatalf("direct router response: status=%d body=%v", resp.StatusCode, got)
			}
			if tc.body == nil && req.Body != nil {
				t.Fatal("transport changed the caller's request body")
			}
		})
	}
}

func TestMCPTransportBoundsAndCancellation(t *testing.T) {
	if mcpAPIAllowed("POST", "/api/bundle/token") || mcpAPIAllowed("GET", "/api/collections/users/records/aaaaaaaaaaaaaaa") || mcpAPIAllowed("DELETE", "/api/collections/pages/records/aaaaaaaaaaaaaaa") {
		t.Fatal("administration admitted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var called bool
	tr := &mcpTransport{ctx: context.Background(), caller: &mcpCaller{ctx: ctx, host: "knowledge.example.com", token: "synthetic"}, api: http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true })}
	req, _ := http.NewRequest("POST", "https://knowledge.example.com/api/crew/read", strings.NewReader(`{}`))
	if _, err := tr.RoundTrip(req); !errors.Is(err, context.Canceled) || called {
		t.Fatalf("cancelled operation reached router: %v", err)
	}
	tr.caller.ctx = context.Background()
	tr.api = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(bytes.Repeat([]byte("x"), mcpAPILimit+1)) })
	if _, err := tr.RoundTrip(req); err == nil {
		t.Fatal("unbounded API output accepted")
	}
	// Cancellation during handler execution reaches the underlying API.
	ctx, cancel = context.WithCancel(context.Background())
	defer cancel()
	tr.caller.ctx = ctx
	entered := make(chan struct{})
	tr.api = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(entered); <-r.Context().Done() })
	done := make(chan error, 1)
	go func() { _, err := tr.RoundTrip(req); done <- err }()
	<-entered
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("API context did not cancel")
	}
}

// A real headless server exercises Crew transactions and access boundaries.
func mcpRealAPI(t *testing.T) (http.Handler, string) {
	t.Helper()
	root := t.TempDir()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	t.Setenv("HOME", root)
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
	t.Setenv("LOCALAPPDATA", filepath.Join(root, "cache"))
	t.Setenv("APPDATA", filepath.Join(root, "config"))
	t.Setenv("POCKETCONTEXT_URL", "")
	t.Setenv("POCKETCONTEXT_SPACE", "")
	p, err := bundle.Resolve(filepath.Join(root, "project", "pocketcontext.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(p.Dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := p.EnsureInstance(); err != nil {
		t.Fatal(err)
	}
	if err := p.SaveConfig(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- bundle.ServeContext(ctx, p, bundle.ServeOptions{Headless: true}) }()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(15 * time.Second):
			t.Error("server failed to stop")
		}
	})
	deadline := time.Now().Add(15 * time.Second)
	for {
		if _, err := bundle.Health(p); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("server did not become healthy")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if _, err := bundle.LocalCall(p, "/api/bundle/account", map[string]string{"password": "synthetic-mcp-password"}); err != nil {
		t.Fatal(err)
	}
	c, err := New(p)
	if err != nil {
		t.Fatal(err)
	}
	// Proxy only the test's adapter to the actual private transport. Production
	// receives the raw router directly and retains the public-request marker.
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		inner := r.Clone(r.Context())
		inner.URL.Scheme = "http"
		u := strings.TrimPrefix(p.URL(), "http://")
		inner.URL.Host = u
		inner.Host = u
		inner.RequestURI = ""
		response, err := c.http.Do(inner)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer response.Body.Close()
		for k, values := range response.Header {
			for _, v := range values {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(response.StatusCode)
		_, _ = io.Copy(w, response.Body)
	})
	return api, c.token
}

func TestMCPRejectsOversizedAndMalformedProtocolBodies(t *testing.T) {
	h := mcpTestHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("malformed protocol reached API") }))
	for _, body := range []string{`{"jsonrpc":"2.0",`, strings.Repeat(" ", mcpInputLimit+1)} {
		req := httptest.NewRequest("POST", "https://knowledge.example.com/mcp", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code < 400 {
			t.Fatalf("malformed/oversized body accepted: %d", rec.Code)
		}
	}
}
