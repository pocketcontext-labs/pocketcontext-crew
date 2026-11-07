package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Concurrent Crew requests must retain all updates and surface revision conflicts.
func TestMCPCrewConcurrentWrites(t *testing.T) {
	api, token := mcpRealAPI(t)
	h := mcpTestHandler(api)
	bucket := mcpCall(t, h, token, "crew_write", map[string]any{"action": "bucket.create", "reported_agent": "Synthetic", "data": map[string]any{"name": "Shared"}}, false)
	start := make(chan struct{})
	results := make(chan error, 8)
	for i := range 8 {
		go func() {
			<-start
			_, err := mcpBulkCall(h, token, "crew_write", map[string]any{"action": "note.create", "reported_agent": fmt.Sprintf("Agent %d", i), "data": map[string]any{"bucket": dig(bucket, "id"), "title": fmt.Sprintf("Note %d", i), "body": "Synthetic concurrent note"}})
			results <- err
		}()
	}
	close(start)
	for range 8 {
		if err := <-results; err != nil {
			t.Error(err)
		}
	}
	notes := mcpCall(t, h, token, "crew_read", map[string]any{"collection": "notes", "parent": dig(bucket, "id")}, false)
	if len(dig(notes, "items").([]any)) != 8 {
		t.Fatalf("lost concurrent writes: %v", notes)
	}
}

// mcpBulkCall is the error-returning counterpart of mcpCall for burst workers.
func mcpBulkCall(h http.Handler, token, name string, args map[string]any) (any, error) {
	payload, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": name, "arguments": args}})
	if err != nil {
		return nil, err
	}
	req := httptest.NewRequest("POST", "https://knowledge.example.com/mcp", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2025-11-25")
	caller := &mcpCaller{ctx: req.Context(), host: req.Host, token: token}
	req = req.WithContext(context.WithValue(req.Context(), mcpRequestContextKey{}, caller))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		return nil, fmt.Errorf("%s: HTTP %d: %s", name, rec.Code, rec.Body)
	}
	var response map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		return nil, err
	}
	if response["error"] != nil || dig(response, "result", "isError") == true {
		return nil, fmt.Errorf("%s: %v", name, response)
	}
	content, _ := dig(response, "result", "content").([]any)
	if len(content) == 0 {
		return nil, fmt.Errorf("%s: missing content", name)
	}
	text, _ := dig(content[0], "text").(string)
	var result any
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		return nil, err
	}
	return result, nil
}
