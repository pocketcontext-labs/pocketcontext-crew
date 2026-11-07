package bundle

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"
)

// crewOp performs an owner write; the owner route also covers owner-only archival.
func crewOp(t *testing.T, a *testApp, action string, record map[string]any, data map[string]any) map[string]any {
	t.Helper()
	b := map[string]any{"action": action, "data": data, "reported_agent": "synthetic-test"}
	if record != nil {
		b["id"] = record["id"]
		b["expected_revision"] = record["revision"]
	}
	raw, _ := json.Marshal(b)
	return a.request(t, "POST", "/api/crew/write", a.token, string(raw), 200)
}

func crewPost(t *testing.T, a *testApp, path string, body map[string]any, want int) map[string]any {
	t.Helper()
	raw, _ := json.Marshal(body)
	return a.request(t, "POST", path, a.token, string(raw), want)
}

func crewItems(t *testing.T, result map[string]any) []map[string]any {
	t.Helper()
	list, ok := result["items"].([]any)
	if !ok {
		t.Fatalf("no items: %v", result)
	}
	out := make([]map[string]any, len(list))
	for i, v := range list {
		out[i] = v.(map[string]any)
	}
	return out
}

func crewIDs(items []map[string]any) []string {
	out := []string{}
	for _, v := range items {
		out = append(out, v["id"].(string))
	}
	sort.Strings(out)
	return out
}

func sortedIDs(ids ...any) []string {
	out := []string{}
	for _, v := range ids {
		out = append(out, v.(string))
	}
	sort.Strings(out)
	return out
}

func TestCrewReadTaskFiltersProjectionAndLimits(t *testing.T) {
	a := newTestApp(t)
	alpha := crewOp(t, a, "agent.create", nil, map[string]any{"name": "Alpha"})
	beta := crewOp(t, a, "agent.create", nil, map[string]any{"name": "Beta"})
	t1 := crewOp(t, a, "task.create", nil, map[string]any{"title": "Alpha ready todo", "assigned_agent": alpha["id"], "readiness": "ready", "labels": []string{"ops", "urgent"}})
	t2 := crewOp(t, a, "task.create", nil, map[string]any{"title": "Alpha waiting", "assigned_agent": alpha["id"], "labels": []string{"ops-later"}})
	t2 = crewOp(t, a, "task.update", t2, map[string]any{"status": "in_progress"})
	t3 := crewOp(t, a, "task.create", nil, map[string]any{"title": "Beta ready", "assigned_agent": beta["id"], "readiness": "ready"})
	t4 := crewOp(t, a, "task.create", nil, map[string]any{"title": "Unassigned", "description": strings.Repeat("long body ", 200)})
	t4 = crewOp(t, a, "task.update", t4, map[string]any{"status": "done"})
	archived := crewOp(t, a, "task.create", nil, map[string]any{"title": "Archived alpha", "assigned_agent": alpha["id"], "readiness": "ready"})
	crewOp(t, a, "task.update", archived, map[string]any{"archived": true})
	special := crewOp(t, a, "task.create", nil, map[string]any{"title": "Special 100% label", "labels": []string{`50%_off "q" & <b>`}})
	crewOp(t, a, "task.update", special, map[string]any{"archived": true})

	read := func(body map[string]any) []string {
		t.Helper()
		body["collection"] = "tasks"
		return crewIDs(crewItems(t, crewPost(t, a, "/api/crew/read", body, 200)))
	}
	same := func(name string, got []string, want ...any) {
		t.Helper()
		if fmt.Sprint(got) != fmt.Sprint(sortedIDs(want...)) {
			t.Fatalf("%s: got %v want %v", name, got, sortedIDs(want...))
		}
	}
	same("by name", read(map[string]any{"assigned_agent": "Alpha"}), t1["id"], t2["id"])
	same("by id", read(map[string]any{"assigned_agent": beta["id"]}), t3["id"])
	same("unassigned", read(map[string]any{"assigned_agent": ""}), t4["id"])
	same("ready for alpha", read(map[string]any{"assigned_agent": "Alpha", "readiness": "ready"}), t1["id"])
	same("archived alpha", read(map[string]any{"assigned_agent": "Alpha", "archived": true}), archived["id"])
	same("single status", read(map[string]any{"status": "todo"}), t1["id"], t3["id"])
	same("status list", read(map[string]any{"status": []string{"in_progress", "done"}}), t2["id"], t4["id"])
	same("exact label", read(map[string]any{"label": "ops"}), t1["id"])
	same("label", read(map[string]any{"label": "ops-later"}), t2["id"])
	same("missing label", read(map[string]any{"label": "op"}))
	same("label is case sensitive", read(map[string]any{"label": "OPS"}))
	same("label with filters", read(map[string]any{"label": "ops", "assigned_agent": "Alpha", "readiness": "ready", "status": "todo", "query": "ready"}), t1["id"])
	same("label with other assignee", read(map[string]any{"label": "ops", "assigned_agent": "Beta"}))
	same("special label", read(map[string]any{"label": `50%_off "q" & <b>`, "archived": true}), special["id"])
	same("special label literal", read(map[string]any{"label": `50%`, "archived": true}))
	same("label query keeps PocketBase pattern semantics", read(map[string]any{"label": `50%_off "q" & <b>`, "archived": true, "query": "Special%"}), special["id"])
	same("label query escapes underscore", read(map[string]any{"label": `50%_off "q" & <b>`, "archived": true, "query": "Special_100"}))
	same("future", read(map[string]any{"changed_since": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}))
	same("past", read(map[string]any{"changed_since": "2000-01-01T00:00:00+02:00"}), t1["id"], t2["id"], t3["id"], t4["id"])

	// Projection subsets the normal export and always keeps id and revision.
	items := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "tasks", "id": t4["id"], "fields": []string{"title", "status"}}, 200))
	if len(items) != 1 || len(items[0]) != 4 || items[0]["title"] != "Unassigned" || items[0]["status"] != "done" || items[0]["revision"] != t4["revision"] {
		t.Fatalf("projection: %v", items)
	}
	for _, body := range []map[string]any{
		{"collection": "tasks", "fields": []string{"nope"}},
		{"collection": "tasks", "fields": []string{}},
		{"collection": "tasks", "fields": "title"},
		{"collection": "webhook_configs", "fields": []string{"url"}},
		{"collection": "webhook_configs", "fields": []string{"secret_ciphertext"}},
		{"collection": "webhook_configs", "fields": []string{"secret"}},
		{"collection": "notes", "assigned_agent": "Alpha"},
		{"collection": "events", "status": "todo"},
		{"collection": "tasks", "status": []string{"bogus"}},
		{"collection": "tasks", "readiness": "soon"},
		{"collection": "tasks", "label": ""},
		{"collection": "tasks", "assigned_agent": "Missing agent"},
		{"collection": "tasks", "changed_since": "yesterday"},
		{"collection": "tasks", "changed_since": "2026-01-01"},
		{"collection": "tasks", "limit": 0},
		{"collection": "tasks", "limit": 101},
		{"collection": "tasks", "limit": 1.5},
		{"collection": "tasks", "unknown": true},
	} {
		raw, _ := json.Marshal(body)
		a.request(t, "POST", "/api/crew/read", a.token, string(raw), 400)
	}
	configs := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "webhook_configs", "fields": []string{"secret_configured", "receiver_host", "scope"}}, 200))
	for _, c := range configs {
		if _, leaked := c["url"]; leaked || c["secret_configured"] == nil {
			t.Fatalf("webhook projection: %v", c)
		}
	}
	buckets := crewOp(t, a, "bucket.create", nil, map[string]any{"name": "Ops", "responsible_agent": alpha["id"]})
	got := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "buckets", "id": buckets["id"], "fields": []string{"responsible_agent_details"}}, 200))
	if details, _ := got[0]["responsible_agent_details"].(map[string]any); details["name"] != "Alpha" || got[0]["name"] != nil {
		t.Fatalf("bucket projection: %v", got)
	}

	// Limit pages with the existing offset contract.
	seen := []string{}
	offset := 0
	for pages := 0; ; pages++ {
		page := crewPost(t, a, "/api/crew/read", map[string]any{"collection": "tasks", "limit": 3, "offset": offset, "fields": []string{"title"}}, 200)
		seen = append(seen, crewIDs(crewItems(t, page))...)
		if page["has_more"] != true {
			if page["next_offset"] != nil || pages != 1 {
				t.Fatalf("pagination end: %v after %d pages", page, pages)
			}
			break
		}
		offset = int(page["next_offset"].(float64))
	}
	sort.Strings(seen)
	same("all pages", seen, t1["id"], t2["id"], t3["id"], t4["id"])

	// Omitting the new parameters keeps full records.
	full := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "tasks", "id": t4["id"]}, 200))[0]
	for _, k := range []string{"description", "labels", "draft", "links", "wake_generation", "collectionName", "created", "updated"} {
		if _, ok := full[k]; !ok {
			t.Fatalf("default read lost %s: %v", k, full)
		}
	}
	a.request(t, "POST", "/api/crew/read", "", `{"collection":"tasks","fields":["title"]}`, 401)
}

func TestCrewReadNoteArchiveSemanticsWithProjection(t *testing.T) {
	a := newTestApp(t)
	open := crewOp(t, a, "bucket.create", nil, map[string]any{"name": "Open"})
	closed := crewOp(t, a, "bucket.create", nil, map[string]any{"name": "Closed"})
	n1 := crewOp(t, a, "note.create", nil, map[string]any{"bucket": open["id"], "title": "Visible"})
	n2 := crewOp(t, a, "note.create", nil, map[string]any{"bucket": open["id"], "title": "Archived note"})
	crewOp(t, a, "note.update", n2, map[string]any{"archived": true})
	n3 := crewOp(t, a, "note.create", nil, map[string]any{"bucket": closed["id"], "title": "Under archived bucket"})
	crewOp(t, a, "bucket.update", closed, map[string]any{"archived": true})
	list := func(archived bool) []string {
		return crewIDs(crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "notes", "archived": archived, "fields": []string{"title"}, "limit": 1, "changed_since": "2000-01-01T00:00:00Z"}, 200)))
	}
	if fmt.Sprint(list(false)) != fmt.Sprint(sortedIDs(n1["id"])) {
		t.Fatal("active notes include archived content", list(false))
	}
	all := []string{}
	for offset := 0; offset < 10; offset++ {
		page := crewPost(t, a, "/api/crew/read", map[string]any{"collection": "notes", "archived": true, "fields": []string{"title"}, "limit": 1, "offset": offset}, 200)
		all = append(all, crewIDs(crewItems(t, page))...)
		if page["has_more"] != true {
			break
		}
	}
	sort.Strings(all)
	if fmt.Sprint(all) != fmt.Sprint(sortedIDs(n2["id"], n3["id"])) {
		t.Fatal("archived notes view", all)
	}
}

func crewSearchIDs(t *testing.T, a *testApp, body map[string]any) []string {
	t.Helper()
	out := []string{}
	for _, item := range crewItems(t, crewPost(t, a, "/api/crew/search", body, 200)) {
		out = append(out, item["id"].(string))
	}
	return out
}

func TestCrewSearchRankingFreshnessAndArchive(t *testing.T) {
	a := newTestApp(t)
	agent := crewOp(t, a, "agent.create", nil, map[string]any{"name": "Scout"})
	bucket := crewOp(t, a, "bucket.create", nil, map[string]any{"name": "Research"})
	title := crewOp(t, a, "note.create", nil, map[string]any{"bucket": bucket["id"], "title": "Quokka migration plan", "body": "Overview."})
	body := crewOp(t, a, "note.create", nil, map[string]any{"bucket": bucket["id"], "title": "Weekly digest", "body": "Unrelated items. A brief quokka mention among many other words about weather and harvest."})
	crewOp(t, a, "note.create", nil, map[string]any{"bucket": bucket["id"], "title": "Noise", "body": "Nothing relevant here."})
	task := crewOp(t, a, "task.create", nil, map[string]any{"title": "Count quokkas", "assigned_agent": agent["id"], "readiness": "ready", "draft": "Draft census"})

	result := crewPost(t, a, "/api/crew/search", map[string]any{"query": "quokka"}, 200)
	hits := crewItems(t, result)
	if len(hits) != 2 || hits[0]["id"] != title["id"] || hits[1]["id"] != body["id"] {
		t.Fatalf("title match should outrank body mention: %v", hits)
	}
	first := hits[0]
	if first["collection"] != "notes" || first["bucket"] != bucket["id"] || first["bucket_name"] != "Research" || first["revision"] != float64(1) || first["score"].(float64) <= hits[1]["score"].(float64) {
		t.Fatalf("hit metadata: %v", first)
	}
	if ex := hits[1]["excerpt"].(string); !strings.Contains(ex, "«quokka»") || len(ex) > 800 {
		t.Fatalf("excerpt: %q", ex)
	}
	if _, ok := first["body"]; ok {
		t.Fatal("search returned a full body")
	}
	tasks := crewItems(t, crewPost(t, a, "/api/crew/search", map[string]any{"query": "quokka*", "collections": []string{"tasks"}}, 200))
	if len(tasks) != 1 || tasks[0]["id"] != task["id"] || tasks[0]["status"] != "todo" || tasks[0]["assigned_agent"] != agent["id"] || tasks[0]["assigned_agent_name"] != "Scout" || tasks[0]["readiness"] != "ready" {
		t.Fatalf("task hit: %v", tasks)
	}
	if ids := crewSearchIDs(t, a, map[string]any{"query": "census"}); len(ids) != 1 || ids[0] != task["id"] {
		t.Fatal("draft not searchable", ids)
	}
	if ids := crewSearchIDs(t, a, map[string]any{"query": "quokka weather"}); len(ids) != 1 || ids[0] != body["id"] {
		t.Fatal("all terms must match", ids)
	}

	// Freshness: edits, archive, bucket archive and restore are visible immediately.
	gen := result["generation"].(string)
	edited := crewOp(t, a, "note.update", body, map[string]any{"body": "Now about wombats only."})
	if ids := crewSearchIDs(t, a, map[string]any{"query": "wombats"}); len(ids) != 1 || ids[0] != body["id"] {
		t.Fatal("edit not visible", ids)
	}
	if ids := crewSearchIDs(t, a, map[string]any{"query": "quokka", "collections": []string{"notes"}}); len(ids) != 1 {
		t.Fatal("old content still matches", ids)
	}
	conflict := crewPost(t, a, "/api/crew/search", map[string]any{"query": "quokka", "generation": gen}, 409)
	if conflict["data"].(map[string]any)["generation"] == gen {
		t.Fatal("conflict must report the new generation")
	}
	archivedNote := crewOp(t, a, "note.update", edited, map[string]any{"archived": true})
	if ids := crewSearchIDs(t, a, map[string]any{"query": "wombats"}); len(ids) != 0 {
		t.Fatal("archived note visible", ids)
	}
	if ids := crewSearchIDs(t, a, map[string]any{"query": "wombats", "archived": true}); len(ids) != 1 {
		t.Fatal("archived view lost note", ids)
	}
	crewOp(t, a, "note.update", archivedNote, map[string]any{"archived": false})
	if ids := crewSearchIDs(t, a, map[string]any{"query": "wombats"}); len(ids) != 1 {
		t.Fatal("unarchived note missing", ids)
	}
	archivedBucket := crewOp(t, a, "bucket.update", bucket, map[string]any{"archived": true})
	for _, q := range []string{"wombats", "quokka", "migration"} {
		if ids := crewSearchIDs(t, a, map[string]any{"query": q, "collections": []string{"notes"}}); len(ids) != 0 {
			t.Fatal("notes in archived bucket visible", q, ids)
		}
	}
	if ids := crewSearchIDs(t, a, map[string]any{"query": "migration", "archived": true}); len(ids) != 1 || ids[0] != title["id"] {
		t.Fatal("archived bucket notes missing from archived view", ids)
	}
	crewOp(t, a, "bucket.update", archivedBucket, map[string]any{"archived": false})
	if ids := crewSearchIDs(t, a, map[string]any{"query": "migration"}); len(ids) != 1 {
		t.Fatal("restored bucket notes missing", ids)
	}
	revisions := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "note_revisions", "parent": body["id"]}, 200))
	var original string
	for _, r := range revisions {
		if r["revision"] == float64(1) {
			original = r["id"].(string)
		}
	}
	current := crewItems(t, crewPost(t, a, "/api/crew/read", map[string]any{"collection": "notes", "id": body["id"]}, 200))[0]
	crewOp(t, a, "note.restore", current, map[string]any{"revision_id": original})
	if ids := crewSearchIDs(t, a, map[string]any{"query": "harvest"}); len(ids) != 1 || ids[0] != body["id"] {
		t.Fatal("restored revision not searchable", ids)
	}
	crewOp(t, a, "task.update", task, map[string]any{"archived": true})
	if ids := crewSearchIDs(t, a, map[string]any{"query": "census"}); len(ids) != 0 {
		t.Fatal("archived task visible", ids)
	}

	for _, bad := range []map[string]any{
		{"query": ""},
		{"query": "   "},
		{"query": "x", "limit": 51},
		{"query": "x", "limit": -1},
		{"query": "x", "offset": -1},
		{"query": "x", "collections": []string{"webhook_configs"}},
		{"query": "x", "collections": []string{"notes", "notes"}},
		{"query": strings.Repeat("x", 1025)},
		{"query": "x", "unknown": 1},
	} {
		crewPost(t, a, "/api/crew/search", bad, 400)
	}
	a.request(t, "POST", "/api/crew/search", "", `{"query":"quokka"}`, 401)
	a.request(t, "POST", "/api/crew/search", "not-a-token", `{"query":"quokka"}`, 401)
	// FTS syntax in input is literal text, never an operator.
	crewPost(t, a, "/api/crew/search", map[string]any{"query": `"unbalanced NEAR( title:* -x`}, 200)
}

func TestCrewSearchPaginationIsStable(t *testing.T) {
	a := newTestApp(t)
	bucket := crewOp(t, a, "bucket.create", nil, map[string]any{"name": "Pages"})
	want := map[string]bool{}
	for i := 0; i < 23; i++ {
		n := crewOp(t, a, "note.create", nil, map[string]any{"bucket": bucket["id"], "title": fmt.Sprintf("Lattice note %02d", i), "body": strings.Repeat("lattice ", i%5+1)})
		want[n["id"].(string)] = true
	}
	offset, gen, seen := 0, "", map[string]bool{}
	for pages := 0; pages < 10; pages++ {
		body := map[string]any{"query": "lattice", "limit": 5, "offset": offset}
		if gen != "" {
			body["generation"] = gen
		}
		page := crewPost(t, a, "/api/crew/search", body, 200)
		gen = page["generation"].(string)
		for _, item := range crewItems(t, page) {
			if seen[item["id"].(string)] {
				t.Fatal("duplicate hit across pages")
			}
			seen[item["id"].(string)] = true
		}
		if page["has_more"] != true {
			break
		}
		offset = int(page["next_offset"].(float64))
	}
	if len(seen) != len(want) {
		t.Fatalf("paged %d of %d hits", len(seen), len(want))
	}
}
