package client

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// runCLI runs one command in this process with the given standard input and
// returns its exit code, standard output and standard error.
func runCLI(t *testing.T, stdin string, argv ...string) (int, string, string) {
	t.Helper()
	dir := t.TempDir()
	in, err := os.Create(filepath.Join(dir, "stdin"))
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	if _, err := in.WriteString(stdin); err != nil {
		t.Fatal(err)
	}
	if _, err := in.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	out, err := os.Create(filepath.Join(dir, "stdout"))
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	savedIn, savedOut := os.Stdin, os.Stdout
	os.Stdin, os.Stdout = in, out
	var stderr bytes.Buffer
	code := commandResult(run(argv), &stderr)
	os.Stdin, os.Stdout = savedIn, savedOut
	written, err := os.ReadFile(out.Name())
	if err != nil {
		t.Fatal(err)
	}
	return code, string(written), stderr.String()
}

func TestCrewCommandInputRejectedBeforeServer(t *testing.T) {
	db := filepath.Join(t.TempDir(), "never", "pocketcontext.db")
	t.Setenv("POCKETCONTEXT_URL", "")
	cases := []struct {
		args  []string
		stdin string
		want  string
	}{
		{[]string{"read", `{"collection":`}, "", "not valid JSON"},
		{[]string{"read", `["agents"]`}, "", "must be a JSON object"},
		{[]string{"read", `{"collection":"agents"} {"collection":"notes"}`}, "", "exactly one JSON object"},
		{[]string{"read", `{"collection":"agents","colection":"x"}`}, "", "colection"},
		{[]string{"read", `{"collection":"agents","limit":"5"}`}, "", "invalid input"},
		{[]string{"read", `{}`}, "", "collection"},
		{[]string{"read", " "}, "", "empty"},
		{[]string{"read", "-"}, "  \n", "standard input is empty"},
		{[]string{"read", "-"}, `{"collection":"agents","unknown":1}`, "unknown"},
		{[]string{"read"}, "", "usage: pocketcontext-crew read JSON|-"},
		{[]string{"read", "{}", "{}"}, "", "usage: pocketcontext-crew read JSON|-"},
		{[]string{"search", `{"collections":["notes"]}`}, "", "query"},
		{[]string{"schema", `{}`}, "", "usage: pocketcontext-crew schema"},
		{[]string{"query", `{"sql":"SELECT 1","limit":3}`}, "", "limit"},
		{[]string{"query", `{"sql":"` + strings.Repeat(" ", crewSQLLimit+1) + `SELECT 1"}`}, "", "SQL exceeds 64 KiB"},
		{[]string{"write", `{"action":"task.create","reported_agent":"Synthetic"}`}, "", "data"},
		{[]string{"write", `{"action":"task.create","reported_agent":"Synthetic","data":{},"owner":true}`}, "", "owner"},
		{[]string{"write", `{"action":"task.create","reported_agent":"Synthetic","data":[]}`}, "", "invalid input"},
		{[]string{"read", "--limit", "3", `{"collection":"agents"}`}, "", "unknown option --limit"},
	}
	for _, c := range cases {
		code, out, stderr := runCLI(t, c.stdin, append(c.args, "--db", db)...)
		if code != 2 || out != "" || !strings.Contains(stderr, c.want) {
			t.Errorf("%v: exit %d, stdout %q, stderr %q; want exit 2 mentioning %q", c.args, code, out, stderr, c.want)
		}
	}
	if _, err := os.Stat(filepath.Dir(db)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("rejected input created a project: %v", err)
	}
}

// A capturing API records what each path sends. The CLI and MCP must send the
// same request for the same input.
type capturedCall struct {
	Method, Path string
	Body         any
}

func capturingAPI(t *testing.T, calls *[]capturedCall) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body any
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &body); err != nil {
				t.Errorf("non-JSON body: %s", raw)
			}
		}
		*calls = append(*calls, capturedCall{r.Method, r.URL.Path, body})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[],"has_more":false}`))
	})
}

func TestCrewCommandsMatchMCPRequests(t *testing.T) {
	var cliCalls, mcpCalls []capturedCall
	server := httptest.NewServer(capturingAPI(t, &cliCalls))
	defer server.Close()
	c := &Client{Base: server.URL, token: "synthetic", http: server.Client()}
	h := mcpTestHandler(capturingAPI(t, &mcpCalls))
	inputs := []struct {
		command, tool string
		input         map[string]any
	}{
		{"read", "crew_read", map[string]any{"collection": "agents"}},
		{"read", "crew_read", map[string]any{"collection": "tasks", "id": "abcdefghijklmno", "parent": "p", "query": "q", "archived": true, "offset": 3, "limit": 5, "fields": []any{"title"}, "assigned_agent": "", "status": []any{"todo", "done"}, "readiness": "ready", "label": "optics", "changed_since": "2000-01-01T00:00:00Z"}},
		{"read", "crew_read", map[string]any{"collection": "buckets", "responsible_agent": "Build"}},
		{"search", "crew_search", map[string]any{"query": "heliograph"}},
		{"search", "crew_search", map[string]any{"query": "x*", "collections": []any{"notes"}, "limit": 2, "offset": 2, "archived": true, "generation": "g1"}},
		{"schema", "crew_schema", map[string]any{}},
		{"query", "crew_query", map[string]any{"sql": "SELECT count(*) FROM tasks"}},
		{"write", "crew_write", map[string]any{"action": "task.create", "reported_agent": "Synthetic", "data": map[string]any{"title": "T", "labels": []any{"a"}}}},
		{"write", "crew_write", map[string]any{"action": "task.comment", "id": "abcdefghijklmno", "expected_revision": 4, "reported_agent": "Synthetic", "reason": "r", "idempotency_key": "k", "execution": map[string]any{"id": "e", "worker_id": "w", "fence": 2}, "data": map[string]any{"body": "b"}}},
	}
	for _, in := range inputs {
		raw, _ := json.Marshal(in.input)
		a := &args{pos: []string{string(raw)}, flags: map[string]string{}, bools: map[string]bool{}}
		if in.command == "schema" {
			a.pos = nil
		}
		var err error
		if a.crew, err = prepareCrewCommand(in.command, a); err != nil {
			t.Fatalf("%s %s: %v", in.command, raw, err)
		}
		savedOut := os.Stdout
		os.Stdout, _ = os.Open(os.DevNull)
		err = runData(c, in.command, a, false)
		os.Stdout.Close()
		os.Stdout = savedOut
		if err != nil {
			t.Fatalf("%s: %v", in.command, err)
		}
		mcpCall(t, h, "synthetic", in.tool, in.input, false)
	}
	if len(cliCalls) != len(inputs) || !reflect.DeepEqual(cliCalls, mcpCalls) {
		t.Fatalf("CLI and MCP requests differ:\nCLI %v\nMCP %v", cliCalls, mcpCalls)
	}
	for i, call := range cliCalls {
		if inputs[i].command == "write" && call.Path != "/api/crew/agent-write" {
			t.Fatalf("write used %s", call.Path)
		}
	}
}

func TestCrewCommandConflictsAndRefusalsAreDistinct(t *testing.T) {
	responses := map[string]struct {
		status int
		body   string
	}{
		"stale":   {409, `{"message":"Revision conflict; reread and reassess"}`},
		"coded":   {409, `{"message":"stale","data":{"reason":{"code":"revision_conflict","message":"stale"}}}`},
		"limited": {409, `{"message":"stopped","data":{"reason":{"code":"handoff_limited","message":"stopped"}}}`},
		"owner":   {403, `{"message":"Enter webhook credentials in the owner UI"}`},
		"busy":    {429, `{"message":"slow down","data":{"rate_limit":{"limit":"crew-write","retry_after_seconds":7}}}`},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		response := responses[body["reason"].(string)]
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(response.status)
		_, _ = w.Write([]byte(response.body))
	}))
	defer server.Close()
	c := &Client{Base: server.URL, token: "synthetic", http: server.Client()}
	result := func(reason string) (int, string) {
		raw, _ := json.Marshal(map[string]any{"action": "task.update", "id": "abcdefghijklmno", "expected_revision": 1, "reported_agent": "Synthetic", "reason": reason, "data": map[string]any{}})
		a := &args{pos: []string{string(raw)}, flags: map[string]string{}, bools: map[string]bool{}}
		var err error
		if a.crew, err = prepareCrewCommand("write", a); err != nil {
			t.Fatal(err)
		}
		var stderr bytes.Buffer
		return commandResult(runData(c, "write", a, false), &stderr), stderr.String()
	}
	for _, reason := range []string{"stale", "coded"} {
		code, stderr := result(reason)
		if code != 4 || !strings.Contains(stderr, "another request changed the record first") || strings.Contains(stderr, "Crew refused") {
			t.Fatalf("%s: exit %d %s", reason, code, stderr)
		}
	}
	code, stderr := result("limited")
	if code != 4 || !strings.Contains(stderr, "Crew refused this operation (handoff_limited). Do not retry it unchanged") || strings.Contains(stderr, "then retry") {
		t.Fatalf("refusal: exit %d %s", code, stderr)
	}
	if code, stderr = result("owner"); code != 1 || !strings.Contains(stderr, "HTTP 403") {
		t.Fatalf("credentials refusal: exit %d %s", code, stderr)
	}
	if code, stderr = result("busy"); code != 1 || !strings.Contains(stderr, "Retry after 7 seconds") {
		t.Fatalf("rate limit: exit %d %s", code, stderr)
	}
}

// The commands against a real server through the local key, including stdin
// input, the agent-route boundary, handoff counting and revision conflicts.
func TestCrewCommandsRealWorkflow(t *testing.T) {
	p := realTestProject(t)
	db := p.DB
	call := func(stdin string, argv ...string) any {
		t.Helper()
		code, out, stderr := runCLI(t, stdin, append(argv, "--db", db)...)
		if code != 0 {
			t.Fatalf("%v: exit %d: %s", argv, code, stderr)
		}
		var v any
		if err := json.Unmarshal([]byte(out), &v); err != nil {
			t.Fatalf("%v: %v: %q", argv, err, out)
		}
		return v
	}
	refused := func(wantCode int, want string, argv ...string) string {
		t.Helper()
		code, out, stderr := runCLI(t, "", append(argv, "--db", db)...)
		if code != wantCode || out != "" || !strings.Contains(stderr, want) {
			t.Fatalf("%v: exit %d (want %d), stdout %q, stderr %q", argv, code, wantCode, out, stderr)
		}
		return stderr
	}
	write := func(action string, record any, data map[string]any) string {
		in := map[string]any{"action": action, "reported_agent": "Build", "reason": "Synthetic CLI rehearsal", "data": data}
		if record != nil {
			in["id"], in["expected_revision"] = dig(record, "id"), dig(record, "revision")
		}
		raw, _ := json.Marshal(in)
		return string(raw)
	}
	agent := call("", "write", write("agent.create", nil, map[string]any{"name": "Build"}))
	other := call("", "write", write("agent.create", nil, map[string]any{"name": "Design"}))
	bucket := call("", "write", write("bucket.create", nil, map[string]any{"name": "BUILD", "responsible_agent": "Build"}))
	note := call(write("note.create", nil, map[string]any{"bucket": dig(bucket, "id"), "title": "Heliograph signalling", "body": "Mirrors flash Morse over long distances."}), "write", "-")
	task := call("", "write", write("task.create", nil, map[string]any{"title": "Calibrate heliograph", "assigned_agent": dig(agent, "id"), "draft": "Synthetic draft", "readiness": "ready"}))

	hits := dig(call("", "search", `{"query":"heliograph","collections":["notes"]}`), "items").([]any)
	if len(hits) != 1 || dig(hits[0], "id") != dig(note, "id") {
		t.Fatalf("search: %v", hits)
	}
	items := dig(call(`{"collection":"tasks","assigned_agent":"Build","readiness":"ready","fields":["title"]}`, "read", "-", "--pretty"), "items").([]any)
	if len(items) != 1 || len(items[0].(map[string]any)) != 3 || dig(items[0], "title") != "Calibrate heliograph" {
		t.Fatalf("compact read: %v", items)
	}
	schema, _ := json.Marshal(call("", "schema"))
	if !bytes.Contains(schema, []byte(`"tasks"`)) || bytes.Contains(schema, []byte("secret_ciphertext")) {
		t.Fatalf("schema: %s", schema)
	}
	rows, _ := json.Marshal(dig(call("", "query", `{"sql":"SELECT a.name, count(*) FROM tasks t JOIN agents a ON a.id = t.assigned_agent WHERE t.archived = 0 GROUP BY 1"}`), "rows"))
	if string(rows) != `[["Build",1]]` {
		t.Fatalf("query rows: %s", rows)
	}
	refused(1, "HTTP 400", "query", `{"sql":"DELETE FROM crew_tasks"}`)

	// Comments are agent comments (never wakes); the event records the agent actor.
	call("", "write", write("task.comment", task, map[string]any{"body": "Synthetic progress."}))
	events := dig(call("", "read", `{"collection":"events","parent":"`+dig(task, "id").(string)+`"}`), "items").([]any)
	commented := false
	for _, e := range events {
		if dig(e, "action") == "task.comment" {
			actor, _ := dig(e, "actor").(string)
			commented = strings.HasPrefix(actor, "mcp:") && dig(e, "reported_agent") == "Build"
		}
	}
	if !commented {
		t.Fatalf("comment not recorded as an agent comment: %v", events)
	}

	// Work clients have the reader's operations: a delegated review decision,
	// bucket archival and agent deactivation all apply through write.
	review := call("", "write", write("review.request", task, map[string]any{}))
	decided := call("", "write", write("review.decide", review, map[string]any{"decision": "approved"}))
	if dig(decided, "status") != "approved" || !strings.HasPrefix(dig(decided, "decided_by").(string), "mcp:") || dig(decided, "reported_agent") != "Build" {
		t.Fatalf("delegated decision: %v", decided)
	}
	archivedBucket := call("", "write", write("bucket.update", bucket, map[string]any{"archived": true}))
	bucket = call("", "write", write("bucket.update", archivedBucket, map[string]any{"archived": false}))
	inactive := call("", "write", write("agent.update", other, map[string]any{"archived": true}))
	other = call("", "write", write("agent.update", inactive, map[string]any{"archived": false}))
	if dig(bucket, "archived") != false || dig(other, "archived") != false {
		t.Fatalf("restore through write: %v %v", bucket, other)
	}
	// Credential entry stays reader-only.
	refused(1, "HTTP 403", "write", `{"action":"webhook.credentials.update","id":"abcdefghijklmno","expected_revision":1,"reported_agent":"Build","data":{"secret":"synthetic-never-save"}}`)

	// A stale revision is a plain revision conflict: exit 4 with the reread hint.
	current := call("", "write", write("note.update", note, map[string]any{"body": "Updated through the CLI."}))
	stale := refused(4, "another request changed the record first", "write", write("note.update", note, map[string]any{"body": "Stale overwrite"}))
	if strings.Contains(stale, "Crew refused") {
		t.Fatalf("revision conflict reported as refusal: %s", stale)
	}
	if dig(current, "revision") != float64(2) {
		t.Fatalf("note update: %v", current)
	}

	// Reassignments through write count toward the handoff limit (default 4).
	handoff := call("", "write", write("task.create", nil, map[string]any{"title": "Synthetic handoff loop", "readiness": "ready"}))
	for i := 0; i < 5; i++ {
		target := []any{dig(agent, "id"), dig(other, "id")}[i%2]
		handoff = call("", "write", write("task.update", handoff, map[string]any{"assigned_agent": target}))
	}
	if dig(handoff, "handoff_limited") != true || dig(handoff, "readiness") != "waiting" {
		t.Fatalf("handoffs not counted: %v", handoff)
	}
	// A work client may set the stopped task Ready, but the hop accounting stays.
	ready := call("", "write", write("task.update", handoff, map[string]any{"readiness": "ready"}))
	if dig(ready, "readiness") != "ready" || dig(ready, "handoff_limited") != true {
		t.Fatalf("agent Ready: %v", ready)
	}
}
