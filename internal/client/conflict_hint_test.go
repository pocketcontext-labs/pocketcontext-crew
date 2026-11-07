package client

import (
	"strings"
	"testing"
)

func TestConflictHintOnlyForRevisionConflicts(t *testing.T) {
	refusal := map[string]any{"message": "governed", "data": map[string]any{"reason": map[string]any{"code": "execution_required", "message": "governed"}}}
	_, err := checked("POST", "/api/crew/agent-write", 409, refusal)
	if err == nil || strings.Contains(err.Error(), "then retry") || !strings.Contains(err.Error(), "Crew refused this operation (execution_required). Do not retry it unchanged") {
		t.Fatalf("refusal hint wrong: %v", err)
	}
	for _, data := range []any{
		map[string]any{"message": "stale"},
		map[string]any{"message": "stale", "data": map[string]any{"reason": map[string]any{"code": "revision_conflict"}}},
	} {
		_, err := checked("POST", "/api/crew/agent-write", 409, data)
		if err == nil || !strings.Contains(err.Error(), "another request changed the record first") {
			t.Fatalf("revision conflict hint missing: %v", err)
		}
	}
}
