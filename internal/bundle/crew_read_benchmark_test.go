package bundle

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"testing"
)

// TestCrewRetrievalBenchmark compares response sizes and call counts of full
// crew_read pages with compact reads, ranked search and SQL on a synthetic
// dataset. It is skipped unless CREW_READ_BENCH=1:
//
//	CREW_READ_BENCH=1 CGO_ENABLED=1 go test -tags "$(cat build-tags.txt)" ./internal/bundle -run TestCrewRetrievalBenchmark -v
//
// Sizes are HTTP API response bytes (the MCP tool returns the same JSON as
// text); tokens are approximated as bytes/4. Every scenario also checks that
// both approaches produce the same answer.
func TestCrewRetrievalBenchmark(t *testing.T) {
	if os.Getenv("CREW_READ_BENCH") != "1" {
		t.Skip("set CREW_READ_BENCH=1 to run the retrieval benchmark")
	}
	notes, tasks := 500, 300
	a := newTestApp(t)
	rng := rand.New(rand.NewSource(7))
	words := strings.Fields("ledger harbor quarterly signal backlog roadmap vendor invoice latency budget review cohort pipeline onboarding migration audit summary customer feature release incident metric forecast draft policy schedule outreach retention pricing support")
	text := func(n int) string {
		out := make([]string, n)
		for i := range out {
			out[i] = words[rng.Intn(len(words))]
		}
		return strings.Join(out, " ")
	}
	agents := []map[string]any{}
	for _, name := range []string{"Atlas", "Beacon", "Cinder", "Delta", "Ember", "Flint"} {
		agents = append(agents, crewOp(t, a, "agent.create", nil, map[string]any{"name": name, "brief": text(40)}))
	}
	buckets := []map[string]any{}
	for i := 0; i < 10; i++ {
		buckets = append(buckets, crewOp(t, a, "bucket.create", nil, map[string]any{"name": fmt.Sprintf("Bucket %d", i), "purpose": text(20), "responsible_agent": agents[i%len(agents)]["id"]}))
	}
	topical := map[string]bool{}
	var titled string
	for i := 0; i < notes; i++ {
		title, body := "Note "+text(4), text(120+rng.Intn(150))
		switch i {
		case 37:
			title = "Kestrel nesting survey"
		case 111, 222, 333:
			body += " A kestrel was mentioned in passing."
		}
		n := crewOp(t, a, "note.create", nil, map[string]any{"bucket": buckets[i%len(buckets)]["id"], "title": title, "body": body})
		if strings.Contains(strings.ToLower(title+body), "kestrel") {
			topical[n["id"].(string)] = true
		}
		if i == 37 {
			titled = n["id"].(string)
		}
	}
	statuses := []string{"todo", "in_progress", "done"}
	for i := 0; i < tasks; i++ {
		data := map[string]any{"title": "Task " + text(5), "description": text(60 + rng.Intn(60)), "labels": []string{words[rng.Intn(5)]}}
		if rng.Intn(5) > 0 {
			data["assigned_agent"] = agents[rng.Intn(len(agents))]["id"]
		}
		if rng.Intn(3) == 0 {
			data["readiness"] = "ready"
		}
		if rng.Intn(4) == 0 {
			data["draft"] = text(80)
		}
		task := crewOp(t, a, "task.create", nil, data)
		if s := statuses[rng.Intn(len(statuses))]; s != "todo" {
			crewOp(t, a, "task.update", task, map[string]any{"status": s})
		}
	}

	type measure struct {
		calls int
		bytes int
	}
	call := func(m *measure, method, path string, body any) map[string]any {
		t.Helper()
		raw := ""
		if body != nil {
			b, _ := json.Marshal(body)
			raw = string(b)
		}
		req := httptest.NewRequest(method, path, strings.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", a.token)
		rec := httptest.NewRecorder()
		a.handler.ServeHTTP(rec, req)
		if rec.Code != 200 {
			t.Fatalf("%s %s: %d %s", method, path, rec.Code, rec.Body)
		}
		m.calls++
		m.bytes += rec.Body.Len()
		var out map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	readAll := func(m *measure, body map[string]any) []map[string]any {
		out := []map[string]any{}
		for offset := 0; ; {
			body["offset"] = offset
			page := call(m, "POST", "/api/crew/read", body)
			out = append(out, crewItems(t, page)...)
			if page["has_more"] != true {
				return out
			}
			offset = int(page["next_offset"].(float64))
		}
	}
	report := []string{}
	row := func(name string, old, compact measure) {
		report = append(report, fmt.Sprintf("%-34s old %2d calls %8d B ~%6d tok | new %2d calls %7d B ~%5d tok | %5.1fx smaller", name, old.calls, old.bytes, old.bytes/4, compact.calls, compact.bytes, compact.bytes/4, float64(old.bytes)/float64(max(compact.bytes, 1))))
	}
	target := agents[1]

	// (a) Startup: ready tasks assigned to one agent.
	var oldA, newA measure
	readAll(&oldA, map[string]any{"collection": "agents"})
	wantA := []string{}
	for _, task := range readAll(&oldA, map[string]any{"collection": "tasks"}) {
		if task["assigned_agent"] == target["id"] && task["readiness"] == "ready" {
			wantA = append(wantA, task["id"].(string))
		}
	}
	gotA := crewIDs(crewItems(t, call(&newA, "POST", "/api/crew/read", map[string]any{"collection": "tasks", "assigned_agent": target["name"], "readiness": "ready", "fields": []string{"title", "status"}, "limit": 100})))
	sort.Strings(wantA)
	if fmt.Sprint(wantA) != fmt.Sprint(gotA) || len(gotA) == 0 {
		t.Fatalf("startup answers differ: %v vs %v", wantA, gotA)
	}
	row("(a) startup: assigned+ready", oldA, newA)

	// (b) Pick a task: read it and its recent history.
	pick := gotA[0]
	var oldB, newB measure
	full := crewItems(t, call(&oldB, "POST", "/api/crew/read", map[string]any{"collection": "tasks", "id": pick}))[0]
	readAll(&oldB, map[string]any{"collection": "events", "parent": pick})
	compact := crewItems(t, call(&newB, "POST", "/api/crew/read", map[string]any{"collection": "tasks", "id": pick, "fields": []string{"title", "description", "status", "draft"}}))[0]
	call(&newB, "POST", "/api/crew/read", map[string]any{"collection": "events", "parent": pick, "fields": []string{"action", "reported_agent", "created"}, "limit": 10})
	if compact["title"] != full["title"] || compact["description"] != full["description"] || compact["revision"] != full["revision"] {
		t.Fatal("picked task differs")
	}
	row("(b) pick a task", oldB, newB)

	// (c) Memory lookup for a topic.
	var oldC, newC measure
	matches := readAll(&oldC, map[string]any{"collection": "notes", "query": "kestrel"})
	hits := crewItems(t, call(&newC, "POST", "/api/crew/search", map[string]any{"query": "kestrel", "collections": []string{"notes"}, "limit": 5}))
	top := crewItems(t, call(&newC, "POST", "/api/crew/read", map[string]any{"collection": "notes", "id": hits[0]["id"], "fields": []string{"title", "body"}}))[0]
	oldSet, newSet := map[string]bool{}, map[string]bool{}
	for _, n := range matches {
		oldSet[n["id"].(string)] = true
	}
	for _, h := range hits {
		newSet[h["id"].(string)] = true
	}
	if fmt.Sprint(oldSet) != fmt.Sprint(topical) || fmt.Sprint(newSet) != fmt.Sprint(topical) || top["id"] != titled {
		t.Fatalf("topic answers differ: old %v new %v top %v", oldSet, newSet, top["id"])
	}
	row("(c) memory lookup (topic)", oldC, newC)

	// (d) Report: open task counts by status and assignee.
	var oldD, newD measure
	wantD := map[string]int{}
	for _, task := range readAll(&oldD, map[string]any{"collection": "tasks"}) {
		wantD[fmt.Sprintf("%v|%v", task["status"], task["assigned_agent"])]++
	}
	got := call(&newD, "POST", "/api/crew/query", map[string]any{"sql": "SELECT status, assigned_agent, count(*) FROM tasks WHERE archived = 0 GROUP BY 1, 2"})
	gotD := map[string]int{}
	for _, r := range got["rows"].([]any) {
		v := r.([]any)
		gotD[fmt.Sprintf("%v|%v", v[0], v[1])] = int(v[2].(float64))
	}
	if fmt.Sprint(wantD) != fmt.Sprint(gotD) {
		t.Fatalf("report answers differ: %v vs %v", wantD, gotD)
	}
	row("(d) counts by status/assignee", oldD, newD)
	t.Logf("synthetic dataset: %d notes, %d tasks, %d agents, %d buckets\n%s", notes, tasks, len(agents), len(buckets), strings.Join(report, "\n"))
}
