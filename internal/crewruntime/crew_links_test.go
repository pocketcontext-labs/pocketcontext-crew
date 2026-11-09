package crewruntime

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"
)

const linkTestBase = "https://crew.example.test"

func setLinkTestDomain(a *testApp) { a.app.Store().Set(webhookURLStore, linkTestBase) }

func TestCrewSlug(t *testing.T) {
	long := strings.Repeat("a", 100)
	for title, want := range map[string]string{
		"":                               "task",
		"   ":                            "task",
		"!!! ... ???":                    "task",
		"日本語のタイトル":                       "task",
		"Новая задача":                   "task",
		"Launch Post":                    "launch-post",
		"Déjà Vu":                        "deja-vu",
		"Crème brûlée":                   "creme-brulee",
		"Straße":                         "strasse",
		"Æther Ørsted Łódź":              "aether-orsted-lodz",
		"Œuvre þing Đà":                  "oeuvre-thing-da",
		"Ǿ":                              "o",
		"İstanbul":                       "istanbul",
		"  Hello,   World  ":             "hello-world",
		"--Trim me--":                    "trim-me",
		"日本 launch":                      "launch",
		"2026 Q3 plan":                   "2026-q3-plan",
		long:                             strings.Repeat("a", 60),
		strings.Repeat("a", 59) + " bcd": strings.Repeat("a", 59),
		strings.Repeat("a", 60) + " bcd": strings.Repeat("a", 60),
		"!" + strings.Repeat("a", 60):    strings.Repeat("a", 59),
	} {
		if got := crewSlug(title, "task"); got != want {
			t.Errorf("crewSlug(%q) = %q, want %q", title, got, want)
		}
	}
	if got := crewSlug("???", "note"); got != "note" {
		t.Errorf("fallback: %q", got)
	}
}

func assertRecordLink(t *testing.T, name string, got map[string]any, collection, slug, id string, domain bool) {
	t.Helper()
	want := "#/" + collection + "/" + slug + "-" + id
	if got["path"] != want {
		t.Fatalf("%s path: got %v want %s", name, got["path"], want)
	}
	url, present := got["url"]
	if domain && url != linkTestBase+"/"+want {
		t.Fatalf("%s url: %v", name, url)
	}
	if !domain && present {
		t.Fatalf("%s must omit url without a domain: %v", name, url)
	}
}

func TestPermanentLinksOnReadsWritesAndSearch(t *testing.T) {
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
			check := func(label string, got map[string]any, collection, slug, id string) {
				t.Helper()
				assertRecordLink(t, label, got, collection, slug, id, domain)
			}
			read := func(body map[string]any) []map[string]any {
				t.Helper()
				return crewItems(t, crewPost(t, a, "/api/crew/read", body, 200))
			}
			bucket := crewOp(t, a, "bucket.create", nil, map[string]any{"name": "Links"})
			if _, ok := bucket["path"]; ok {
				t.Fatal("bucket gained a link", bucket)
			}
			task := crewOp(t, a, "task.create", nil, map[string]any{"title": "Déjà Vu launch"})
			id := task["id"].(string)
			check("task.create", task, "tasks", "deja-vu-launch", id)
			note := crewOp(t, a, "note.create", nil, map[string]any{"bucket": bucket["id"], "title": "Straße plan", "body": "zebrafinch notes"})
			noteID := note["id"].(string)
			check("note.create", note, "notes", "strasse-plan", noteID)

			// The slug follows the current title; the id stays.
			task = crewOp(t, a, "task.update", task, map[string]any{"title": "Renamed task"})
			check("task.update", task, "tasks", "renamed-task", id)
			task = crewOp(t, a, "task.comment", task, map[string]any{"body": "synthetic comment"})
			check("task.comment", task, "tasks", "renamed-task", id)
			note = crewOp(t, a, "note.update", note, map[string]any{"title": "???"})
			check("note fallback", note, "notes", "note", noteID)

			check("read item", read(map[string]any{"collection": "tasks", "id": id})[0], "tasks", "renamed-task", id)
			check("note item", read(map[string]any{"collection": "notes", "id": noteID})[0], "notes", "note", noteID)
			check("list", read(map[string]any{"collection": "tasks"})[0], "tasks", "renamed-task", id)
			label := crewOp(t, a, "task.update", task, map[string]any{"labels": []string{"ops"}})
			check("label list", read(map[string]any{"collection": "tasks", "label": "ops"})[0], "tasks", "renamed-task", id)

			// Projection selects derived fields and honours the omission.
			projected := read(map[string]any{"collection": "tasks", "id": id, "fields": []string{"path", "url"}})[0]
			check("projected", projected, "tasks", "renamed-task", id)
			wantKeys := 3
			if domain {
				wantKeys = 4
			}
			if len(projected) != wantKeys || projected["title"] != nil {
				t.Fatalf("projection shape: %v", projected)
			}
			if subset := read(map[string]any{"collection": "tasks", "id": id, "fields": []string{"title"}})[0]; subset["path"] != nil || subset["url"] != nil {
				t.Fatalf("unrequested links projected: %v", subset)
			}
			check("note projected", read(map[string]any{"collection": "notes", "id": noteID, "fields": []string{"path", "url"}})[0], "notes", "note", noteID)

			// Archived reads and the archiving write itself.
			archivedTask := crewOp(t, a, "task.update", label, map[string]any{"archived": true})
			check("archive write", archivedTask, "tasks", "renamed-task", id)
			check("archived list", read(map[string]any{"collection": "tasks", "archived": true})[0], "tasks", "renamed-task", id)
			check("archived projected", read(map[string]any{"collection": "tasks", "archived": true, "fields": []string{"path", "url"}})[0], "tasks", "renamed-task", id)
			crewOp(t, a, "note.update", note, map[string]any{"archived": true})
			check("archived note", read(map[string]any{"collection": "notes", "archived": true})[0], "notes", "note", noteID)

			// Search reports the same link from the current title.
			active := crewOp(t, a, "task.create", nil, map[string]any{"title": "Crème zebrafinch"})
			hits := crewItems(t, crewPost(t, a, "/api/crew/search", map[string]any{"query": "zebrafinch"}, 200))
			if len(hits) != 1 || hits[0]["id"] != active["id"] {
				t.Fatalf("search hits: %v", hits)
			}
			check("task hit", hits[0], "tasks", "creme-zebrafinch", active["id"].(string))
			noteHits := crewItems(t, crewPost(t, a, "/api/crew/search", map[string]any{"query": "zebrafinch", "archived": true, "collections": []string{"notes"}}, 200))
			if len(noteHits) != 1 {
				t.Fatalf("note hits: %v", noteHits)
			}
			check("note hit", noteHits[0], "notes", "note", noteID)
		})
	}
}

func TestLinksStayOutOfOtherRecordsAndWebhookURLsStayRedacted(t *testing.T) {
	a := newTestApp(t)
	setLinkTestDomain(a)
	bucket := crewOp(t, a, "bucket.create", nil, map[string]any{"name": "Links"})
	crewOp(t, a, "note.create", nil, map[string]any{"bucket": bucket["id"], "title": "Revisioned note"})
	for _, collection := range []string{"buckets", "note_revisions", "webhook_configs"} {
		for _, item := range crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": collection}, 200)) {
			if item["path"] != nil || item["url"] != nil {
				t.Fatalf("%s gained a link: %v", collection, item)
			}
		}
	}
	for _, collection := range []string{"webhook_configs", "buckets", "note_revisions"} {
		crewPost(t, a, "/api/crew/read", map[string]any{"collection": collection, "fields": []string{"url"}}, 400)
		crewPost(t, a, "/api/crew/read", map[string]any{"collection": collection, "fields": []string{"path"}}, 400)
	}
}

func TestExecutionResultsCarryLinksButStoredRecordsDoNot(t *testing.T) {
	a, _, task, event := webhookFixture(t)
	setLinkTestDomain(a)
	const slug = "synthetic-actionable-task"
	refs := map[string]any{"event_id": event.GetString("event_id"), "epoch": event.GetString("epoch"), "generation": event.GetInt("generation")}
	valid := executionOperation(t, a, "execution.validate", "", 0, refs, "", false, 200)
	assertRecordLink(t, "validate", valid["task"].(map[string]any), "tasks", slug, task.Id, true)

	begin := map[string]any{"role": "dispatcher", "worker_id": "self-worker"}
	for k, v := range refs {
		begin[k] = v
	}
	run := executionOperation(t, a, "execution.begin", "", 0, begin, "links-begin", false, 200)
	assertRecordLink(t, "task_context", run["task_context"].(map[string]any), "tasks", slug, task.Id, true)

	comment, _ := json.Marshal(map[string]any{"action": "task.comment", "id": task.Id, "expected_revision": task.GetInt("revision"), "data": map[string]any{"body": "fenced"}, "idempotency_key": "links-comment", "execution": map[string]any{"id": run["id"], "worker_id": "self-worker", "fence": run["fence"]}})
	first := a.request(t, "POST", "/api/crew/agent-write", a.token, string(comment), 200)
	assertRecordLink(t, "fenced comment", first, "tasks", slug, task.Id, true)
	replay := a.request(t, "POST", "/api/crew/agent-write", a.token, string(comment), 200)
	assertRecordLink(t, "fenced comment replay", replay, "tasks", slug, task.Id, true)

	stored, err := a.app.FindRecordsByFilter("crew_webhook_idempotency", "key='links-begin' || key='links-comment'", "", 10, 0)
	if err != nil || len(stored) != 2 {
		t.Fatal("idempotency entries", len(stored), err)
	}
	for _, entry := range stored {
		raw := entry.GetString("result")
		if strings.Contains(raw, "#/tasks/") || strings.Contains(raw, `"path"`) || strings.Contains(raw, linkTestBase) {
			t.Fatalf("stored result carries a link: %s", raw)
		}
	}
	events, err := a.app.FindRecordsByFilter("crew_events", "parent={:task}", "", 100, 0, map[string]any{"task": task.Id})
	if err != nil || len(events) == 0 {
		t.Fatal("events", len(events), err)
	}
	for _, e := range events {
		raw := e.GetString("changes")
		if strings.Contains(raw, "#/tasks/") || strings.Contains(raw, `"path"`) || strings.Contains(raw, `"url"`) {
			t.Fatalf("event carries a link: %s", raw)
		}
	}
}

func TestWakePayloadCarriesNoLinkOrTitle(t *testing.T) {
	a, _, task, delivery := webhookFixture(t)
	assertWake := func(name, raw, id, base string, titles ...string) {
		t.Helper()
		payload := payloadOf(t, raw)
		keys := make([]string, 0, len(payload))
		for k := range payload {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		want := strings.Fields("capabilities_digest causes config_id destination_version dispatch_mode dispatcher_agent_id epoch event_id event_type instance_id instruction_revision mapping_revision occurred_at protocol_version reason recipient_agent_id recipient_bot_ref schema_version target_agent_id target_kind task_id task_revision task_url wake_generation")
		if strings.Join(keys, " ") != strings.Join(want, " ") {
			t.Fatalf("%s payload keys changed:\n got %v\nwant %v", name, keys, want)
		}
		if payload["task_url"] != base+"/#/tasks/"+id {
			t.Fatalf("%s task_url must stay bare-id: %v", name, payload["task_url"])
		}
		for _, leak := range append(titles, `"title"`, `"path"`, `"url"`) {
			if strings.Contains(raw, leak) {
				t.Fatalf("%s carries %q: %s", name, leak, raw)
			}
		}
	}
	assertWake("local", delivery.GetString("payload"), task.Id, "", task.GetString("title"), "synthetic-actionable-task")

	setLinkTestDomain(a)
	created := webhookOperation(t, a, "task.create", "", 0, map[string]any{"title": "Second wake target", "assigned_agent": task.GetString("assigned_agent"), "readiness": "ready"}, "")
	id := created["id"].(string)
	withDomain, err := a.app.FindFirstRecordByFilter("crew_webhook_deliveries", "task={:task}", map[string]any{"task": id})
	if err != nil {
		t.Fatal(err)
	}
	assertWake("domain", withDomain.GetString("payload"), id, linkTestBase, "Second wake target", "second-wake-target")
}
