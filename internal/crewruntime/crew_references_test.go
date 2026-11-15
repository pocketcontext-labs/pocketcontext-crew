package crewruntime

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// The references resolver (0.29.0) turns ids written in prose into titles and
// reader paths, one batch per request, for every collection the owner reads
// in the reader, and nothing else.
func TestReferencesResolveEveryReaderCollection(t *testing.T) {
	for _, domain := range []bool{false, true} {
		name := "local"
		if domain {
			name = "domain"
		}
		t.Run(name, func(t *testing.T) {
			a := newTestApp(t)
			if domain {
				setLinkTestDomain(a)
			}
			read := func(body map[string]any) []map[string]any {
				t.Helper()
				return crewItems(t, crewPost(t, a, "/api/crew/read", body, 200))
			}
			agent := crewOp(t, a, "agent.create", nil, map[string]any{"name": "Synthetic Builder", "brief": "b"})
			bucket := crewOp(t, a, "bucket.create", nil, map[string]any{"name": "Launch Notes"})
			note := crewOp(t, a, "note.create", nil, map[string]any{"bucket": bucket["id"], "title": "Straße plan", "body": "synthetic"})
			note = crewOp(t, a, "note.update", note, map[string]any{"body": "synthetic two"})
			task := crewOp(t, a, "task.create", nil, map[string]any{"title": "Déjà Vu launch", "draft": "Synthetic draft"})
			task = crewOp(t, a, "task.comment", task, map[string]any{"body": "synthetic comment"})
			crewOp(t, a, "attachment.add", nil, map[string]any{"task": task["id"], "files": []any{
				map[string]any{"name": "notes.txt", "content_base64": "c3ludGhldGlj"}}})
			review := crewOp(t, a, "review.request", task, map[string]any{})
			artifact := crewOp(t, a, "artifact.create", nil, map[string]any{"title": "Partner page", "body": "synthetic"})
			file := read(map[string]any{"collection": "attachments", "parent": task["id"]})[0]
			var comment, create map[string]any
			for _, e := range read(map[string]any{"collection": "events", "parent": task["id"]}) {
				switch e["action"] {
				case "task.comment":
					comment = e
				case "task.create":
					create = e
				}
			}
			revisions := read(map[string]any{"collection": "note_revisions", "parent": note["id"]})
			if comment == nil || create == nil || len(revisions) == 0 {
				t.Fatal("fixture events or revisions missing")
			}
			taskID, noteID := task["id"].(string), note["id"].(string)
			taskPath := "#/tasks/deja-vu-launch-" + taskID
			notePath := "#/notes/strasse-plan-" + noteID
			want := map[string][3]string{
				taskID:                      {"tasks", "Déjà Vu launch", taskPath},
				noteID:                      {"notes", "Straße plan", notePath},
				review["id"].(string):       {"reviews", "Review: Déjà Vu launch", "#/approvals/" + review["id"].(string)},
				bucket["id"].(string):       {"buckets", "Launch Notes", "#/buckets/launch-notes-" + bucket["id"].(string)},
				agent["id"].(string):        {"agents", "Synthetic Builder", "#/agents/synthetic-builder-" + agent["id"].(string)},
				artifact["id"].(string):     {"artifacts", "Partner page", "#/shared/" + artifact["id"].(string)},
				file["id"].(string):         {"attachments", "notes.txt", taskPath + "?file=" + file["id"].(string)},
				comment["id"].(string):      {"comments", "Comment on Déjà Vu launch", taskPath + "?comment=" + comment["id"].(string)},
				create["id"].(string):       {"events", "Activity on Déjà Vu launch", taskPath + "?tab=activity"},
				revisions[0]["id"].(string): {"note_revisions", fmt.Sprintf("Revision %v of Straße plan", revisions[0]["revision"]), notePath},
			}
			ids := []string{"zzzzzzzzzzzzzzz", a.user.Id}
			for id := range want {
				ids = append(ids, id)
			}
			ids = append(ids, taskID) // duplicates resolve once
			got := read(map[string]any{"collection": "references", "ids": ids})
			if len(got) != len(want) {
				t.Fatalf("resolved %d of %d: %v", len(got), len(want), got)
			}
			for _, item := range got {
				w, ok := want[item["id"].(string)]
				if !ok {
					t.Fatalf("unexpected reference: %v", item)
				}
				if item["collection"] != w[0] || item["title"] != w[1] || item["path"] != w[2] {
					t.Fatalf("reference %v, want %v", item, w)
				}
				url, present := item["url"]
				if domain && url != linkTestBase+"/"+w[2] {
					t.Fatalf("url %v for %v", url, item)
				}
				if !domain && present {
					t.Fatalf("url without a domain: %v", item)
				}
				raw, _ := json.Marshal(item)
				for _, leak := range []string{"token", "body", "secret", "fence", "description", "draft"} {
					if strings.Contains(string(raw), `"`+leak) {
						t.Fatalf("reference leaks %s: %s", leak, raw)
					}
				}
			}

			// Archived records still resolve, flagged.
			crewOp(t, a, "bucket.update", bucket, map[string]any{"archived": true})
			for _, item := range read(map[string]any{"collection": "references", "ids": []string{noteID, bucket["id"].(string)}}) {
				if item["archived"] != true {
					t.Fatalf("archived reference not flagged: %v", item)
				}
			}
		})
	}
}

func TestReferencesRejectMalformedRequestsAndSkipWebhookRecords(t *testing.T) {
	a, _, _, event := webhookFixture(t)
	got := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "references", "ids": []string{event.Id, event.GetString("config")}}, 200))
	if len(got) != 0 {
		t.Fatalf("webhook records resolved: %v", got)
	}
	long := make([]string, 101)
	for i := range long {
		long[i] = fmt.Sprintf("a%014d", i)
	}
	for _, body := range []map[string]any{
		{"collection": "references", "ids": long},
		{"collection": "references", "ids": []string{"short"}},
		{"collection": "references", "ids": "abcdefghijklmno"},
		{"collection": "references"},
		{"collection": "references", "ids": []string{}, "fields": []string{"title"}},
		{"collection": "tasks", "ids": []string{"abcdefghijklmno"}},
	} {
		crewPost(t, a, "/api/crew/read", body, 400)
	}
}
