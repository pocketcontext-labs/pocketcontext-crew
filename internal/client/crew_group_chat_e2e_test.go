package client

import (
	"strings"
	"testing"
)

// Exercise the MCP contract used by multilingual clients. Language understanding
// happens in the host chat; these fixtures cover the resulting real tool calls.
func TestCrewMCPGroupChatAcrossLanguages(t *testing.T) {
	api, token := mcpRealAPI(t)
	h := mcpTestHandler(api)
	type args = map[string]any
	read := func(query args) any { return mcpCall(t, h, token, "crew_read", query, false) }
	write := func(action, session string, data args, extra args) any {
		request := args{"action": action, "reported_agent": session, "data": data}
		for key, value := range extra {
			request[key] = value
		}
		return mcpCall(t, h, token, "crew_write", request, false)
	}
	record := func(r any) args {
		return args{"id": dig(r, "id"), "expected_revision": dig(r, "revision")}
	}
	role := func(name string) any { return read(args{"collection": "session", "agent": name}) }
	task := func(id any) any { return dig(read(args{"collection": "tasks", "id": id}), "items").([]any)[0] }
	for _, name := range []string{"Assess", "Learn", "Implement"} {
		write("agent.create", "Setup", args{"name": name, "kind": "external", "brief": "Preserve this specialist brief."}, nil)
	}
	for _, tc := range []struct{ lang, title, rule, answer string }{
		{"en", "Summarize the note", "Reply in English.", "I read the update."},
		{"it", "Riassumi la nota", "Rispondi in italiano.", "Ho letto la modifica."},
		{"de", "Fasse die Notiz zusammen", "Antworte auf Deutsch.", "Ich habe die Änderung gelesen."},
	} {
		t.Logf("checking %s", tc.lang)
		const coordinator = "Assess · laptop · coordinator-session"
		const holder = "Learn · iMac · notes · one-session"
		const other = "Learn · server · analysis · another-session"
		const writingRule = "Save Crew notes in English."
		before := role("Learn")
		write("session.update", coordinator, args{"agent": "Learn", "instructions": writingRule}, args{"expected_revision": dig(before, "revision")})
		preview := role("Learn")
		approved := dig(preview, "body").(string) + "\n" + tc.rule
		write("session.update", coordinator, args{"agent": "Learn", "instructions": approved}, args{"expected_revision": dig(preview, "revision")})
		fresh := role("Learn")
		if dig(preview, "body") != writingRule || dig(fresh, "body") != approved || !strings.Contains(dig(fresh, "instructions").(string), "Preserve this specialist brief.") {
			t.Fatalf("Saved workflow or independent brief lost: %v", fresh)
		}
		parent := write("task.create", coordinator, args{"title": tc.title, "assigned_agent": "Assess", "readiness": "ready"}, nil)
		delegate := func(recipient string) any {
			request := record(task(dig(parent, "id")))
			request["idempotency_key"] = tc.lang + "-ask-" + recipient
			return write("task.delegate", coordinator, args{"assigned_agent": recipient, "title": tc.title}, request)
		}
		write("task.claim", coordinator, args{"assigned_agent": "Assess"}, record(parent))
		child := delegate("Learn")
		delegate("Implement")
		claimed := write("task.claim", holder, args{"assigned_agent": "Learn"}, record(child))
		// The same chat reads another role. The old claim is still held by
		// its original session, including when a second machine checks it.
		role("Implement")
		active := task(dig(child, "id"))
		if dig(active, "claimed_by") != holder {
			t.Fatalf("role switch changed claim: %v", active)
		}
		competing := record(active)
		competing["action"], competing["reported_agent"], competing["data"] = "task.claim", other, args{"assigned_agent": "Learn"}
		mcpCall(t, h, token, "crew_write", competing, true)
		reply := record(claimed)
		reply["idempotency_key"] = tc.lang + "-learn-reply"
		write("task.reply", holder, args{"body": tc.answer}, reply)
		children := dig(read(args{"collection": "tasks", "parent": dig(parent, "id"), "fields": []string{"delegation_reply"}}), "items").([]any)
		if len(children) != 2 {
			t.Fatalf("expected two recipients: %v", children)
		}
		for _, c := range children {
			if dig(c, "id") == dig(child, "id") {
				if dig(c, "delegation_reply", "body") != tc.answer || dig(c, "delegation_reply", "reported_agent") != holder {
					t.Fatalf("lost recipient reply or session: %v", c)
				}
			} else if dig(c, "delegation_reply") != nil {
				t.Fatalf("unanswered recipient appeared to reply: %v", c)
			}
		}
	}
}
