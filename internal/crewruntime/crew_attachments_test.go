package crewruntime

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"math/rand/v2"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

type testFile struct {
	name string
	data []byte
}

func syntheticImage(w, h int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 120, 255})
		}
	}
	return img
}

func tinyPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, syntheticImage(w, h)); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func tinyJPEG(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, syntheticImage(8, 6), nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func tinyGIF(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := gif.Encode(&b, syntheticImage(5, 4), nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func digest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// multipartRequest sends an envelope (as @jsonPayload, or as plain fields when
// fields is set) with file parts named "files".
func multipartRequest(t *testing.T, a *testApp, path, token string, envelope map[string]any, files []testFile, want int) map[string]any {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	if envelope != nil {
		raw, _ := json.Marshal(envelope)
		if err := w.WriteField("@jsonPayload", string(raw)); err != nil {
			t.Fatal(err)
		}
	}
	for _, f := range files {
		part, err := w.CreateFormFile("files", f.name)
		if err != nil {
			t.Fatal(err)
		}
		part.Write(f.data)
	}
	w.Close()
	req := httptest.NewRequest("POST", path, &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	res := httptest.NewRecorder()
	a.handler.ServeHTTP(res, req)
	if res.Code != want {
		t.Fatalf("POST %s: %d %s; want %d", path, res.Code, res.Body, want)
	}
	var out map[string]any
	json.Unmarshal(res.Body.Bytes(), &out)
	return out
}

func uploadLinkRequest(t *testing.T, a *testApp, token string, extra map[string]string, files []testFile, want int) (map[string]any, *httptest.ResponseRecorder) {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	for k, v := range extra {
		w.WriteField(k, v)
	}
	for _, f := range files {
		part, _ := w.CreateFormFile("files", f.name)
		part.Write(f.data)
	}
	w.Close()
	req := httptest.NewRequest("POST", "/api/crew/upload-link/upload", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set(uploadTokenHeader, token)
	res := httptest.NewRecorder()
	a.handler.ServeHTTP(res, req)
	if res.Code != want {
		t.Fatalf("upload: %d %s; want %d", res.Code, res.Body, want)
	}
	var out map[string]any
	json.Unmarshal(res.Body.Bytes(), &out)
	return out, res
}

func crewWrite(t *testing.T, a *testApp, agent bool, action, id string, revision int, data map[string]any, want int) map[string]any {
	t.Helper()
	b := map[string]any{"action": action, "data": data, "reported_agent": "synthetic-bot", "reason": "synthetic"}
	if id != "" {
		b["id"] = id
		b["expected_revision"] = revision
	}
	raw, _ := json.Marshal(b)
	route := "/api/crew/write"
	if agent {
		route = "/api/crew/agent-write"
	}
	return a.request(t, "POST", route, a.token, string(raw), want)
}

func envelope(action string, data map[string]any) map[string]any {
	return map[string]any{"action": action, "data": data, "reported_agent": "synthetic-bot"}
}

func attachmentsOf(t *testing.T, a *testApp, parent string, archived bool) []map[string]any {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"collection": "attachments", "parent": parent, "archived": archived})
	out := a.request(t, "POST", "/api/crew/read", a.token, string(raw), 200)
	items := []map[string]any{}
	for _, x := range out["items"].([]any) {
		items = append(items, x.(map[string]any))
	}
	return items
}

func eventsOf(t *testing.T, a *testApp, parent, action string) []*core.Record {
	t.Helper()
	rows, err := a.app.FindRecordsByFilter("crew_events", "parent={:p} && action={:a}", "created", 0, 0, map[string]any{"p": parent, "a": action})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func newTask(t *testing.T, a *testApp, data map[string]any) map[string]any {
	t.Helper()
	if data["title"] == nil {
		data["title"] = "Synthetic attachment task"
	}
	return crewWrite(t, a, false, "task.create", "", 0, data, 200)
}

func fileErrors(out map[string]any) map[string]any {
	data, _ := out["data"].(map[string]any)
	return data
}

func TestAttachmentAddMultipartBase64AndRead(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	shot := tinyPNG(t, 40, 30)
	out := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task["id"]}),
		[]testFile{{"screenshot 1.png", shot}, {"run.log", []byte("line one\nline two\n")}}, 200)
	added := out["attachments"].([]any)
	if len(added) != 2 || out["review_withdrawn"] != false {
		t.Fatal("bad add result", out)
	}
	png := added[0].(map[string]any)
	if png["image"] != true || png["media_type"] != "image/png" || png["width"] != float64(40) || png["height"] != float64(30) ||
		png["sha256"] != digest(shot) || png["size"] != float64(len(shot)) || png["name"] != "screenshot 1.png" ||
		png["parent_kind"] != "task" || png["parent"] != task["id"] || png["position"] != float64(1) || !strings.HasPrefix(png["actor"].(string), "owner:") {
		t.Fatal("bad image metadata", png)
	}
	if _, leaked := png["file"]; leaked {
		t.Fatal("storage file name exported", png)
	}
	log := added[1].(map[string]any)
	if log["image"] != false || log["media_type"] != "text/plain" || log["position"] != float64(2) {
		t.Fatal("bad log metadata", log)
	}
	// Base64 through the work-client route (MCP shape).
	note := []byte("# Notes\nSynthetic markdown")
	agentOut := crewWrite(t, a, true, "attachment.add", "", 0, map[string]any{"task": task["id"], "files": []any{
		map[string]any{"name": "notes.md", "content_base64": base64.StdEncoding.EncodeToString(note)},
	}}, 200)
	md := agentOut["attachments"].([]any)[0].(map[string]any)
	if md["media_type"] != "text/markdown" || !strings.HasPrefix(md["actor"].(string), "mcp:") || md["reported_agent"] != "synthetic-bot" || md["position"] != float64(3) {
		t.Fatal("bad base64 attachment", md)
	}
	listed := attachmentsOf(t, a, task["id"].(string), false)
	if len(listed) != 3 || listed[0]["id"] != png["id"] || listed[2]["id"] != md["id"] {
		t.Fatal("listing not ordered by position", listed)
	}
	if n := len(eventsOf(t, a, task["id"].(string), "attachment.add")); n != 3 {
		t.Fatal("attachment.add events", n)
	}
	ev := eventsOf(t, a, task["id"].(string), "attachment.add")[0]
	var changes map[string]any
	json.Unmarshal([]byte(ev.GetString("changes")), &changes)
	if changes["attachment"] != png["id"] || changes["name"] != "screenshot 1.png" || changes["sha256"] != digest(shot) {
		t.Fatal("bad event changes", changes)
	}
	// Projection never selects the hidden file field.
	raw, _ := json.Marshal(map[string]any{"collection": "attachments", "parent": task["id"], "fields": []string{"file"}})
	a.request(t, "POST", "/api/crew/read", a.token, string(raw), 400)
	// The task itself is untouched by attachment writes.
	if apiWebhookRecord(t, a, "tasks", task["id"].(string)).GetInt("revision") != int(task["revision"].(float64)) {
		t.Fatal("attachment add changed the task revision")
	}
	// Files on other actions are refused.
	multipartRequest(t, a, "/api/crew/write", a.token, map[string]any{"action": "task.update", "id": task["id"], "expected_revision": task["revision"], "data": map[string]any{"title": "x"}},
		[]testFile{{"x.txt", []byte("x")}}, 400)
	crewWrite(t, a, true, "attachment.add", "", 0, map[string]any{"task": task["id"]}, 400)
	crewWrite(t, a, true, "attachment.add", "", 0, map[string]any{"task": task["id"], "note": task["id"], "files": []any{map[string]any{"name": "a.txt", "content_base64": "YQ=="}}}, 400)
}

func TestAttachmentMagicBytesDecideImages(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	files := []testFile{
		{"fake.png", []byte("this is not a png")},
		{"real.txt", tinyPNG(t, 3, 3)},
		{"photo.jpeg", tinyJPEG(t)},
		{"anim.gif", tinyGIF(t)},
		{"page.html", []byte("<script>alert(1)</script>")},
		{"truncated.png", []byte("\x89PNG\r\n\x1a\ngarbage")},
	}
	out := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task["id"]}), files, 200)
	got := map[string]map[string]any{}
	for _, x := range out["attachments"].([]any) {
		m := x.(map[string]any)
		got[m["name"].(string)] = m
	}
	for name, want := range map[string][2]any{
		"fake.png":      {false, "application/octet-stream"},
		"real.txt":      {true, "image/png"},
		"photo.jpeg":    {true, "image/jpeg"},
		"anim.gif":      {true, "image/gif"},
		"page.html":     {false, "text/html"},
		"truncated.png": {false, "application/octet-stream"},
	} {
		if got[name]["image"] != want[0] || got[name]["media_type"] != want[1] {
			t.Errorf("%s: image=%v type=%v", name, got[name]["image"], got[name]["media_type"])
		}
	}
}

func TestAttachmentLimitsAndPartialFailure(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	id := task["id"].(string)
	// One good file, one empty and one oversized: each fails on its own.
	big := bytes.Repeat([]byte("x"), attachmentMaxBytes+1)
	out := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": id}),
		[]testFile{{"ok.txt", []byte("fine")}, {"empty.txt", nil}, {"big.bin", big}}, 200)
	results := out["results"].([]any)
	if len(out["attachments"].([]any)) != 1 || len(results) != 3 {
		t.Fatal("partial add", out)
	}
	codes := []string{}
	for _, r := range results {
		m := r.(map[string]any)
		if m["ok"] == true {
			codes = append(codes, "ok")
		} else {
			codes = append(codes, m["error"].(map[string]any)["code"].(string))
		}
	}
	if fmt.Sprint(codes) != "[ok empty_file file_too_large]" {
		t.Fatal("per-file results", codes)
	}
	// Every file failing is a 400 that names each file.
	failed := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": id}), []testFile{{"empty.txt", nil}}, 400)
	if e := fileErrors(failed)["files.1"].(map[string]any); e["code"] != "empty_file" {
		t.Fatal("all-failed add", failed)
	}
	// Twenty active attachments per item; archived ones do not count.
	many := []testFile{}
	for i := 0; i < 19; i++ {
		many = append(many, testFile{fmt.Sprintf("f%02d.txt", i), []byte{byte('a' + i)}})
	}
	multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": id}), many, 200)
	over := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": id}), []testFile{{"21.txt", []byte("z")}}, 400)
	if fileErrors(over)["files.1"].(map[string]any)["code"] != "attachment_limit" {
		t.Fatal("count limit", over)
	}
	first := attachmentsOf(t, a, id, false)[0]
	crewWrite(t, a, false, "attachment.archive", first["id"].(string), int(first["revision"].(float64)), map[string]any{}, 200)
	multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": id}), []testFile{{"21.txt", []byte("z")}}, 200)
	// Restoring would exceed twenty active.
	archived := attachmentsOf(t, a, id, true)[0]
	crewWrite(t, a, false, "attachment.restore", archived["id"].(string), int(archived["revision"].(float64)), map[string]any{}, 400)
	// More than twenty files in one request is refused outright.
	tooMany := append(many, many[:2]...)
	multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": id}), tooMany, 400)
}

func TestAttachmentStorageLimit(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	read := a.request(t, "POST", "/api/crew/read", a.token, `{"collection":"settings"}`, 200)
	s := read["items"].([]any)[0].(map[string]any)
	if s["storage_limit_bytes"] != float64(5<<30) || s["storage_used_bytes"] != float64(0) || s["max_file_bytes"] != float64(attachmentMaxBytes) {
		t.Fatal("default settings", s)
	}
	crewWrite(t, a, true, "storage.update", s["id"].(string), int(s["revision"].(float64)), map[string]any{"storage_limit_bytes": 1000}, 400)
	updated := crewWrite(t, a, true, "storage.update", s["id"].(string), int(s["revision"].(float64)), map[string]any{"storage_limit_bytes": 1 << 20}, 200)
	if updated["storage_limit_bytes"] != float64(1<<20) || updated["revision"] != float64(2) {
		t.Fatal("storage.update", updated)
	}
	crewWrite(t, a, true, "storage.update", s["id"].(string), 1, map[string]any{"storage_limit_bytes": 2 << 20}, 409)
	if len(eventsOf(t, a, s["id"].(string), "storage.update")) != 1 {
		t.Fatal("storage.update event")
	}
	chunk := bytes.Repeat([]byte("s"), 600<<10)
	out := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task["id"]}),
		[]testFile{{"one.bin", chunk}, {"two.bin", chunk}}, 200)
	results := out["results"].([]any)
	if results[1].(map[string]any)["error"].(map[string]any)["code"] != "storage_limit" {
		t.Fatal("storage limit", out)
	}
	// Archived files still count toward the limit.
	one := out["attachments"].([]any)[0].(map[string]any)
	crewWrite(t, a, false, "attachment.archive", one["id"].(string), 1, map[string]any{}, 200)
	multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task["id"]}), []testFile{{"two.bin", chunk}}, 400)
	read = a.request(t, "POST", "/api/crew/read", a.token, `{"collection":"settings"}`, 200)
	if read["items"].([]any)[0].(map[string]any)["storage_used_bytes"] != float64(len(chunk)) {
		t.Fatal("storage used", read)
	}
}

func TestAttachmentBase64Limits(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	big := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("b"), (attachmentBase64MaxBytes/2)+10))
	crewWrite(t, a, true, "attachment.add", "", 0, map[string]any{"task": task["id"], "files": []any{
		map[string]any{"name": "a.bin", "content_base64": big}, map[string]any{"name": "b.bin", "content_base64": big},
	}}, 400)
	out := crewWrite(t, a, true, "attachment.add", "", 0, map[string]any{"task": task["id"], "files": []any{
		map[string]any{"name": "ok.txt", "content_base64": "b2s="},
		map[string]any{"name": "bad.txt", "content_base64": "%%%"},
		map[string]any{"name": "extra.txt", "content_base64": "b2s=", "media_type": "text/html"},
	}}, 200)
	codes := []any{}
	for _, r := range out["results"].([]any) {
		m := r.(map[string]any)
		if e, ok := m["error"].(map[string]any); ok {
			codes = append(codes, e["code"])
		} else {
			codes = append(codes, "ok")
		}
	}
	if fmt.Sprint(codes) != "[ok invalid_base64 invalid_file]" {
		t.Fatal("base64 per-file results", codes)
	}
}

func TestAttachmentIdempotentAdd(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	body := func(content string) string {
		raw, _ := json.Marshal(map[string]any{"action": "attachment.add", "reported_agent": "synthetic-bot", "idempotency_key": "retry-1",
			"data": map[string]any{"task": task["id"], "files": []any{map[string]any{"name": "a.txt", "content_base64": base64.StdEncoding.EncodeToString([]byte(content))}}}})
		return string(raw)
	}
	first := a.request(t, "POST", "/api/crew/agent-write", a.token, body("same"), 200)
	again := a.request(t, "POST", "/api/crew/agent-write", a.token, body("same"), 200)
	if fmt.Sprint(first["attachments"]) != fmt.Sprint(again["attachments"]) || len(attachmentsOf(t, a, task["id"].(string), false)) != 1 {
		t.Fatal("replay duplicated the attachment")
	}
	a.request(t, "POST", "/api/crew/agent-write", a.token, body("different"), 409)
}

func TestTaskAndNoteCreateWithFiles(t *testing.T) {
	a := newTestApp(t)
	shot1, shot2 := tinyPNG(t, 12, 10), tinyPNG(t, 14, 9)
	created := multipartRequest(t, a, "/api/crew/write", a.token, envelope("task.create", map[string]any{
		"title":       "Bug with screenshots",
		"description": "Step 1\n\n![first](attachment:new-1)\n\nStep 2\n\n![second](attachment:new-2)",
		"draft":       "See ![again](attachment:new-1)",
	}), []testFile{{"screenshot-1.png", shot1}, {"screenshot-2.png", shot2}}, 200)
	files := created["attachments"].([]any)
	if len(files) != 2 || created["revision"] != float64(1) {
		t.Fatal("create with files", created)
	}
	id1, id2 := files[0].(map[string]any)["id"].(string), files[1].(map[string]any)["id"].(string)
	if created["description"] != "Step 1\n\n![first](attachment:"+id1+")\n\nStep 2\n\n![second](attachment:"+id2+")" || created["draft"] != "See ![again](attachment:"+id1+")" {
		t.Fatal("placeholders not resolved", created["description"], created["draft"])
	}
	if files[0].(map[string]any)["parent"] != created["id"] || len(eventsOf(t, a, created["id"].(string), "attachment.add")) != 2 || len(eventsOf(t, a, created["id"].(string), "task.create")) != 1 {
		t.Fatal("parent or events")
	}
	countTasks := func() int {
		n, _ := a.app.CountRecords("crew_tasks")
		return int(n)
	}
	countFiles := func() int {
		n, _ := a.app.CountRecords("crew_attachments")
		return int(n)
	}
	tasks, stored := countTasks(), countFiles()
	// A refused file creates nothing.
	failed := multipartRequest(t, a, "/api/crew/write", a.token, envelope("task.create", map[string]any{"title": "Half made", "description": "![x](attachment:new-2)"}),
		[]testFile{{"ok.png", shot1}, {"empty.png", nil}}, 400)
	if fileErrors(failed)["files.2"].(map[string]any)["code"] != "empty_file" || countTasks() != tasks || countFiles() != stored {
		t.Fatal("failed create left records", failed)
	}
	// A placeholder beyond the uploaded files refuses the create.
	multipartRequest(t, a, "/api/crew/write", a.token, envelope("task.create", map[string]any{"title": "Bad ref", "description": "![x](attachment:new-3)"}),
		[]testFile{{"ok.png", shot1}}, 400)
	// Placeholders without files are refused.
	crewWrite(t, a, false, "task.create", "", 0, map[string]any{"title": "No files", "description": "![x](attachment:new-1)"}, 400)
	if countTasks() != tasks || countFiles() != stored {
		t.Fatal("refused creates left records")
	}
	// Storage limit failure also creates nothing.
	s := a.request(t, "POST", "/api/crew/read", a.token, `{"collection":"settings"}`, 200)["items"].([]any)[0].(map[string]any)
	crewWrite(t, a, false, "storage.update", s["id"].(string), 1, map[string]any{"storage_limit_bytes": 1 << 20}, 200)
	multipartRequest(t, a, "/api/crew/write", a.token, envelope("task.create", map[string]any{"title": "Too big"}),
		[]testFile{{"big.bin", bytes.Repeat([]byte("q"), 2<<20)}}, 400)
	if countTasks() != tasks || countFiles() != stored {
		t.Fatal("storage-refused create left records")
	}
	// Notes too, via base64 on the work-client route.
	bucket := crewWrite(t, a, true, "bucket.create", "", 0, map[string]any{"name": "SYNTH"}, 200)
	note := crewWrite(t, a, true, "note.create", "", 0, map[string]any{"bucket": bucket["id"], "title": "Note with image", "body": "![n](attachment:new-1)",
		"files": []any{map[string]any{"name": "n.png", "content_base64": base64.StdEncoding.EncodeToString(shot1)}}}, 200)
	nid := note["attachments"].([]any)[0].(map[string]any)["id"].(string)
	if note["body"] != "![n](attachment:"+nid+")" {
		t.Fatal("note placeholder", note["body"])
	}
	rev, _ := a.app.FindFirstRecordByFilter("crew_note_revisions", "note={:n}", map[string]any{"n": note["id"]})
	if rev.GetString("body") != note["body"] {
		t.Fatal("note snapshot keeps placeholder", rev.GetString("body"))
	}
	if ev := eventsOf(t, a, note["id"].(string), "note.create"); len(ev) != 1 || strings.Contains(ev[0].GetString("changes"), "new-1") || !strings.Contains(ev[0].GetString("changes"), nid) {
		t.Fatal("note.create event keeps placeholder", ev)
	}
}

// The task.create event records resolved text even when assigned_agent makes
// the hook copy the request values.
func TestTaskCreateEventRecordsResolvedReferences(t *testing.T) {
	a := newTestApp(t)
	agent := crewWrite(t, a, false, "agent.create", "", 0, map[string]any{"name": "synthetic-assignee", "brief": "synthetic"}, 200)
	for _, assignee := range []any{nil, agent["id"], "synthetic-assignee"} {
		data := map[string]any{"title": "Assigned with files", "description": "![a](attachment:new-1)", "draft": "[b](attachment:new-1)",
			"files": []any{map[string]any{"name": "a.png", "content_base64": base64.StdEncoding.EncodeToString(tinyPNG(t, 4, 4))}}}
		if assignee != nil {
			data["assigned_agent"] = assignee
		}
		created := crewWrite(t, a, true, "task.create", "", 0, data, 200)
		fid := created["attachments"].([]any)[0].(map[string]any)["id"].(string)
		ev := eventsOf(t, a, created["id"].(string), "task.create")
		if len(ev) != 1 {
			t.Fatal("events", ev)
		}
		var changes map[string]any
		json.Unmarshal([]byte(ev[0].GetString("changes")), &changes)
		if changes["description"] != "![a](attachment:"+fid+")" || changes["draft"] != "[b](attachment:"+fid+")" {
			t.Fatal("event text", assignee, changes)
		}
	}
}

func TestAttachmentReferenceRules(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	other := newTask(t, a, map[string]any{"title": "Other"})
	mine := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task["id"]}), []testFile{{"a.png", tinyPNG(t, 4, 4)}}, 200)["attachments"].([]any)[0].(map[string]any)
	theirs := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": other["id"]}), []testFile{{"b.png", tinyPNG(t, 4, 4)}}, 200)["attachments"].([]any)[0].(map[string]any)
	id := task["id"].(string)
	rev := func() int { return apiWebhookRecord(t, a, "tasks", id).GetInt("revision") }
	for _, text := range []string{
		"![x](attachment:" + theirs["id"].(string) + ")",
		"![x](attachment:zzzzzzzzzzzzzzz)",
		"![x](attachment:nope)",
		"[file](attachment:" + theirs["id"].(string) + ")",
		"[ref]: attachment:" + theirs["id"].(string),
		"<attachment:" + theirs["id"].(string) + ">",
		"![x](data:image/png;base64,iVBORw0KGgo=)",
		"![x](attachment:new-1)",
		// Bypass attempts the reader would decode to the same destination.
		"![x](ATTACHMENT:" + theirs["id"].(string) + ")",
		"[x](Attachment:" + theirs["id"].(string) + ")",
		`![x](attachment\:` + theirs["id"].(string) + ")",
		"![x](attachment&#58;" + theirs["id"].(string) + ")",
		"![x](attachment&colon;" + theirs["id"].(string) + ")",
		"![x](&#97;ttachment:" + theirs["id"].(string) + ")",
		"<ATTACHMENT:" + theirs["id"].(string) + ">",
		"> [ref]: attachment:" + theirs["id"].(string),
		"- item\n\n  [ref]: attachment:" + theirs["id"].(string),
		"> - [ref]: <attachment\\:" + theirs["id"].(string) + ">",
		"![x](&#100;ata:image/png;base64,iVBORw0KGgo=)",
		"![x](DATA:image/png;base64,iVBORw0KGgo=)",
		"> [d]: data:image/png;base64,iVBORw0KGgo=",
		`<img src="data:image/png;base64,iVBORw0KGgo=">`,
		"![x](ATTACHMENT:new-1)",
	} {
		crewWrite(t, a, false, "task.update", id, rev(), map[string]any{"description": text}, 400)
		crewWrite(t, a, true, "task.update", id, rev(), map[string]any{"draft": text}, 400)
	}
	ref := "Before\n\n![shot](attachment:" + mine["id"].(string) + ")\n\nattachment: plain prose is fine\n\n`![code](attachment:zzzzzzzzzzzzzzz)` is code"
	// Decoded variants naming this task's own active file are references too,
	// and valid ones.
	crewWrite(t, a, false, "task.update", id, rev(), map[string]any{"description": "![x](attachment&#58;" + mine["id"].(string) + ")"}, 200)
	crewWrite(t, a, false, "task.update", id, rev(), map[string]any{"description": ref}, 200)
	// Archived: an existing reference may stay, a new one is refused.
	crewWrite(t, a, false, "attachment.archive", mine["id"].(string), 1, map[string]any{}, 200)
	crewWrite(t, a, false, "task.update", id, rev(), map[string]any{"description": ref + "\n\nmore"}, 200)
	crewWrite(t, a, false, "task.update", id, rev(), map[string]any{"draft": "![again](attachment:" + mine["id"].(string) + ")"}, 400)
	crewWrite(t, a, false, "attachment.restore", mine["id"].(string), 2, map[string]any{}, 200)
	crewWrite(t, a, false, "task.update", id, rev(), map[string]any{"draft": "![again](attachment:" + mine["id"].(string) + ")"}, 200)
	// Notes: the same rules, and note.restore may bring back its own archived reference.
	bucket := crewWrite(t, a, true, "bucket.create", "", 0, map[string]any{"name": "REFS"}, 200)
	note := crewWrite(t, a, true, "note.create", "", 0, map[string]any{"bucket": bucket["id"], "title": "Refs", "body": "plain"}, 200)
	shot := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"note": note["id"]}), []testFile{{"n.png", tinyPNG(t, 4, 4)}}, 200)["attachments"].([]any)[0].(map[string]any)
	crewWrite(t, a, true, "note.update", note["id"].(string), 1, map[string]any{"body": "![x](attachment:" + mine["id"].(string) + ")"}, 400)
	withRef := crewWrite(t, a, true, "note.update", note["id"].(string), 1, map[string]any{"body": "![x](attachment:" + shot["id"].(string) + ")"}, 200)
	first, _ := a.app.FindFirstRecordByFilter("crew_note_revisions", "note={:n} && revision=2", map[string]any{"n": note["id"]})
	plain := crewWrite(t, a, true, "note.update", note["id"].(string), int(withRef["revision"].(float64)), map[string]any{"body": "plain again"}, 200)
	crewWrite(t, a, true, "attachment.archive", shot["id"].(string), 1, map[string]any{}, 200)
	restored := crewWrite(t, a, true, "note.restore", note["id"].(string), int(plain["revision"].(float64)), map[string]any{"revision_id": first.Id}, 200)
	if !strings.Contains(restored["body"].(string), shot["id"].(string)) {
		t.Fatal("note.restore lost its reference", restored)
	}
}

func TestAttachmentArchiveRestoreAndEvents(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	att := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task["id"]}), []testFile{{"r.txt", []byte("r")}}, 200)["attachments"].([]any)[0].(map[string]any)
	aid := att["id"].(string)
	crewWrite(t, a, true, "attachment.archive", aid, 5, map[string]any{}, 409)
	archived := crewWrite(t, a, true, "attachment.archive", aid, 1, map[string]any{}, 200)
	if archived["archived"] != true || archived["revision"] != float64(2) || !strings.HasPrefix(archived["archived_by"].(string), "mcp:") || archived["archived_at"] == "" {
		t.Fatal("archive", archived)
	}
	crewWrite(t, a, true, "attachment.archive", aid, 2, map[string]any{}, 400)
	if len(attachmentsOf(t, a, task["id"].(string), false)) != 0 || len(attachmentsOf(t, a, task["id"].(string), true)) != 1 {
		t.Fatal("archived listing")
	}
	restored := crewWrite(t, a, false, "attachment.restore", aid, 2, map[string]any{}, 200)
	if restored["archived"] != false || restored["archived_at"] != "" || restored["revision"] != float64(3) {
		t.Fatal("restore", restored)
	}
	for _, action := range []string{"attachment.add", "attachment.archive", "attachment.restore"} {
		if n := len(eventsOf(t, a, task["id"].(string), action)); n != 1 {
			t.Fatalf("%s events: %d", action, n)
		}
	}
	// Archived parents refuse attachment changes.
	current := apiWebhookRecord(t, a, "tasks", task["id"].(string))
	crewWrite(t, a, false, "task.update", task["id"].(string), current.GetInt("revision"), map[string]any{"archived": true}, 200)
	crewWrite(t, a, false, "attachment.archive", aid, 3, map[string]any{}, 400)
	multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task["id"]}), []testFile{{"x.txt", []byte("x")}}, 400)
}

func TestAttachmentChangesWithdrawReviewWithoutWakes(t *testing.T) {
	a, _, task, first := webhookFixture(t)
	webhookOperation(t, a, "task.update", task.Id, task.GetInt("revision"), map[string]any{"draft": "Synthetic draft"}, "")
	current := apiWebhookRecord(t, a, "tasks", task.Id)
	add := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task.Id}), []testFile{{"before.png", tinyPNG(t, 6, 6)}}, 200)
	before := add["attachments"].([]any)[0].(map[string]any)
	after := apiWebhookRecord(t, a, "tasks", task.Id)
	deliveries := apiWebhookDeliveries(t, a, task.Id)
	if after.GetInt("revision") != current.GetInt("revision") || after.GetInt("wake_generation") != current.GetInt("wake_generation") || after.GetString("readiness") != "ready" {
		t.Fatal("attachment add without review changed the task")
	}
	// Ready tasks keep their pending wake; attachments emit none.
	if apiWebhookRecord(t, a, "webhook_deliveries", first.Id).GetString("state") != "pending" {
		t.Fatal("attachment add cancelled the pending wake")
	}
	review := crewWrite(t, a, true, "review.request", task.Id, after.GetInt("revision"), map[string]any{}, 200)
	var snap []map[string]any
	json.Unmarshal([]byte(apiWebhookRecord(t, a, "reviews", review["id"].(string)).GetString("attachments")), &snap)
	if len(snap) != 1 || snap[0]["id"] != before["id"] || snap[0]["sha256"] != before["sha256"] {
		t.Fatal("review snapshot", snap)
	}
	reviewed := apiWebhookRecord(t, a, "tasks", task.Id)
	withdrawn := crewWrite(t, a, true, "attachment.add", "", 0, map[string]any{"task": task.Id, "files": []any{
		map[string]any{"name": "after.txt", "content_base64": "YWZ0ZXI="}}}, 200)
	if withdrawn["review_withdrawn"] != true {
		t.Fatal("review not withdrawn", withdrawn)
	}
	if apiWebhookRecord(t, a, "reviews", review["id"].(string)).GetString("status") != "withdrawn" {
		t.Fatal("review status")
	}
	changed := apiWebhookRecord(t, a, "tasks", task.Id)
	if changed.GetString("status") != "in_progress" || changed.GetString("readiness") != "waiting" || changed.GetInt("revision") != reviewed.GetInt("revision")+1 {
		t.Fatal("task after withdrawal", changed.PublicExport())
	}
	if len(apiWebhookDeliveries(t, a, task.Id)) != len(deliveries) {
		t.Fatal("attachment change emitted a wake")
	}
	if len(eventsOf(t, a, review["id"].(string), "review.withdraw")) != 1 {
		t.Fatal("withdraw event")
	}
	// Archive and restore withdraw a new pending review too, never waking.
	webhookOperation(t, a, "task.update", task.Id, changed.GetInt("revision"), map[string]any{"readiness": "ready"}, "")
	ready := apiWebhookRecord(t, a, "tasks", task.Id)
	wakes := len(apiWebhookDeliveries(t, a, task.Id))
	again := crewWrite(t, a, false, "review.request", task.Id, ready.GetInt("revision"), map[string]any{}, 200)
	crewWrite(t, a, false, "attachment.archive", before["id"].(string), 1, map[string]any{}, 200)
	if apiWebhookRecord(t, a, "reviews", again["id"].(string)).GetString("status") != "withdrawn" || len(apiWebhookDeliveries(t, a, task.Id)) != wakes {
		t.Fatal("archive did not withdraw quietly")
	}
	// A review with an outdated snapshot cannot be approved.
	third := apiWebhookRecord(t, a, "tasks", task.Id)
	pending := crewWrite(t, a, false, "review.request", task.Id, third.GetInt("revision"), map[string]any{}, 200)
	row := apiWebhookRecord(t, a, "reviews", pending["id"].(string))
	row.Set("attachments", []map[string]any{{"id": "aaaaaaaaaaaaaaa", "sha256": "x"}})
	if err := a.app.Save(row); err != nil {
		t.Fatal(err)
	}
	crewWrite(t, a, false, "review.decide", row.Id, row.GetInt("revision"), map[string]any{"decision": "approved"}, 400)
}

func TestUploadLinkLifecycle(t *testing.T) {
	uploadGuard.reset()
	t.Cleanup(uploadGuard.reset)
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{"title": "Phone screenshots"})
	id := task["id"].(string)
	// Owner browser only; refused for work clients before anything else.
	crewWrite(t, a, true, "upload_link.create", "", 0, map[string]any{"task": id}, 403)
	raw, _ := json.Marshal(map[string]any{"action": "upload_link.create", "data": map[string]any{"task": id}, "idempotency_key": "k"})
	a.request(t, "POST", "/api/crew/write", a.token, string(raw), 400)
	crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": id, "expires_in_minutes": 1441}, 400)
	link := crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": id, "max_files": 2}, 200)
	token := link["token"].(string)
	if len(token) != 43 || link["path"] != "#/upload/"+token || link["state"] != "active" || link["max_files"] != float64(2) {
		t.Fatal("link", link)
	}
	if _, leaked := link["token_hash"]; leaked {
		t.Fatal("hash exported")
	}
	stored := apiWebhookRecord(t, a, "upload_links", link["id"].(string))
	if stored.GetString("token_hash") != digest([]byte(token)) || strings.Contains(fmt.Sprint(stored.PublicExport()), token) {
		t.Fatal("only the hash is stored")
	}
	expires, _ := time.Parse(time.RFC3339, link["expires_at"].(string))
	if d := time.Until(expires); d < 14*time.Minute || d > 16*time.Minute {
		t.Fatal("default expiry", d)
	}
	// The listing never returns the token.
	listed := a.request(t, "POST", "/api/crew/read", a.token, `{"collection":"upload_links","parent":"`+id+`"}`, 200)
	if strings.Contains(fmt.Sprint(listed), token) || strings.Contains(fmt.Sprint(listed), stored.GetString("token_hash")) {
		t.Fatal("listing leaked the token")
	}
	info := uploadInfo(t, a, token, 200)
	if info["title"] != "Phone screenshots" || info["parent_kind"] != "task" || info["max_files"] != float64(2) || len(info) != 6 {
		t.Fatal("info", info)
	}
	uploadInfo(t, a, strings.Repeat("A", 43), 404)
	// The info body is ignored but bounded.
	if res := uploadInfoRaw(a, token, strings.Repeat(" ", uploadInfoBodyLimit+1)); res.Code != http.StatusRequestEntityTooLarge {
		t.Fatal("info body limit", res.Code, res.Body)
	}
	// Upload only: no read access with the token.
	a.request(t, "POST", "/api/crew/read", token, `{"collection":"tasks"}`, 401)
	// The token names its parent; a request cannot pick another.
	uploadLinkRequest(t, a, token, map[string]string{"task": id}, []testFile{{"x.png", tinyPNG(t, 3, 3)}}, 400)
	uploadLinkRequest(t, a, token, nil, []testFile{{"1.png", tinyPNG(t, 3, 3)}, {"2.png", tinyPNG(t, 3, 3)}, {"3.png", tinyPNG(t, 3, 3)}}, 400)
	// A batch where every file fails does not use the link.
	failed, _ := uploadLinkRequest(t, a, token, nil, []testFile{{"empty.png", nil}}, 400)
	if failed["results"].([]any)[0].(map[string]any)["error"].(map[string]any)["code"] != "empty_file" {
		t.Fatal("failed batch", failed)
	}
	done, _ := uploadLinkRequest(t, a, token, nil, []testFile{{"phone.png", tinyPNG(t, 9, 9)}, {"empty.png", nil}}, 200)
	if done["added"] != float64(1) || strings.Contains(fmt.Sprint(done), "id") {
		t.Fatal("upload result", done)
	}
	files := attachmentsOf(t, a, id, false)
	if len(files) != 1 || files[0]["actor"] != "upload_link:"+link["id"].(string) || files[0]["via_upload_link"] != link["id"] {
		t.Fatal("attribution", files)
	}
	ev := eventsOf(t, a, id, "attachment.add")[0]
	if ev.GetString("actor") != "upload_link:"+link["id"].(string) || !strings.Contains(ev.GetString("reason"), link["id"].(string)) || !strings.Contains(ev.GetString("changes"), "via_upload_link") {
		t.Fatal("event attribution", ev.PublicExport())
	}
	// Single use.
	uploadLinkRequest(t, a, token, nil, []testFile{{"again.png", tinyPNG(t, 3, 3)}}, 410)
	uploadInfo(t, a, token, 410)
	used := apiWebhookRecord(t, a, "upload_links", link["id"].(string))
	if used.GetInt("files_added") != 1 || used.GetString("used_at") == "" {
		t.Fatal("link usage", used.PublicExport())
	}
	// Revoke.
	second := crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": id}, 200)
	revoked := crewWrite(t, a, true, "upload_link.revoke", second["id"].(string), 1, map[string]any{}, 200)
	if revoked["state"] != "revoked" {
		t.Fatal("revoke", revoked)
	}
	uploadLinkRequest(t, a, second["token"].(string), nil, []testFile{{"r.png", tinyPNG(t, 3, 3)}}, 410)
	// Expiry.
	third := crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": id}, 200)
	row := apiWebhookRecord(t, a, "upload_links", third["id"].(string))
	row.Set("expires_at", time.Now().Add(-time.Second).UTC().Format(time.RFC3339))
	a.app.Save(row)
	uploadLinkRequest(t, a, third["token"].(string), nil, []testFile{{"e.png", tinyPNG(t, 3, 3)}}, 410)
	// Five failed batches revoke the link.
	fourth := crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": id}, 200)
	for i := 0; i < 5; i++ {
		uploadLinkRequest(t, a, fourth["token"].(string), nil, []testFile{{"empty.png", nil}}, 400)
	}
	uploadLinkRequest(t, a, fourth["token"].(string), nil, []testFile{{"ok.png", tinyPNG(t, 3, 3)}}, 410)
	// Notes work too; archived parents stop links.
	bucket := crewWrite(t, a, false, "bucket.create", "", 0, map[string]any{"name": "LINKS"}, 200)
	note := crewWrite(t, a, false, "note.create", "", 0, map[string]any{"bucket": bucket["id"], "title": "Note upload"}, 200)
	nl := crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"note": note["id"], "expires_in_minutes": 1440}, 200)
	crewWrite(t, a, false, "bucket.update", bucket["id"].(string), 1, map[string]any{"archived": true}, 200)
	uploadInfo(t, a, nl["token"].(string), 410)
}

func uploadInfoRaw(a *testApp, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/api/crew/upload-link/info", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set(uploadTokenHeader, token)
	}
	res := httptest.NewRecorder()
	a.handler.ServeHTTP(res, req)
	return res
}

func uploadInfo(t *testing.T, a *testApp, token string, want int) map[string]any {
	t.Helper()
	res := uploadInfoRaw(a, token, "")
	if res.Code != want {
		t.Fatalf("info: %d %s; want %d", res.Code, res.Body, want)
	}
	var out map[string]any
	json.Unmarshal(res.Body.Bytes(), &out)
	return out
}

func TestUploadLinkRateLimitAndNoWake(t *testing.T) {
	uploadGuard.reset()
	t.Cleanup(uploadGuard.reset)
	a, _, task, _ := webhookFixture(t)
	before := len(apiWebhookDeliveries(t, a, task.Id))
	link := crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": task.Id}, 200)
	generation := apiWebhookRecord(t, a, "tasks", task.Id).GetInt("wake_generation")
	uploadLinkRequest(t, a, link["token"].(string), nil, []testFile{{"w.png", tinyPNG(t, 3, 3)}}, 200)
	if len(apiWebhookDeliveries(t, a, task.Id)) != before || apiWebhookRecord(t, a, "tasks", task.Id).GetInt("wake_generation") != generation {
		t.Fatal("upload link woke the task")
	}
}

// Random-token traffic exhausts only the shared bad bucket: a request holding
// a real link keeps its own allowance, which is itself bounded.
func TestUploadLinkRateBucketsSeparateUnknownTokens(t *testing.T) {
	uploadGuard.reset()
	t.Cleanup(uploadGuard.reset)
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{"title": "Buckets"})
	link := crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": task["id"]}, 200)
	token := link["token"].(string)
	for i := 0; i < uploadBadBurst; i++ {
		uploadInfo(t, a, strings.Repeat("B", 43), 404)
	}
	for _, bad := range []string{strings.Repeat("B", 43), "x", ""} {
		res := uploadInfoRaw(a, bad, "")
		if res.Code != http.StatusTooManyRequests || res.Header().Get("Retry-After") == "" {
			t.Fatal("bad bucket", bad, res.Code, res.Header())
		}
	}
	if c := uploadLinkCode(a, strings.Repeat("D", 43), []testFile{{"x.png", tinyPNG(t, 3, 3)}}); c != http.StatusTooManyRequests {
		t.Fatal("unknown upload token not limited", c)
	}
	// The real link is unaffected by the flood...
	for i := 0; i < uploadLinkBurst-1; i++ {
		uploadInfo(t, a, token, 200)
	}
	uploadLinkRequest(t, a, token, nil, []testFile{{"ok.png", tinyPNG(t, 3, 3)}}, 200)
	// ...but has its own bounded allowance (used or not).
	res := uploadInfoRaw(a, token, "")
	if res.Code != http.StatusTooManyRequests || res.Header().Get("Retry-After") == "" {
		t.Fatal("link bucket", res.Code, res.Body)
	}
	// Buckets refill with time.
	later := time.Now().Add(time.Minute)
	uploadGuard.mu.Lock()
	uploadGuard.now = func() time.Time { return later }
	uploadGuard.mu.Unlock()
	t.Cleanup(func() { uploadGuard.mu.Lock(); uploadGuard.now = time.Now; uploadGuard.mu.Unlock() })
	uploadInfo(t, a, token, 410)
	uploadInfo(t, a, strings.Repeat("B", 43), 404)
}

type watchedBody struct{ read bool }

func (w *watchedBody) Read([]byte) (int, error) {
	w.read = true
	return 0, fmt.Errorf("body must not be read")
}

// Non-multipart uploads are refused before the body is read; uploads beyond
// the in-flight cap get 503 with Retry-After while info still answers.
func TestUploadLinkMultipartOnlyAndInFlightCap(t *testing.T) {
	uploadGuard.reset()
	t.Cleanup(uploadGuard.reset)
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{"title": "Guard"})
	link := crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": task["id"]}, 200)
	token := link["token"].(string)
	inspected := 0
	inspectHook = func() { inspected++ }
	t.Cleanup(func() { inspectHook = nil })
	for _, ct := range []string{"application/json", "application/octet-stream", "text/plain", ""} {
		body := &watchedBody{}
		req := httptest.NewRequest("POST", "/api/crew/upload-link/upload", body)
		req.ContentLength = 100 << 20
		if ct != "" {
			req.Header.Set("Content-Type", ct)
		}
		req.Header.Set(uploadTokenHeader, token)
		res := httptest.NewRecorder()
		a.handler.ServeHTTP(res, req)
		if res.Code != http.StatusUnsupportedMediaType || body.read || inspected != 0 {
			t.Fatal("non-multipart upload", ct, res.Code, body.read, inspected)
		}
	}
	// Fill the in-flight slots.
	for i := 0; i < uploadInFlight; i++ {
		uploadGuard.inflight <- struct{}{}
	}
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, _ := w.CreateFormFile("files", "busy.png")
	part.Write(tinyPNG(t, 3, 3))
	w.Close()
	req := httptest.NewRequest("POST", "/api/crew/upload-link/upload", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set(uploadTokenHeader, token)
	res := httptest.NewRecorder()
	a.handler.ServeHTTP(res, req)
	if res.Code != http.StatusServiceUnavailable || res.Header().Get("Retry-After") == "" || inspected != 0 {
		t.Fatal("in-flight cap", res.Code, res.Header(), inspected)
	}
	uploadInfo(t, a, token, 200)
	for i := 0; i < uploadInFlight; i++ {
		<-uploadGuard.inflight
	}
	uploadLinkRequest(t, a, token, nil, []testFile{{"free.png", tinyPNG(t, 3, 3)}}, 200)
	if len(uploadGuard.inflight) != 0 {
		t.Fatal("slot not released")
	}
	// Form fields other than file parts are refused.
	other := crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": task["id"]}, 200)
	uploadLinkRequest(t, a, other["token"].(string), map[string]string{"token": other["token"].(string)}, []testFile{{"x.png", tinyPNG(t, 3, 3)}}, 400)
}

func attachmentGet(t *testing.T, a *testApp, query, token string, want int) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/crew/attachment?"+query, nil)
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	res := httptest.NewRecorder()
	a.handler.ServeHTTP(res, req)
	if res.Code != want {
		t.Fatalf("GET attachment %s: %d %s; want %d", query, res.Code, res.Body, want)
	}
	return res
}

func TestAttachmentFileServing(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	shot := tinyPNG(t, 400, 200)
	out := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task["id"]}),
		[]testFile{{"wide.png", shot}, {"notes.txt", []byte("plain text")}, {"x.html", []byte("<script>1</script>")}, {"résumé \"quoted\".pdf", []byte("%PDF-1.4 synthetic")}}, 200)
	ids := []string{}
	for _, x := range out["attachments"].([]any) {
		ids = append(ids, x.(map[string]any)["id"].(string))
	}
	attachmentGet(t, a, "id="+ids[0], "", 401)
	attachmentGet(t, a, "id="+ids[0]+"&token=bogus", "", 401)
	// An auth token is not a file token and vice versa.
	attachmentGet(t, a, "id="+ids[0]+"&token="+a.token, "", 401)
	attachmentGet(t, a, "id=zzzzzzzzzzzzzzz", a.token, 404)
	res := attachmentGet(t, a, "id="+ids[0], a.token, 200)
	if !bytes.Equal(res.Body.Bytes(), shot) || res.Header().Get("Content-Type") != "image/png" || !strings.HasPrefix(res.Header().Get("Content-Disposition"), "inline") ||
		res.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(res.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatal("image headers", res.Header())
	}
	if !strings.HasPrefix(attachmentGet(t, a, "id="+ids[0]+"&download=1", a.token, 200).Header().Get("Content-Disposition"), "attachment") {
		t.Fatal("download disposition")
	}
	// File token (what <img src> uses).
	fileToken := a.request(t, "POST", "/api/files/token", a.token, "", 200)["token"].(string)
	thumb := attachmentGet(t, a, "id="+ids[0]+"&thumb=320x0&token="+fileToken, "", 200)
	config, _, err := image.DecodeConfig(bytes.NewReader(thumb.Body.Bytes()))
	if err != nil || config.Width != 320 || config.Height != 160 || thumb.Header().Get("Content-Type") != "image/png" {
		t.Fatal("thumb", config, err, thumb.Header())
	}
	// No upscaling: a 1600 preview of a 400px image is the original.
	if !bytes.Equal(attachmentGet(t, a, "id="+ids[0]+"&thumb=1600x0", a.token, 200).Body.Bytes(), shot) {
		t.Fatal("preview upscaled")
	}
	attachmentGet(t, a, "id="+ids[0]+"&thumb=100x100", a.token, 400)
	attachmentGet(t, a, "id="+ids[1]+"&thumb=320x0", a.token, 400)
	text := attachmentGet(t, a, "id="+ids[1], a.token, 200)
	if text.Header().Get("Content-Type") != "text/plain; charset=utf-8" || !strings.HasPrefix(text.Header().Get("Content-Disposition"), "attachment") {
		t.Fatal("text headers", text.Header())
	}
	html := attachmentGet(t, a, "id="+ids[2], a.token, 200)
	if html.Header().Get("Content-Type") != "application/octet-stream" || !strings.HasPrefix(html.Header().Get("Content-Disposition"), "attachment") {
		t.Fatal("html served actively", html.Header())
	}
	pdf := attachmentGet(t, a, "id="+ids[3], a.token, 200)
	if pdf.Header().Get("Content-Type") != "application/pdf" || !strings.Contains(pdf.Header().Get("Content-Disposition"), "filename*=") {
		t.Fatal("pdf headers", pdf.Header())
	}
	// Range requests (video seeking) work.
	req := httptest.NewRequest("GET", "/api/crew/attachment?id="+ids[1], nil)
	req.Header.Set("Authorization", a.token)
	req.Header.Set("Range", "bytes=0-4")
	res = httptest.NewRecorder()
	a.handler.ServeHTTP(res, req)
	if res.Code != http.StatusPartialContent || res.Body.String() != "plain" {
		t.Fatal("range", res.Code, res.Body.String())
	}
}

func TestAttachmentReadForWorkClients(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	shot := tinyPNG(t, 700, 350)
	text := strings.Repeat("é", 10) + "end"
	out := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task["id"]}),
		[]testFile{{"big.png", shot}, {"t.txt", []byte(text)}, {"b.bin", []byte{0xff, 0xfe, 0x00}}}, 200)
	ids := []string{}
	for _, x := range out["attachments"].([]any) {
		ids = append(ids, x.(map[string]any)["id"].(string))
	}
	read := func(body map[string]any, want int) map[string]any {
		raw, _ := json.Marshal(body)
		return a.request(t, "POST", "/api/crew/attachment-read", a.token, string(raw), want)
	}
	a.request(t, "POST", "/api/crew/attachment-read", "", `{"id":"`+ids[0]+`"}`, 401)
	card := read(map[string]any{"id": ids[0], "variant": "card"}, 200)
	data, _ := base64.StdEncoding.DecodeString(card["content_base64"].(string))
	if card["width"] != float64(320) || card["height"] != float64(160) || card["media_type"] != "image/png" || card["encoding"] != "base64" || len(data) != int(card["length"].(float64)) {
		t.Fatal("card", card["width"], card["height"], card["media_type"])
	}
	if _, ok := card["url"]; ok || card["attachment"].(map[string]any)["file"] != nil {
		t.Fatal("read leaked a URL or storage name")
	}
	preview := read(map[string]any{"id": ids[0], "variant": "preview"}, 200)
	if preview["width"] != float64(700) {
		t.Fatal("preview of a small image is the original", preview["width"])
	}
	// Original bytes page with offset/next_offset.
	page := read(map[string]any{"id": ids[0], "variant": "original", "max_bytes": 100}, 200)
	if page["next_offset"] != float64(100) || page["total_size"] != float64(len(shot)) {
		t.Fatal("original page", page["next_offset"], page["total_size"])
	}
	rest := read(map[string]any{"id": ids[0], "offset": 100, "max_bytes": 4 << 20}, 200)
	b1, _ := base64.StdEncoding.DecodeString(page["content_base64"].(string))
	b2, _ := base64.StdEncoding.DecodeString(rest["content_base64"].(string))
	if !bytes.Equal(append(b1, b2...), shot) || rest["next_offset"] != nil {
		t.Fatal("paged original differs")
	}
	read(map[string]any{"id": ids[0], "max_bytes": (4 << 20) + 1}, 400)
	read(map[string]any{"id": ids[0], "variant": "text"}, 415)
	read(map[string]any{"id": ids[1], "variant": "card"}, 400)
	// Text pages cut on character boundaries.
	first := read(map[string]any{"id": ids[1], "variant": "text", "max_bytes": 5}, 200)
	if first["text"] != "éé" || first["next_offset"] != float64(4) {
		t.Fatal("text page", first)
	}
	read(map[string]any{"id": ids[1], "variant": "text", "offset": 1}, 400)
	whole := read(map[string]any{"id": ids[1], "variant": "text"}, 200)
	if whole["text"] != text || whole["next_offset"] != nil {
		t.Fatal("whole text", whole)
	}
	read(map[string]any{"id": ids[2], "variant": "text"}, 415)
	read(map[string]any{"id": ids[0], "variant": "thumbnail"}, 400)
}

// noisePNG is incompressible, so a small image still has many bytes.
func noisePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	rand.NewChaCha8([32]byte{1}).Read(img.Pix)
	for i := 3; i < len(img.Pix); i += 4 {
		img.Pix[i] = 255
	}
	var b bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// headerOnlyPNG has a valid signature and IHDR for a huge image: verified as
// an image (DecodeConfig) without allocating its pixels.
func headerOnlyPNG(w, h uint32) []byte {
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:], w)
	binary.BigEndian.PutUint32(ihdr[4:], h)
	ihdr[8], ihdr[9] = 8, 2 // 8-bit RGB
	chunk := func(kind string, data []byte) []byte {
		out := binary.BigEndian.AppendUint32(nil, uint32(len(data)))
		body := append([]byte(kind), data...)
		out = append(out, body...)
		return binary.BigEndian.AppendUint32(out, crc32.ChecksumIEEE(body))
	}
	out := append([]byte("\x89PNG\r\n\x1a\n"), chunk("IHDR", ihdr)...)
	return append(out, chunk("IEND", nil)...)
}

// A preview always fits a work-client read: an image already narrower than
// the preview but larger than 4 MiB is re-encoded under the cap, and an image
// over 40 megapixels answers 413 preview_unavailable (metadata only).
func TestAttachmentPreviewStaysUnderReadLimit(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	noisy := noisePNG(t, 1440, 1500)
	if len(noisy) <= attachmentReadMaxBytes || len(noisy) > attachmentMaxBytes {
		t.Fatalf("synthetic noise PNG is %d bytes", len(noisy))
	}
	huge := headerOnlyPNG(8000, 6000)
	out := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task["id"]}),
		[]testFile{{"tall.png", noisy}, {"huge.png", huge}}, 200)
	atts := out["attachments"].([]any)
	noisyID, hugeID := atts[0].(map[string]any)["id"].(string), atts[1].(map[string]any)["id"].(string)
	if atts[1].(map[string]any)["image"] != true || atts[1].(map[string]any)["width"] != float64(8000) {
		t.Fatal("header-only PNG not verified", atts[1])
	}
	read := func(body map[string]any, want int) map[string]any {
		raw, _ := json.Marshal(body)
		return a.request(t, "POST", "/api/crew/attachment-read", a.token, string(raw), want)
	}
	for _, variant := range []string{"preview", "preview", "card"} { // the second preview is cached
		got := read(map[string]any{"id": noisyID, "variant": variant}, 200)
		data, _ := base64.StdEncoding.DecodeString(got["content_base64"].(string))
		if len(data) > attachmentReadMaxBytes || len(data) != int(got["length"].(float64)) {
			t.Fatal(variant, "too large", len(data))
		}
		config, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || got["width"] != float64(config.Width) || config.Width > 1440 || (variant == "card" && config.Width != 320) {
			t.Fatal(variant, format, config, err, got["width"])
		}
		if variant == "preview" && (got["media_type"] != "image/jpeg" || format != "jpeg") {
			t.Fatal("capped preview type", got["media_type"], format)
		}
	}
	for _, variant := range []string{"preview", "card"} {
		got := read(map[string]any{"id": hugeID, "variant": variant}, 413)
		if got["data"].(map[string]any)["code"] != "preview_unavailable" {
			t.Fatal("huge image", variant, got)
		}
	}
	// Metadata and original bytes stay readable.
	page := read(map[string]any{"id": hugeID, "variant": "original", "max_bytes": 8}, 200)
	if page["attachment"].(map[string]any)["height"] != float64(6000) {
		t.Fatal("huge metadata", page)
	}
}

func TestCappedJPEGShrinksUntilItFits(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 600, 400))
	rand.NewChaCha8([32]byte{2}).Read(img.Pix)
	data, err := cappedJPEG(img, 1600, 40<<10)
	if err != nil || len(data) > 40<<10 {
		t.Fatal(len(data), err)
	}
	config, _ := jpeg.DecodeConfig(bytes.NewReader(data))
	if config.Width >= 600 || config.Width*400 > config.Height*600+600 {
		t.Fatal("not shrunk proportionally", config)
	}
	if _, err := cappedJPEG(img, 1600, 10); err == nil {
		t.Fatal("impossible cap accepted")
	}
}

func TestAttachmentSearchAndSQL(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{"title": "Unrelated title"})
	out := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task["id"]}), []testFile{{"zebra-crossing.png", tinyPNG(t, 3, 3)}}, 200)
	att := out["attachments"].([]any)[0].(map[string]any)
	hits := crewPost(t, a, "/api/crew/search", map[string]any{"query": "zebra"}, 200)["items"].([]any)
	if len(hits) != 1 || hits[0].(map[string]any)["id"] != task["id"] {
		t.Fatal("search by attachment name", hits)
	}
	crewWrite(t, a, false, "attachment.archive", att["id"].(string), 1, map[string]any{}, 200)
	if hits := crewPost(t, a, "/api/crew/search", map[string]any{"query": "zebra"}, 200)["items"].([]any); len(hits) != 0 {
		t.Fatal("archived attachment name still found", hits)
	}
	crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": task["id"]}, 200)
	stored, _ := a.app.FindRecordById("crew_attachments", att["id"].(string))
	result := crewSQL(t, a, "SELECT * FROM attachments", 200)
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), stored.GetString("file")) || !strings.Contains(string(raw), att["sha256"].(string)) {
		t.Fatal("attachments view", string(raw))
	}
	for _, sql := range []string{"SELECT file FROM attachments", "SELECT file FROM crew_attachments", "SELECT * FROM upload_links", "SELECT token_hash FROM crew_upload_links", "SELECT * FROM crew_settings"} {
		crewSQL(t, a, sql, 400)
	}
}

func TestAttachmentCapabilities(t *testing.T) {
	a := newTestApp(t)
	doc := capabilitiesItem(t, a, `{"collection":"capabilities"}`)
	ops := doc["operations"].(map[string]any)
	for _, name := range []string{"attachment.add", "attachment.archive", "attachment.restore", "upload_link.create", "upload_link.revoke", "storage.update"} {
		if ops[name] == nil {
			t.Fatal("missing operation", name)
		}
	}
	if ops["upload_link.create"].(map[string]any)["authority"] != "owner_browser" || ops["storage.update"].(map[string]any)["authority"] != "shared_mcp" {
		t.Fatal("authority", ops["upload_link.create"], ops["storage.update"])
	}
	create := ops["task.create"].(map[string]any)["data_schema"].(map[string]any)["properties"].(map[string]any)
	if create["files"] == nil || ops["task.update"].(map[string]any)["data_schema"].(map[string]any)["properties"].(map[string]any)["files"] != nil {
		t.Fatal("files only on create")
	}
	att := doc["attachments"].(map[string]any)
	if att["limits"].(map[string]any)["max_file_bytes"] != float64(attachmentMaxBytes) || att["limits"].(map[string]any)["max_base64_bytes_per_request"] != float64(attachmentBase64MaxBytes) {
		t.Fatal("limits drifted from the server", att["limits"])
	}
	defs := doc["$defs"].(map[string]any)
	if defs["attachments"] == nil || defs["upload_links"] == nil || defs["settings"] == nil {
		t.Fatal("collection definitions")
	}
	if _, ok := defs["attachments"].(map[string]any)["properties"].(map[string]any)["file"]; ok {
		t.Fatal("storage name documented as readable")
	}
}

func TestAttachmentArchiveRetryReplays(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	att := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task["id"]}), []testFile{{"k.txt", []byte("k")}}, 200)["attachments"].([]any)[0].(map[string]any)
	raw, _ := json.Marshal(map[string]any{"action": "attachment.archive", "id": att["id"], "expected_revision": 1, "data": map[string]any{}, "idempotency_key": "archive-once"})
	first := a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 200)
	again := a.request(t, "POST", "/api/crew/agent-write", a.token, string(raw), 200)
	if first["revision"] != float64(2) || again["revision"] != float64(2) || len(eventsOf(t, a, task["id"].(string), "attachment.archive")) != 1 {
		t.Fatal("archive retry did not replay", first, again)
	}
}

func uploadLinkCode(a *testApp, token string, files []testFile) int {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	for _, f := range files {
		part, _ := w.CreateFormFile("files", f.name)
		part.Write(f.data)
	}
	w.Close()
	req := httptest.NewRequest("POST", "/api/crew/upload-link/upload", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set(uploadTokenHeader, token)
	res := httptest.NewRecorder()
	a.handler.ServeHTTP(res, req)
	return res.Code
}

// Simultaneous batches with one token: exactly one uses the link; the others
// see it used, so the link never adds more than max_files.
func TestUploadLinkConcurrentBatchesUseItOnce(t *testing.T) {
	uploadGuard.reset()
	t.Cleanup(uploadGuard.reset)
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{"title": "Race"})
	id := task["id"].(string)
	link := crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": id, "max_files": 2}, 200)
	token := link["token"].(string)
	files := []testFile{{"a.png", tinyPNG(t, 40, 40)}, {"b.png", tinyPNG(t, 41, 41)}}
	const n = 6
	codes := make(chan int, n)
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		go func() {
			<-start
			codes <- uploadLinkCode(a, token, files)
		}()
	}
	close(start)
	ok, gone, busy := 0, 0, 0
	for i := 0; i < n; i++ {
		switch c := <-codes; c {
		case 200:
			ok++
		case 410:
			gone++
		case 503: // beyond the in-flight cap
			busy++
		default:
			t.Fatalf("unexpected status %d", c)
		}
	}
	if ok != 1 || gone+busy != n-1 {
		t.Fatalf("ok=%d gone=%d busy=%d", ok, gone, busy)
	}
	if got := len(attachmentsOf(t, a, id, false)); got != 2 {
		t.Fatalf("attachments %d, want 2", got)
	}
	if row := apiWebhookRecord(t, a, "upload_links", link["id"].(string)); row.GetInt("files_added") != 2 {
		t.Fatal("files_added", row.PublicExport())
	}
}

// An unknown, used or archived-parent token is refused before any file is
// inspected or stored; per-file names are sanitized; info shows nothing but
// the title and limits, and upload never echoes record ids or storage names.
func TestUploadLinkRefusesBeforeFilesAndSanitizes(t *testing.T) {
	uploadGuard.reset()
	t.Cleanup(uploadGuard.reset)
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{"title": "Names", "description": "secret description"})
	id := task["id"].(string)
	inspected := 0
	inspectHook = func() { inspected++ }
	t.Cleanup(func() { inspectHook = nil })
	if c := uploadLinkCode(a, strings.Repeat("C", 43), []testFile{{"x.png", tinyPNG(t, 3, 3)}}); c != 404 {
		t.Fatal("unknown token", c)
	}
	if c := uploadLinkCode(a, "short", []testFile{{"x.png", tinyPNG(t, 3, 3)}}); c != 404 {
		t.Fatal("malformed token", c)
	}
	if inspected != 0 { // writes inspect too, so count only around uploads
		t.Fatal("files inspected for an unknown token")
	}
	link := crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": id}, 200)
	info := uploadInfo(t, a, link["token"].(string), 200)
	if strings.Contains(fmt.Sprint(info), "secret") || strings.Contains(fmt.Sprint(info), id) {
		t.Fatal("info leaked", info)
	}
	out, _ := uploadLinkRequest(t, a, link["token"].(string), nil, []testFile{{`..\..\evil` + "\u202e" + `/../../etc/passwd.png`, tinyPNG(t, 4, 4)}}, 200)
	if strings.Contains(fmt.Sprint(out), "a_") || strings.Contains(fmt.Sprint(out), id) {
		t.Fatal("upload response leaked ids or storage names", out)
	}
	files := attachmentsOf(t, a, id, false)
	if len(files) != 1 || files[0]["name"] != "passwd.png" {
		t.Fatal("sanitized name", files)
	}
	if got := cleanAttachmentName("report\u202egnp.exe"); got != "reportgnp.exe" {
		t.Fatal("bidi override kept", got)
	}
	inspected = 0
	if c := uploadLinkCode(a, link["token"].(string), []testFile{{"again.png", tinyPNG(t, 3, 3)}}); c != 410 || inspected != 0 {
		t.Fatal("used link", c, inspected)
	}
	// Archived task: refused before inspection.
	other := newTask(t, a, map[string]any{"title": "Archived later"})
	l2 := crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": other["id"]}, 200)
	crewWrite(t, a, false, "task.update", other["id"].(string), 1, map[string]any{"archived": true}, 200)
	inspected = 0
	if c := uploadLinkCode(a, l2["token"].(string), []testFile{{"x.png", tinyPNG(t, 3, 3)}}); c != 410 || inspected != 0 {
		t.Fatal("archived parent", c, inspected)
	}
}

// A supplied name keeps only its last path segment (either separator) for
// multipart, base64 and upload-link files alike; a name with nothing after
// the last separator is refused as invalid_name.
func TestAttachmentNamesKeepLastPathSegment(t *testing.T) {
	uploadGuard.reset()
	t.Cleanup(uploadGuard.reset)
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{"title": "Names"})
	id := task["id"].(string)
	names := map[string]string{
		"logs/run/app.log":            "app.log",
		`C:\Users\synthetic\shot.png`: "shot.png",
		`..\../mixed/notes.txt`:       "notes.txt",
		"\u202edir/\u2066report.md":   "report.md",
	}
	data := []byte("synthetic")
	var multipartFiles []testFile
	var base64Files []any
	for in := range names {
		multipartFiles = append(multipartFiles, testFile{in, data})
		base64Files = append(base64Files, map[string]any{"name": in, "content_base64": base64.StdEncoding.EncodeToString(data)})
	}
	check := func(results []any, how string) {
		t.Helper()
		got := map[string]bool{}
		for _, r := range results {
			m := r.(map[string]any)
			if m["ok"] != true {
				t.Fatal(how, "refused", m)
			}
			got[m["name"].(string)] = true
		}
		for _, want := range names {
			if !got[want] {
				t.Fatal(how, "missing", want, results)
			}
		}
	}
	out := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": id}), multipartFiles, 200)
	check(out["results"].([]any), "multipart")
	out = crewWrite(t, a, true, "attachment.add", "", 0, map[string]any{"task": id, "files": base64Files}, 200)
	check(out["results"].([]any), "base64")
	other := newTask(t, a, map[string]any{"title": "Link names"})
	link := crewWrite(t, a, false, "upload_link.create", "", 0, map[string]any{"task": other["id"], "max_files": 4}, 200)
	linked, _ := uploadLinkRequest(t, a, link["token"].(string), nil, multipartFiles, 200)
	check(linked["results"].([]any), "upload link")
	// Nothing after the last separator: invalid_name, for both transports.
	bad := crewWrite(t, a, true, "attachment.add", "", 0, map[string]any{"task": id, "files": []any{
		map[string]any{"name": "folder/", "content_base64": base64.StdEncoding.EncodeToString(data)}}}, 400)
	if fileErrors(bad)["files.1"].(map[string]any)["code"] != "invalid_name" {
		t.Fatal("trailing separator", bad)
	}
	for _, name := range []string{`folder\`, "folder/", "a/.."} {
		bad = multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": id}), []testFile{{name, data}}, 400)
		if fileErrors(bad)["files.1"].(map[string]any)["code"] != "invalid_name" {
			t.Fatal("no last segment", name, bad)
		}
	}
}
