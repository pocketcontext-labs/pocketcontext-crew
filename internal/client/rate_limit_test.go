package client

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func throttleFixture(w http.ResponseWriter, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Retry-After", "7")
	w.Header().Set("RateLimit-Limit", "1200")
	w.Header().Set("RateLimit-Remaining", "2")
	w.Header().Set("RateLimit-Reset", "60")
	response := map[string]any{"status": 429, "message": "Too Many Requests.", "data": map[string]any{"rate_limit": RateLimitInfo{Limit: "authenticated_knowledge", RetryAfterSeconds: 7, Capacity: 1200, Remaining: 2, ResetAfterSeconds: 60}}}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(response)
}

func TestClientPreservesRateLimit(t *testing.T) {
	for _, tc := range []struct {
		name, method, path string
		status             int
	}{
		{"write", "POST", "/api/crew/write", 429},
		{"read", "POST", "/api/crew/read", 429},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls.Add(1); throttleFixture(w, tc.status) }))
			defer s.Close()
			c, _ := newClient(s.URL)
			_, err := c.Must(tc.method, tc.path, map[string]any{})
			var limited *RateLimitError
			var failure *Fail
			if !errors.As(err, &limited) || !errors.As(err, &failure) || failure.Code != 1 {
				t.Fatalf("missing typed throttle/exit code: %v", err)
			}
			want := RateLimitInfo{Limit: "authenticated_knowledge", RetryAfterSeconds: 7, Capacity: 1200, Remaining: 2, ResetAfterSeconds: 60}
			if limited.RateLimit != want {
				t.Fatalf("metadata = %#v, want %#v", limited.RateLimit, want)
			}
			if calls.Load() != 1 {
				t.Fatalf("retried before advertised cooldown: %d calls", calls.Load())
			}
		})
	}
}

func TestClientRateLimitHeadersWithoutJSON(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "9")
		w.Header().Set("RateLimit-Limit", "10")
		w.Header().Set("RateLimit-Remaining", "0")
		w.Header().Set("RateLimit-Reset", "12")
		http.Error(w, "Too many requests", 429)
	}))
	defer s.Close()
	c, _ := newClient(s.URL)
	_, _, err := c.send("POST", "/api/crew/write", nil, nil, "application/octet-stream", []byte("synthetic source"))
	var limited *RateLimitError
	if !errors.As(err, &limited) || limited.RateLimit.RetryAfterSeconds != 9 || limited.RateLimit.Capacity != 10 || limited.RateLimit.ResetAfterSeconds != 12 {
		t.Fatalf("lost upload throttle headers: %v", err)
	}
}

func TestThrottleWithoutMetadataUsesConservativeFallback(t *testing.T) {
	limited := responseRateLimit("POST", "/api/crew/agent-write", 429, nil, nil)
	if limited.RateLimit.Limit != "unknown" || limited.RateLimit.RetryAfterSeconds != 10 {
		t.Fatalf("unsafe fallback: %+v", limited)
	}
	if responseRateLimit("POST", "/api/crew/agent-write", 409, nil, nil) != nil {
		t.Fatal("conflict treated as throttle")
	}
}

func TestMCPCrewThrottleMetadata(t *testing.T) {
	h := mcpTestHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/crew/agent-write" {
			t.Fatalf("Crew write escaped agent route: %s", r.URL.Path)
		}
		throttleFixture(w, 429)
	}))
	response := mcpRequest(t, h, "synthetic-user-token", "tools/call", map[string]any{"name": "crew_write", "arguments": map[string]any{"action": "task.create", "reported_agent": "Synthetic worker", "data": map[string]any{"title": "Budget boundary"}}})
	result, _ := response["result"].(map[string]any)
	if result["isError"] != true || dig(result, "structuredContent", "error", "code") != "rate_limited" || dig(result, "structuredContent", "error", "rate_limit", "retry_after_seconds") != float64(7) {
		t.Fatalf("Crew throttle lost metadata: %v", response)
	}
}

func TestCrewUnavailableReadRetriesButWriteDoesNot(t *testing.T) {
	for _, path := range []string{"/api/crew/read", "/api/crew/agent-write", "/api/crew/write"} {
		t.Run(path, func(t *testing.T) {
			var calls atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if calls.Add(1) == 1 {
					http.Error(w, "temporarily unavailable", 503)
					return
				}
				_, _ = w.Write([]byte(`{"items":[]}`))
			}))
			defer s.Close()
			c, _ := newClient(s.URL)
			_, err := c.Must("POST", path, map[string]any{})
			if path == "/api/crew/read" {
				if err != nil || calls.Load() != 2 {
					t.Fatalf("read recovery: %v, calls=%d", err, calls.Load())
				}
			} else if err == nil || calls.Load() != 1 {
				t.Fatalf("uncertain write retried: %v, calls=%d", err, calls.Load())
			}
		})
	}
}
