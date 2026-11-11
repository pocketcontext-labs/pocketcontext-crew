package crewruntime

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
)

func crewSQL(t *testing.T, a *testApp, sql string, want int) map[string]any {
	t.Helper()
	return crewPost(t, a, "/api/crew/query", map[string]any{"sql": sql}, want)
}

func TestCrewSQLSchemaMatchesAllowlist(t *testing.T) {
	a := newTestApp(t)
	a.request(t, "GET", "/api/crew/schema", "", "", 401)
	a.request(t, "POST", "/api/crew/query", "", `{"sql":"SELECT 1"}`, 401)
	a.request(t, "POST", "/api/crew/query", "not-a-token", `{"sql":"SELECT 1"}`, 401)
	schema := a.request(t, "GET", "/api/crew/schema", a.token, "", 200)
	names := []string{}
	columns := map[string]map[string]bool{}
	for _, raw := range schema["tables"].([]any) {
		table := raw.(map[string]any)
		name := table["name"].(string)
		names = append(names, name)
		columns[name] = map[string]bool{}
		for _, c := range table["columns"].([]any) {
			columns[name][c.(map[string]any)["name"].(string)] = true
		}
	}
	sort.Strings(names)
	if fmt.Sprint(names) != "[agents attachments buckets events note_revisions notes reviews tasks webhook_attempts webhook_bridges webhook_configs webhook_deliveries webhook_executions webhook_mappings webhook_routing]" {
		t.Fatalf("schema views: %v", names)
	}
	if schema["limits"].(map[string]any)["max_rows"] != float64(crewSQLMaxRows) {
		t.Fatal("schema omits limits", schema["limits"])
	}
	for view, excluded := range map[string][]string{
		"webhook_configs":    {"url", "secret_ciphertext"},
		"webhook_executions": {"worker_id", "dispatch_worker_id", "fence", "dispatch_fence"},
		"webhook_bridges":    {"wake_worker_id"},
		"attachments":        {"file"},
	} {
		for _, c := range excluded {
			if columns[view][c] {
				t.Fatalf("%s exposes %s", view, c)
			}
		}
	}
	// SQL never returns more than crew_read: every SQL column must be a field
	// that crew_read itself can project for the same collection.
	for view, cols := range columns {
		fields := []string{}
		for c := range cols {
			fields = append(fields, c)
		}
		raw, _ := json.Marshal(map[string]any{"collection": view, "fields": fields, "limit": 1})
		a.request(t, "POST", "/api/crew/read", a.token, string(raw), 200)
	}
}

func TestCrewSQLRejectsSecretsInternalTablesAndMutation(t *testing.T) {
	a, config, task, _ := webhookFixture(t)
	apiWebhookAccept(t, a)
	// Synthetic fixture values that must never appear in SQL output.
	secrets := []string{"93.184.216.34", "synthetic-bearer", config.GetString("secret_ciphertext")}
	if config.GetString("secret_ciphertext") == "" || config.GetString("url") == "" {
		t.Fatal("fixture lacks credentials")
	}
	for _, view := range []string{"webhook_configs", "webhook_deliveries", "webhook_attempts", "webhook_executions", "webhook_bridges", "webhook_mappings", "webhook_routing", "events", "tasks"} {
		result := crewSQL(t, a, "SELECT * FROM "+view, 200)
		raw, _ := json.Marshal(result)
		for _, s := range secrets {
			if strings.Contains(string(raw), s) {
				t.Fatalf("%s leaked credential material", view)
			}
		}
	}
	for _, q := range []string{
		"SELECT url FROM webhook_configs", "SELECT secret_ciphertext FROM webhook_configs",
		"SELECT url FROM crew_webhook_configs", "SELECT secret_ciphertext FROM crew_webhook_configs",
		"SELECT * FROM crew_webhook_configs", "SELECT * FROM main.crew_webhook_configs",
		"SELECT worker_id FROM webhook_executions", "SELECT fence FROM crew_webhook_executions",
		"SELECT dispatch_worker_id FROM crew_webhook_executions", "SELECT dispatch_fence FROM webhook_executions",
		"SELECT wake_worker_id FROM crew_webhook_bridges", "SELECT wake_worker_id FROM webhook_bridges",
		"SELECT * FROM crew_webhook_idempotency", "SELECT count(*) FROM crew_webhook_idempotency", "SELECT fingerprint FROM crew_webhook_idempotency",
		"SELECT * FROM users", "SELECT email FROM users", "SELECT tokenKey FROM users", "SELECT password FROM users", "SELECT count(*) FROM users",
		"SELECT * FROM _superusers", "SELECT * FROM _mfas", "SELECT * FROM _otps", "SELECT * FROM _authOrigins", "SELECT * FROM _externalAuths",
		"SELECT * FROM _params", "SELECT * FROM _collections", "SELECT * FROM _migrations", "SELECT * FROM sqlite_master", "SELECT * FROM sqlite_temp_master",
		"SELECT id FROM tasks WHERE EXISTS (SELECT 1 FROM users)", "SELECT (SELECT url FROM crew_webhook_configs LIMIT 1)",
		"SELECT * FROM pragma_table_info('crew_webhook_configs')", "PRAGMA table_info(webhook_configs)", "PRAGMA query_only=0",
		"UPDATE crew_tasks SET title='x'", "DELETE FROM crew_tasks", "INSERT INTO crew_events(id) VALUES('x') RETURNING id",
		"DROP VIEW tasks", "CREATE TEMP VIEW leak AS SELECT url FROM crew_webhook_configs", "ATTACH ':memory:' AS x",
		"VACUUM", "VACUUM INTO 'copy.db'", "BEGIN", "SELECT load_extension('x')", "SELECT readfile('data.db')",
		"SELECT 1; SELECT 2", "",
	} {
		crewSQL(t, a, q, 400)
	}
	a.request(t, "POST", "/api/crew/query", a.token, `{"sql":"SELECT 1","format":"csv"}`, 400)
	current := apiWebhookRecord(t, a, "tasks", task.Id)
	if current.GetString("title") != task.GetString("title") || current.GetInt("revision") != task.GetInt("revision") {
		t.Fatal("rejected SQL mutated a task")
	}
	got := crewSQL(t, a, "SELECT id, enabled, destination_version FROM webhook_configs WHERE scope='global'", 200)
	if rows := got["rows"].([]any); len(rows) != 1 || rows[0].([]any)[0] != config.Id {
		t.Fatal("non-secret webhook columns unreadable", got)
	}
}

func TestCrewSQLReadsLimitsAndArchivedRecords(t *testing.T) {
	a := newTestApp(t)
	alpha := crewOp(t, a, "agent.create", nil, map[string]any{"name": "Alpha"})
	bucket := crewOp(t, a, "bucket.create", nil, map[string]any{"name": "Box"})
	note := crewOp(t, a, "note.create", nil, map[string]any{"bucket": bucket["id"], "title": "Kept"})
	crewOp(t, a, "note.update", note, map[string]any{"title": "Kept v2"})
	for i := 0; i < 3; i++ {
		crewOp(t, a, "task.create", nil, map[string]any{"title": fmt.Sprintf("T%d", i), "assigned_agent": alpha["id"], "labels": []string{"x"}})
	}
	gone := crewOp(t, a, "task.create", nil, map[string]any{"title": "Gone"})
	crewOp(t, a, "task.update", gone, map[string]any{"archived": true})
	crewOp(t, a, "bucket.update", bucket, map[string]any{"archived": true})

	got := crewSQL(t, a, `SELECT COALESCE(a.name,'(unassigned)') AS assignee, t.status, count(*) AS n
FROM tasks t LEFT JOIN agents a ON a.id = t.assigned_agent WHERE t.archived = 0 GROUP BY 1, 2 ORDER BY 1`, 200)
	if fmt.Sprint(got["columns"]) != "[assignee status n]" || fmt.Sprint(got["rows"]) != "[[Alpha todo 3]]" || got["truncated"] != false {
		t.Fatalf("aggregate: %v", got)
	}
	if rows := crewSQL(t, a, "SELECT count(*) FROM tasks", 200)["rows"].([]any); rows[0].([]any)[0] != float64(4) {
		t.Fatal("SQL must include archived tasks", rows)
	}
	archived := crewSQL(t, a, "SELECT n.title FROM notes n JOIN buckets b ON b.id = n.bucket WHERE n.archived = 0 AND b.archived = 1", 200)
	if fmt.Sprint(archived["rows"]) != "[[Kept v2]]" {
		t.Fatal("bucket archive state not visible", archived)
	}
	history := crewSQL(t, a, "SELECT r.revision, r.title FROM note_revisions r WHERE r.note = '"+note["id"].(string)+"' ORDER BY r.revision", 200)
	if fmt.Sprint(history["rows"]) != "[[1 Kept] [2 Kept v2]]" {
		t.Fatal("history", history)
	}
	labels := crewSQL(t, a, "SELECT j.value, count(*) FROM tasks t, json_each(t.labels) j GROUP BY 1", 200)
	if fmt.Sprint(labels["rows"]) != "[[x 3]]" {
		t.Fatal("json_each", labels)
	}
	if n := len(crewSQL(t, a, "SELECT id FROM events", 200)["rows"].([]any)); n == 0 {
		t.Fatal("events unreadable")
	}
	many := crewSQL(t, a, "WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n < 5000) SELECT n FROM x", 200)
	if len(many["rows"].([]any)) != crewSQLMaxRows || many["truncated"] != true {
		t.Fatal("row limit not applied")
	}
	big := crewSQL(t, a, "WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n < 900) SELECT n, printf('%.2000c', 'x') FROM x", 200)
	if raw, _ := json.Marshal(big); big["truncated"] != true || len(raw) > crewSQLMaxBytes {
		t.Fatal("byte limit not applied", len(raw))
	}
	slow := crewSQL(t, a, "WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x) SELECT sum(n) FROM x", 408)
	if !strings.Contains(fmt.Sprint(slow["message"]), "deadline") {
		t.Fatal(slow)
	}
	// Writes are visible to later SQL reads of the working copy.
	crewOp(t, a, "task.create", nil, map[string]any{"title": "Fresh"})
	if rows := crewSQL(t, a, "SELECT count(*) FROM tasks WHERE title = 'Fresh'", 200)["rows"].([]any); rows[0].([]any)[0] != float64(1) {
		t.Fatal("fresh write invisible", rows)
	}
	req := httptest.NewRequest("POST", "/api/crew/query", strings.NewReader(`{"sql":"`+strings.Repeat("x", 140000)+`"}`))
	req.Header.Set("Authorization", a.token)
	rec := httptest.NewRecorder()
	a.handler.ServeHTTP(rec, req)
	if rec.Code != 400 {
		t.Fatalf("oversized body: %d", rec.Code)
	}
}
