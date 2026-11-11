package client

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const syntheticID = "abcdefghijklmno"

// runWork parses and runs one work command against a test server, returning
// the exit code, standard output and standard error.
func runWork(t *testing.T, server *httptest.Server, argv ...string) (int, string, string) {
	t.Helper()
	a, err := parseArgs(argv[1:], []string{"file", "task", "note", "reported-agent", "reason", "execution", "out", "variant"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	if a.crew, err = prepareCrewCommand(argv[0], a); err != nil {
		return commandResult(err, &stderr), "", stderr.String()
	}
	out, err := os.CreateTemp(t.TempDir(), "stdout")
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	saved := os.Stdout
	os.Stdout = out
	c := &Client{Base: server.URL, token: "synthetic", http: server.Client()}
	code := commandResult(runData(c, argv[0], a, false), &stderr)
	os.Stdout = saved
	written, _ := os.ReadFile(out.Name())
	return code, string(written), stderr.String()
}

type receivedPart struct{ name, filename, body string }

// multipartAPI records each multipart write and answers with respond.
func multipartAPI(t *testing.T, got *[][]receivedPart, respond func(n int, parts []receivedPart) (int, any)) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/crew/agent-write" || r.Header.Get("Authorization") != "synthetic" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		reader, err := r.MultipartReader()
		if err != nil {
			t.Fatalf("not multipart: %v", err)
		}
		var parts []receivedPart
		for {
			p, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(p)
			parts = append(parts, receivedPart{p.FormName(), p.FileName(), string(body)})
		}
		*got = append(*got, parts)
		status, body := respond(len(*got), parts)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	}))
}

func writeTemp(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestAttachSendsMultipartBatchesAndReportsEachFile(t *testing.T) {
	dir := t.TempDir()
	shot := writeTemp(t, dir, "screen shot 1.png", "PNGDATA1")
	log := writeTemp(t, dir, "run.log", "line one\n")
	big := writeTemp(t, dir, "big.bin", strings.Repeat("x", 40))
	saved := crewMultipartBudget
	crewMultipartBudget = 20 // forces a second request for big.bin
	defer func() { crewMultipartBudget = saved }()
	var got [][]receivedPart
	server := multipartAPI(t, &got, func(_ int, parts []receivedPart) (int, any) {
		if parts[1].filename != "big.bin" {
			return 200, map[string]any{"attachments": []any{map[string]any{"id": "attachmentone11"}},
				"results": []any{map[string]any{"index": 1, "name": parts[1].filename, "ok": true, "id": "attachmentone11"},
					map[string]any{"index": 2, "name": parts[2].filename, "ok": false, "error": map[string]any{"code": "storage_limit", "message": "Storage limit reached"}}},
				"review_withdrawn": true}
		}
		return 400, map[string]any{"status": 400, "message": "No file was attached", "data": map[string]any{"files.1": map[string]any{"code": "attachment_limit", "message": "at most 20"}}}
	})
	defer server.Close()
	code, out, stderr := runWork(t, server, "attach", shot, log, big, "--task", syntheticID, "--reported-agent", "Build", "--reason", "Synthetic", "--execution", `{"id":"e","worker_id":"w","fence":2}`)
	if code != 0 {
		t.Fatalf("exit %d: %s", code, stderr)
	}
	if len(got) != 2 || len(got[0]) != 3 || len(got[1]) != 2 {
		t.Fatalf("batches: %v", got)
	}
	var envelope map[string]any
	if got[0][0].name != "@jsonPayload" || json.Unmarshal([]byte(got[0][0].body), &envelope) != nil {
		t.Fatalf("payload part: %+v", got[0][0])
	}
	if envelope["action"] != "attachment.add" || envelope["reported_agent"] != "Build" || envelope["reason"] != "Synthetic" ||
		dig(envelope, "data", "task") != syntheticID || dig(envelope, "execution", "worker_id") != "w" {
		t.Fatalf("envelope: %v", envelope)
	}
	if p := got[0][1]; p.name != "files" || p.filename != "screen shot 1.png" || p.body != "PNGDATA1" {
		t.Fatalf("file part: %+v", p)
	}
	if p := got[1][1]; p.filename != "big.bin" || len(p.body) != 40 {
		t.Fatalf("second batch: %+v", p)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		t.Fatal(err, out)
	}
	results := result["results"].([]any)
	if result["saved"] != float64(1) || result["failed"] != float64(2) || len(results) != 3 || result["review_withdrawn"] != true {
		t.Fatalf("summary: %v", result)
	}
	if dig(results[0], "id") != "attachmentone11" || dig(results[1], "error", "code") != "storage_limit" ||
		dig(results[2], "error", "code") != "attachment_limit" || dig(results[2], "index") != float64(3) || dig(results[2], "file") != big {
		t.Fatalf("results: %v", results)
	}

	// Every file refused: the results are still printed, and the exit is 1.
	got = nil
	code, out, stderr = runWork(t, server, "attach", big, "--note", syntheticID, "--reported-agent", "Build")
	if code != 1 || !strings.Contains(out, "attachment_limit") || !strings.Contains(stderr, "no file was saved") {
		t.Fatalf("all refused: exit %d out %q err %q", code, out, stderr)
	}
}

func TestAttachOtherRefusalsStopWithTheServerMessage(t *testing.T) {
	file := writeTemp(t, t.TempDir(), "a.txt", "a")
	var got [][]receivedPart
	server := multipartAPI(t, &got, func(int, []receivedPart) (int, any) {
		return 404, map[string]any{"status": 404, "message": "Task not found"}
	})
	defer server.Close()
	code, out, stderr := runWork(t, server, "attach", file, "--task", syntheticID, "--reported-agent", "Build")
	if code != 1 || out != "" || !strings.Contains(stderr, "Task not found") {
		t.Fatalf("exit %d out %q err %q", code, out, stderr)
	}
}

func TestFileCommandsRejectedBeforeServer(t *testing.T) {
	dir := t.TempDir()
	file := writeTemp(t, dir, "a.txt", "a")
	empty := writeTemp(t, dir, "empty.txt", "")
	existing := writeTemp(t, dir, "exists.png", "keep")
	db := filepath.Join(t.TempDir(), "never", "pocketcontext.db")
	t.Setenv("POCKETCONTEXT_URL", "")
	many := make([]string, 21)
	for i := range many {
		many[i] = file
	}
	cases := []struct {
		args []string
		want string
	}{
		{[]string{"attach", "--task", syntheticID, "--reported-agent", "B"}, "usage: pocketcontext-crew attach"},
		{[]string{"attach", file, "--reported-agent", "B"}, "exactly one of --task"},
		{[]string{"attach", file, "--task", syntheticID, "--note", syntheticID, "--reported-agent", "B"}, "exactly one of --task"},
		{[]string{"attach", file, "--task", "short", "--reported-agent", "B"}, "15-character"},
		{[]string{"attach", file, "--task", syntheticID}, "--reported-agent NAME is required"},
		{[]string{"attach", filepath.Join(dir, "missing.png"), "--task", syntheticID, "--reported-agent", "B"}, "missing.png"},
		{[]string{"attach", dir, "--task", syntheticID, "--reported-agent", "B"}, "not a regular file"},
		{[]string{"attach", empty, "--task", syntheticID, "--reported-agent", "B"}, "is empty"},
		{[]string{"attach", file, "--task", syntheticID, "--reported-agent", "B", "--execution", "[1]"}, "--execution must be a JSON object"},
		{append(append([]string{"attach"}, many...), "--task", syntheticID, "--reported-agent", "B"), "at most 20 files"},
		{[]string{"attachment", syntheticID}, "--out FILE"},
		{[]string{"attachment", "bad", "--out", filepath.Join(dir, "x")}, "15-character"},
		{[]string{"attachment", syntheticID, "--out", filepath.Join(dir, "x"), "--variant", "thumb"}, "--variant must be"},
		{[]string{"attachment", syntheticID, "--out", existing}, "already exists"},
		{[]string{"attachment", syntheticID, "--out", filepath.Join(dir, "nofolder", "x.png")}, "does not exist"},
		{[]string{"write", `{"action":"task.update","reported_agent":"B","data":{}}`, "--file", file}, "--file works only with"},
		{[]string{"write", `{"action":"task.create","reported_agent":"B","data":{"files":[]}}`, "--file", file}, "not both"},
		{[]string{"read", `{"collection":"tasks"}`, "--file", file}, "unknown option --file"},
	}
	for _, c := range cases {
		code, out, stderr := runCLI(t, "", append(c.args, "--db", db)...)
		if code != 2 || out != "" || !strings.Contains(stderr, c.want) {
			t.Errorf("%v: exit %d, stdout %q, stderr %q; want exit 2 mentioning %q", c.args, code, out, stderr, c.want)
		}
	}
	if data, _ := os.ReadFile(existing); string(data) != "keep" {
		t.Fatal("existing file changed")
	}
	if _, err := os.Stat(filepath.Dir(db)); err == nil {
		t.Fatal("rejected input created a project")
	}
}

func TestWriteWithFilesSendsOneMultipartCreate(t *testing.T) {
	dir := t.TempDir()
	one, two := writeTemp(t, dir, "one.png", "1"), writeTemp(t, dir, "two.log", "2")
	var got [][]receivedPart
	server := multipartAPI(t, &got, func(int, []receivedPart) (int, any) {
		return 200, map[string]any{"id": "taskidtaskidtas", "attachments": []any{}}
	})
	defer server.Close()
	input := `{"action":"task.create","reported_agent":"Build","data":{"title":"Bug","description":"![step](attachment:new-1)"}}`
	code, out, stderr := runWork(t, server, "write", input, "--file", one, "--file", two)
	if code != 0 || !strings.Contains(out, "taskidtaskidtas") {
		t.Fatalf("exit %d out %q err %q", code, out, stderr)
	}
	parts := got[0]
	if len(got) != 1 || len(parts) != 3 || parts[1].filename != "one.png" || parts[2].filename != "two.log" {
		t.Fatalf("parts: %+v", got)
	}
	var envelope map[string]any
	_ = json.Unmarshal([]byte(parts[0].body), &envelope)
	if envelope["action"] != "task.create" || dig(envelope, "data", "description") != "![step](attachment:new-1)" {
		t.Fatalf("envelope: %v", envelope)
	}
}

// attachmentAPI serves attachment-read for one synthetic file, in pages of at
// most page bytes, and a 320 px "card" that differs from the original.
func attachmentAPI(t *testing.T, content []byte, recordSHA string, page int, calls *int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*calls++
		if r.URL.Path != "/api/crew/attachment-read" || r.Method != "POST" {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			ID       string `json:"id"`
			Variant  string `json:"variant"`
			Offset   int    `json:"offset"`
			MaxBytes int    `json:"max_bytes"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		meta := map[string]any{"id": body.ID, "name": `con:shot?.png.`, "size": len(content), "sha256": recordSHA, "image": true}
		out := map[string]any{"attachment": meta, "variant": body.Variant, "media_type": "image/png"}
		w.Header().Set("Content-Type", "application/json")
		if body.Variant == "card" {
			out["encoding"], out["offset"], out["length"], out["next_offset"] = "base64", 0, 4, nil
			out["content_base64"] = base64.StdEncoding.EncodeToString([]byte("card"))
			_ = json.NewEncoder(w).Encode(out)
			return
		}
		limit := min(body.MaxBytes, page)
		end := min(body.Offset+limit, len(content))
		chunk := content[body.Offset:end]
		out["offset"], out["length"], out["total_size"] = body.Offset, len(chunk), len(content)
		if body.Variant == "text" {
			out["encoding"], out["text"] = "utf-8", string(chunk)
		} else {
			out["encoding"], out["content_base64"] = "base64", base64.StdEncoding.EncodeToString(chunk)
		}
		if end < len(content) {
			out["next_offset"] = end
		} else {
			out["next_offset"] = nil
		}
		_ = json.NewEncoder(w).Encode(out)
	}))
}

func TestAttachmentDownloadPagesVerifiesAndNeverOverwrites(t *testing.T) {
	content := []byte("synthetic attachment bytes, long enough to page several times")
	sum := sha256.Sum256(content)
	calls := 0
	server := attachmentAPI(t, content, hex.EncodeToString(sum[:]), 7, &calls)
	defer server.Close()
	dir := t.TempDir()
	target := filepath.Join(dir, "copy.bin")
	code, out, stderr := runWork(t, server, "attachment", syntheticID, "--out", target)
	if code != 0 {
		t.Fatalf("exit %d: %s", code, stderr)
	}
	if data, _ := os.ReadFile(target); !bytes.Equal(data, content) {
		t.Fatalf("content %q", data)
	}
	if want := (len(content) + 6) / 7; calls != want {
		t.Fatalf("%d reads, want %d pages", calls, want)
	}
	var result map[string]any
	_ = json.Unmarshal([]byte(out), &result)
	if result["verified"] != true || result["sha256"] != hex.EncodeToString(sum[:]) || result["path"] != target {
		t.Fatalf("result: %v", result)
	}
	// The same target again: nothing is overwritten.
	code, _, stderr = runWork(t, server, "attachment", syntheticID, "--out", target)
	if code != 2 || !strings.Contains(stderr, "already exists") {
		t.Fatalf("overwrite: exit %d %s", code, stderr)
	}
	// Text pages are the original bytes and verify the same way.
	code, _, stderr = runWork(t, server, "attachment", syntheticID, "--out", filepath.Join(dir, "copy.txt"), "--variant", "text")
	if data, _ := os.ReadFile(filepath.Join(dir, "copy.txt")); code != 0 || !bytes.Equal(data, content) {
		t.Fatalf("text: exit %d %s", code, stderr)
	}
	// A directory target uses the display name, made safe for Windows.
	code, out, stderr = runWork(t, server, "attachment", syntheticID, "--out", dir, "--variant", "card")
	if code != 0 {
		t.Fatalf("card: exit %d %s", code, stderr)
	}
	_ = json.Unmarshal([]byte(out), &result)
	if result["path"] != filepath.Join(dir, "con_shot_.png") || result["verified"] != false {
		t.Fatalf("card result: %v", result)
	}
	if data, _ := os.ReadFile(filepath.Join(dir, "con_shot_.png")); string(data) != "card" {
		t.Fatalf("card content %q", data)
	}
	assertNoPartials(t, dir)
}

func TestAttachmentDownloadChecksumMismatchWritesNothing(t *testing.T) {
	calls := 0
	server := attachmentAPI(t, []byte("tampered bytes"), strings.Repeat("0", 64), 1<<20, &calls)
	defer server.Close()
	dir := t.TempDir()
	target := filepath.Join(dir, "copy.bin")
	code, _, stderr := runWork(t, server, "attachment", syntheticID, "--out", target)
	if code != 1 || !strings.Contains(stderr, "checksum mismatch") {
		t.Fatalf("exit %d %s", code, stderr)
	}
	if _, err := os.Stat(target); err == nil {
		t.Fatal("mismatched download was written")
	}
	assertNoPartials(t, dir)
}

func assertNoPartials(t *testing.T, dir string) {
	t.Helper()
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".part") {
			t.Fatalf("temporary file left behind: %s", e.Name())
		}
	}
}

func TestSafeFileName(t *testing.T) {
	cases := map[string]string{
		"screenshot.png":         "screenshot.png",
		`a/b\c:d*e?f"g<h>i|j`:    "a_b_c_d_e_f_g_h_i_j",
		"report. ":               "report",
		"..hidden":               "hidden",
		"CON":                    "_CON",
		"nul.txt":                "_nul.txt",
		"com1.log":               "_com1.log",
		"lpt9":                   "_lpt9",
		"computer.txt":           "computer.txt",
		"tab\there\x00":          "tabhere",
		"":                       syntheticID,
		"...":                    syntheticID,
		"Ünïcode bug 🐞.png":      "Ünïcode bug 🐞.png",
		strings.Repeat("é", 100): strings.Repeat("é", 75),
	}
	for in, want := range cases {
		if got := safeFileName(in, syntheticID); got != want {
			t.Errorf("safeFileName(%q) = %q, want %q", in, got, want)
		}
	}
}

// The commands against a real server: attach, write with a placeholder and a
// verified download round trip.
func TestFileCommandsRealWorkflow(t *testing.T) {
	p := realTestProject(t)
	db := p.DB
	call := func(argv ...string) map[string]any {
		t.Helper()
		code, out, stderr := runCLI(t, "", append(argv, "--db", db)...)
		if code != 0 {
			t.Fatalf("%v: exit %d: %s", argv, code, stderr)
		}
		var v map[string]any
		if err := json.Unmarshal([]byte(out), &v); err != nil {
			t.Fatalf("%v: %v: %q", argv, err, out)
		}
		return v
	}
	dir := t.TempDir()
	logText := strings.Repeat("synthetic log line\n", 300000) // 5.7 MB: two original pages
	logPath := writeTemp(t, dir, "run.log", logText)
	notes := writeTemp(t, dir, "notes.md", "# Synthetic")
	task := call("write", `{"action":"task.create","reported_agent":"Build","data":{"title":"Synthetic file bug","description":"See [log](attachment:new-1)"}}`, "--file", logPath)
	created := task["attachments"].([]any)
	if len(created) != 1 || task["description"] != fmt.Sprintf("See [log](attachment:%s)", dig(created[0], "id")) {
		t.Fatalf("create with file: %v", task)
	}
	attached := call("attach", notes, "--task", task["id"].(string), "--reported-agent", "Build")
	if attached["saved"] != float64(1) || dig(attached["results"].([]any)[0], "name") != "notes.md" {
		t.Fatalf("attach: %v", attached)
	}
	target := filepath.Join(dir, "downloaded.log")
	got := call("attachment", dig(created[0], "id").(string), "--out", target)
	if data, _ := os.ReadFile(target); string(data) != logText || got["verified"] != true {
		t.Fatalf("download: %v", got)
	}
	code, _, stderr := runCLI(t, "", "attachment", dig(created[0], "id").(string), "--out", target, "--db", db)
	if code != 2 || !strings.Contains(stderr, "already exists") {
		t.Fatalf("overwrite: exit %d %s", code, stderr)
	}
	// Every file refused (an archived parent): exit 1 with per-file results.
	call("write", fmt.Sprintf(`{"action":"task.update","id":"%s","expected_revision":1,"reported_agent":"Build","data":{"archived":true}}`, task["id"]))
	code, out, stderr := runCLI(t, "", "attach", notes, "--task", task["id"].(string), "--reported-agent", "Build", "--db", db)
	if code != 1 || out != "" && !strings.Contains(out, `"saved":0`) {
		t.Fatalf("archived parent: exit %d out %q err %q", code, out, stderr)
	}
}
