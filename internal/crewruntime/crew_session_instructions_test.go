package crewruntime

import (
	"encoding/json"
	"strings"
	"testing"
)

// Editable session instructions (0.21.0): immutable revisions per external
// agent, a restorable built-in default and revision-checked session.update on
// both write routes. All records are synthetic.

func readSession(t *testing.T, a *testApp, agent string) map[string]any {
	t.Helper()
	return crewPost(t, a, "/api/crew/read", map[string]any{"collection": "session", "agent": agent}, 200)
}

func sessionUpdate(t *testing.T, a *testApp, owner bool, revision any, data map[string]any, reported string, want int) map[string]any {
	t.Helper()
	b := map[string]any{"action": "session.update", "data": data, "reported_agent": reported, "reason": "synthetic"}
	if revision != nil {
		b["expected_revision"] = revision
	}
	raw, _ := json.Marshal(b)
	route := "/api/crew/agent-write"
	if owner {
		route = "/api/crew/write"
	}
	return a.request(t, "POST", route, a.token, string(raw), want)
}

func TestSessionInstructionsRevisions(t *testing.T) {
	a := newTestApp(t)
	agent := crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "synthetic-repo", "brief": "Synthetic brief.", "kind": "external"}, 200)
	id := agent["id"].(string)
	initial := readSession(t, a, "synthetic-repo")
	defaultBody, _ := initial["body"].(string)
	if initial["revision"] != float64(0) || initial["is_default"] != true || initial["edited_by"] != "" || !strings.Contains(defaultBody, "## 1. Session name") || strings.Contains(defaultBody, "## Agent brief") {
		t.Fatal("default session", initial)
	}
	if initial["instructions"] != defaultBody+"\n\n## Agent brief\n\nSynthetic brief." {
		t.Fatal("instructions are not the default body plus the brief")
	}
	if rp, _ := initial["rewrite_prompt"].(string); !strings.Contains(rp, `agent "synthetic-repo" (revision 0)`) || !strings.Contains(rp, "session.update") || !strings.Contains(rp, "expected_revision 0") {
		t.Fatal("rewrite prompt", rp)
	}

	// expected_revision is required and must match; exactly one mode.
	sessionUpdate(t, a, true, nil, map[string]any{"agent": id, "instructions": "x"}, "", 400)
	sessionUpdate(t, a, true, 1, map[string]any{"agent": id, "instructions": "x"}, "", 409)
	sessionUpdate(t, a, true, 0, map[string]any{"agent": id}, "", 400)
	sessionUpdate(t, a, true, 0, map[string]any{"agent": id, "instructions": "x", "restore_default": true}, "", 400)
	sessionUpdate(t, a, true, 0, map[string]any{"agent": id, "instructions": "  "}, "", 400)
	sessionUpdate(t, a, true, 0, map[string]any{"agent": id, "instructions": "x", "brief": "y"}, "", 400)
	sessionUpdate(t, a, true, 0, map[string]any{"agent": "synthetic-missing", "instructions": "x"}, "", 404)

	// The owner edits by hand (revision 1).
	first := sessionUpdate(t, a, true, 0, map[string]any{"agent": id, "instructions": "# Synthetic owner text\n\nClaim one task."}, "", 200)
	if first["revision"] != float64(1) || first["is_default"] != false || first["edited_by"] != "owner" || first["body"] != "# Synthetic owner text\n\nClaim one task." {
		t.Fatal("hand edit", first)
	}
	if first["instructions"] != "# Synthetic owner text\n\nClaim one task.\n\n## Agent brief\n\nSynthetic brief." {
		t.Fatal("brief not appended", first["instructions"])
	}
	// A work client updates it by name over agent-write (revision 2); a stale
	// revision is refused.
	sessionUpdate(t, a, false, 0, map[string]any{"agent": "synthetic-repo", "instructions": "stale"}, "synthetic-writer", 409)
	second := sessionUpdate(t, a, false, 1, map[string]any{"agent": "synthetic-repo", "instructions": "Synthetic agent text"}, "synthetic-writer", 200)
	if second["revision"] != float64(2) || second["edited_by"] != "synthetic-writer" || second["edited_at"] == "" {
		t.Fatal("agent edit", second)
	}
	if got := readSession(t, a, id); got["body"] != "Synthetic agent text" || got["revision"] != float64(2) {
		t.Fatal("read after agent edit", got)
	}
	// Restore revision 1 (revision 3), then the default (revision 4), then
	// restoring the default revision again (revision 5).
	sessionUpdate(t, a, true, 2, map[string]any{"agent": id, "restore_revision": 9}, "", 404)
	restored := sessionUpdate(t, a, true, 2, map[string]any{"agent": id, "restore_revision": 1}, "", 200)
	if restored["revision"] != float64(3) || restored["body"] != "# Synthetic owner text\n\nClaim one task." {
		t.Fatal("restore", restored)
	}
	def := sessionUpdate(t, a, false, 3, map[string]any{"agent": id, "restore_default": true}, "synthetic-writer", 200)
	if def["revision"] != float64(4) || def["is_default"] != true || def["body"] != defaultBody {
		t.Fatal("restore default", def)
	}
	sessionUpdate(t, a, true, 4, map[string]any{"agent": id, "restore_revision": 2}, "", 200)
	again := sessionUpdate(t, a, true, 5, map[string]any{"agent": id, "restore_revision": 4}, "", 200)
	if again["is_default"] != true || again["body"] != defaultBody {
		t.Fatal("restoring a default revision", again)
	}

	// History: newest first, by agent ID or name, immutable rows.
	for _, parent := range []string{id, "synthetic-repo"} {
		rows := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "session_revisions", "parent": parent}, 200))
		if len(rows) != 6 || rows[0]["revision"] != float64(6) || rows[5]["revision"] != float64(1) {
			t.Fatal("history", rows)
		}
		if rows[2]["is_default"] != true || rows[2]["instructions"] != defaultBody || rows[4]["edited_by"] != "synthetic-writer" || rows[5]["edited_by"] != "owner" || rows[4]["reason"] != "synthetic" {
			t.Fatal("history rows", rows)
		}
	}
	projected := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "session_revisions", "parent": id, "fields": []string{"edited_by", "created"}, "limit": 1}, 200))
	if len(projected) != 1 || projected[0]["edited_by"] != "owner" || projected[0]["instructions"] != nil {
		t.Fatal("projection", projected)
	}
	// Every change is an event on the agent.
	events := eventsOf(t, a, id, "session.update")
	byRevision := map[float64]map[string]any{}
	reported := map[float64]string{}
	for _, ev := range events {
		changes := map[string]any{}
		if err := json.Unmarshal([]byte(ev.GetString("changes")), &changes); err != nil {
			t.Fatal(err)
		}
		byRevision[changes["revision"].(float64)] = changes
		reported[changes["revision"].(float64)] = ev.GetString("reported_agent")
	}
	if len(events) != 6 || reported[1] != "" || reported[2] != "synthetic-writer" || byRevision[1]["mode"] != "edit" || byRevision[3]["restored_from"] != float64(1) || byRevision[4]["mode"] != "default" || byRevision[6]["is_default"] != true {
		t.Fatal("events", byRevision, reported)
	}
	// SQL sees the history.
	sql := crewSQL(t, a, "SELECT revision, is_default FROM session_revisions WHERE agent='"+id+"' ORDER BY revision", 200)
	if rows, _ := sql["rows"].([]any); len(rows) != 6 {
		t.Fatal("sql", sql)
	}

	// Only external agents, and not while archived.
	bot := crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "synthetic-bot-agent"}, 200)
	sessionUpdate(t, a, true, 0, map[string]any{"agent": bot["id"], "instructions": "x"}, "", 400)
	current := apiWebhookRecord(t, a, "agents", id)
	crewWrite(t, a, false, "agent.update", id, current.GetInt("revision"), map[string]any{"archived": true}, 200)
	sessionUpdate(t, a, true, 6, map[string]any{"agent": id, "instructions": "x"}, "", 400)

	// The brief stays separate: editing it changes the composed text, not the body.
	other := crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "synthetic-other", "kind": "external"}, 200)
	sessionUpdate(t, a, true, 0, map[string]any{"agent": other["id"], "instructions": "Synthetic other"}, "", 200)
	crewWrite(t, a, false, "agent.update", other["id"].(string), int(other["revision"].(float64)), map[string]any{"brief": "New synthetic brief"}, 200)
	if got := readSession(t, a, "synthetic-other"); got["body"] != "Synthetic other" || got["revision"] != float64(1) || got["instructions"] != "Synthetic other\n\n## Agent brief\n\nNew synthetic brief" {
		t.Fatal("brief change", got)
	}
}
