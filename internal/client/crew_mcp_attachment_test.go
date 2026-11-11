package client

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	imagepng "image/png"
	"net/http"
	"strings"
	"testing"
)

// fakeAttachments serves the attachment listing and attachment-read for
// synthetic files. imageSize sets the decoded size of each preview.
type fakeAttachments struct {
	t         *testing.T
	imageSize int
	reads     []map[string]any
}

func (f *fakeAttachments) meta(id string) map[string]any {
	n := int(id[len(id)-1] - '0')
	m := map[string]any{"id": id, "name": fmt.Sprintf("file%d", n), "size": 10, "sha256": "x", "position": n}
	switch {
	case strings.HasPrefix(id, "img"):
		m["image"], m["media_type"], m["width"], m["height"], m["name"] = true, "image/png", 3200, 2000, fmt.Sprintf("shot%d.png", n)
	case strings.HasPrefix(id, "txt"):
		m["image"], m["media_type"], m["name"] = false, "text/plain", "run.log"
	default:
		m["image"], m["media_type"], m["name"], m["size"] = false, "application/pdf", "spec.pdf", 9
	}
	return m
}

func (f *fakeAttachments) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	w.Header().Set("Content-Type", "application/json")
	switch r.URL.Path {
	case "/api/crew/read":
		if body["collection"] != "attachments" || body["parent"] != "taskidtaskidtas" {
			f.t.Fatalf("listing: %v", body)
		}
		items := []any{}
		for i := 1; i <= 8; i++ {
			items = append(items, f.meta(fmt.Sprintf("imgimgimgimgim%d", i)))
		}
		items = append(items, f.meta("txttxttxttxttx1"), f.meta("pdfpdfpdfpdfpd1"))
		_ = json.NewEncoder(w).Encode(map[string]any{"items": items, "has_more": false})
	case "/api/crew/attachment-read":
		f.reads = append(f.reads, body)
		id, _ := body["id"].(string)
		meta := f.meta(id)
		out := map[string]any{"attachment": meta, "variant": body["variant"]}
		content := []byte("synthetic text\n")
		if meta["media_type"] == "application/pdf" {
			content = []byte("%PDF\xff\xfe..")
		}
		switch body["variant"] {
		case "preview", "card":
			out["media_type"], out["encoding"], out["width"], out["height"] = "image/png", "base64", 1600, 1000
			out["content_base64"] = base64.StdEncoding.EncodeToString([]byte(strings.Repeat("p", f.imageSize)))
		case "text":
			if meta["media_type"] != "text/plain" {
				w.WriteHeader(415)
				_, _ = w.Write([]byte(`{"status":415,"message":"Not UTF-8 text; read the original bytes"}`))
				return
			}
			out["encoding"], out["text"], out["next_offset"] = "utf-8", string(content), nil
		default:
			limit := len(content)
			if m, ok := body["max_bytes"].(float64); ok && int(m) < limit {
				limit = int(m)
			}
			out["encoding"], out["content_base64"] = "base64", base64.StdEncoding.EncodeToString(content[:limit])
			out["offset"], out["length"], out["media_type"] = 0, limit, meta["media_type"]
		}
		_ = json.NewEncoder(w).Encode(out)
	default:
		f.t.Fatalf("unexpected API call %s", r.URL.Path)
	}
}

// mcpContentBlocks calls a tool and returns its raw content blocks.
func mcpContentBlocks(t *testing.T, h http.Handler, args map[string]any, wantError bool) []map[string]any {
	t.Helper()
	result := mcpRequest(t, h, "synthetic", "tools/call", map[string]any{"name": "crew_attachment", "arguments": args})
	r, _ := result["result"].(map[string]any)
	if (r["isError"] == true) != wantError {
		t.Fatalf("%v: unexpected result %v", args, result)
	}
	var blocks []map[string]any
	for _, c := range asList(r["content"]) {
		blocks = append(blocks, c.(map[string]any))
	}
	return blocks
}

func headJSON(t *testing.T, blocks []map[string]any) map[string]any {
	t.Helper()
	var out map[string]any
	if blocks[0]["type"] != "text" || json.Unmarshal([]byte(blocks[0]["text"].(string)), &out) != nil {
		t.Fatalf("first block is not JSON text: %v", blocks[0])
	}
	return out
}

func TestCrewMCPAttachmentImagesPageAsImageContent(t *testing.T) {
	api := &fakeAttachments{t: t, imageSize: 1000}
	h := mcpTestHandler(api)
	blocks := mcpContentBlocks(t, h, map[string]any{"parent": "taskidtaskidtas"}, false)
	head := headJSON(t, blocks)
	if len(blocks) != 1+mcpImagesPerCall || head["next_offset"] != float64(6) || head["total_images"] != float64(8) {
		t.Fatalf("first page: %d blocks, %v", len(blocks), head)
	}
	for _, b := range blocks[1:] {
		data, _ := base64.StdEncoding.DecodeString(b["data"].(string))
		if b["type"] != "image" || b["mimeType"] != "image/png" || len(data) != 1000 {
			t.Fatalf("image block: %v", b)
		}
	}
	if files := head["other_files"].([]any); len(files) != 2 || dig(files[0], "name") != "run.log" {
		t.Fatalf("other files: %v", files)
	}
	for _, read := range api.reads {
		if read["variant"] != "preview" {
			t.Fatalf("default variant: %v", read)
		}
	}
	blocks = mcpContentBlocks(t, h, map[string]any{"parent": "taskidtaskidtas", "offset": 6, "variant": "card"}, false)
	head = headJSON(t, blocks)
	if len(blocks) != 3 || head["next_offset"] != nil || dig(head["images"].([]any)[0], "id") != "imgimgimgimgim7" {
		t.Fatalf("last page: %d blocks %v", len(blocks), head)
	}

	// Large previews: the page stops at the image byte budget, but always
	// returns at least one image.
	api.imageSize = 1800 << 10
	blocks = mcpContentBlocks(t, h, map[string]any{"parent": "taskidtaskidtas"}, false)
	if head = headJSON(t, blocks); len(blocks) != 3 || head["next_offset"] != float64(2) {
		t.Fatalf("budgeted page: %d blocks %v", len(blocks), head)
	}
	api.imageSize = mcpImageBudget
	blocks = mcpContentBlocks(t, h, map[string]any{"parent": "taskidtaskidtas", "offset": 7}, false)
	if head = headJSON(t, blocks); len(blocks) != 2 || head["next_offset"] != nil {
		t.Fatalf("single large image: %d blocks %v", len(blocks), head)
	}
	for _, bad := range []map[string]any{
		{"parent": "taskidtaskidtas", "variant": "original"},
		{"parent": "taskidtaskidtas", "offset": 9},
		{"parent": "taskidtaskidtas", "id": "imgimgimgimgim1"},
		{},
	} {
		mcpContentBlocks(t, h, bad, true)
	}
}

func TestCrewMCPAttachmentOneFile(t *testing.T) {
	api := &fakeAttachments{t: t, imageSize: 500}
	h := mcpTestHandler(api)
	// An image defaults to its preview.
	blocks := mcpContentBlocks(t, h, map[string]any{"id": "imgimgimgimgim1"}, false)
	if head := headJSON(t, blocks); len(blocks) != 2 || blocks[1]["type"] != "image" || head["variant"] != "preview" || dig(head, "attachment", "name") != "shot1.png" {
		t.Fatalf("image: %v", blocks)
	}
	// The original of a small image is an image too.
	blocks = mcpContentBlocks(t, h, map[string]any{"id": "imgimgimgimgim1", "variant": "original"}, false)
	if len(blocks) != 2 || blocks[1]["type"] != "image" {
		t.Fatalf("original image: %v", blocks)
	}
	if last := api.reads[len(api.reads)-1]; last["variant"] != "original" || last["max_bytes"] != float64(10) {
		t.Fatalf("original read: %v", last)
	}
	// UTF-8 files default to text.
	out := mcpCall(t, h, "synthetic", "crew_attachment", map[string]any{"id": "txttxttxttxttx1"}, false)
	if dig(out, "text") != "synthetic text\n" {
		t.Fatalf("text: %v", out)
	}
	// Other files return metadata unless bytes are requested.
	out = mcpCall(t, h, "synthetic", "crew_attachment", map[string]any{"id": "pdfpdfpdfpdfpd1"}, false)
	if dig(out, "variant") != "metadata" || dig(out, "content_base64") != nil || dig(out, "attachment", "name") != "spec.pdf" {
		t.Fatalf("metadata: %v", out)
	}
	out = mcpCall(t, h, "synthetic", "crew_attachment", map[string]any{"id": "pdfpdfpdfpdfpd1", "variant": "original", "max_bytes": 4}, false)
	if data, _ := base64.StdEncoding.DecodeString(dig(out, "content_base64").(string)); string(data) != "%PDF" {
		t.Fatalf("bytes: %v", out)
	}
	// Explicit text on a binary file is an error; bounds are checked first.
	for _, bad := range []map[string]any{
		{"id": "pdfpdfpdfpdfpd1", "variant": "text"},
		{"id": "pdfpdfpdfpdfpd1", "variant": "preview"},
		{"id": "pdfpdfpdfpdfpd1", "variant": "original", "max_bytes": mcpOriginalMax + 1},
		{"id": "imgimgimgimgim1", "variant": "thumb"},
		{"id": "imgimgimgimgim1", "offset": -1},
	} {
		mcpContentBlocks(t, h, bad, true)
	}
}

func TestCrewMCPAttachmentReadAllowedButNotOwnerFileRoutes(t *testing.T) {
	if !mcpAPIAllowed("POST", "/api/crew/attachment-read") {
		t.Fatal("attachment-read unavailable through MCP")
	}
	for _, path := range []string{"/api/crew/attachment", "/api/files/token", "/api/crew/upload-link/upload", "/api/crew/upload-link/info", "/api/crew/attachment-read/"} {
		for _, method := range []string{"GET", "POST"} {
			if mcpAPIAllowed(method, path) {
				t.Errorf("MCP exposes %s %s", method, path)
			}
		}
	}
	if mcpAPIAllowed("GET", "/api/crew/attachment-read") {
		t.Fatal("MCP exposes GET attachment-read")
	}
}

// Against the real API and hooks: base64 attach through crew_write, then
// image content, text and bytes through crew_attachment.
func TestCrewMCPAttachmentRealWorkflow(t *testing.T) {
	api, token := mcpRealAPI(t)
	h := mcpTestHandler(api)
	var png bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 2000, 40))
	for x := 0; x < 2000; x++ {
		img.Set(x, x%40, color.RGBA{uint8(x), 90, 200, 255})
	}
	if err := imagepng.Encode(&png, img); err != nil {
		t.Fatal(err)
	}
	files := []any{
		map[string]any{"name": "step-1.png", "content_base64": base64.StdEncoding.EncodeToString(png.Bytes())},
		map[string]any{"name": "run.log", "content_base64": base64.StdEncoding.EncodeToString([]byte("synthetic log\n"))},
	}
	task := mcpCall(t, h, token, "crew_write", map[string]any{"action": "task.create", "reported_agent": "Network",
		"data": map[string]any{"title": "Synthetic screenshot bug", "description": "![step 1](attachment:new-1)", "files": files}}, false)
	attachments := dig(task, "attachments").([]any)
	if len(attachments) != 2 || dig(task, "description") != fmt.Sprintf("![step 1](attachment:%s)", dig(attachments[0], "id")) {
		t.Fatalf("create with files: %v", task)
	}
	result := mcpRequest(t, h, token, "tools/call", map[string]any{"name": "crew_attachment", "arguments": map[string]any{"parent": dig(task, "id")}})
	content := asList(dig(result, "result", "content"))
	if len(content) != 2 || dig(content[1], "type") != "image" || dig(content[1], "mimeType") != "image/png" {
		t.Fatalf("parent images: %v", content)
	}
	data, _ := base64.StdEncoding.DecodeString(dig(content[1], "data").(string))
	if config, err := imagepng.DecodeConfig(bytes.NewReader(data)); err != nil || config.Width != 1600 {
		t.Fatalf("preview: %v %v", config, err)
	}
	text := mcpCall(t, h, token, "crew_attachment", map[string]any{"id": dig(attachments[1], "id")}, false)
	if dig(text, "text") != "synthetic log\n" {
		t.Fatalf("text: %v", text)
	}
	original := mcpCall(t, h, token, "crew_attachment", map[string]any{"id": dig(attachments[1], "id"), "variant": "original"}, false)
	if raw, _ := base64.StdEncoding.DecodeString(dig(original, "content_base64").(string)); string(raw) != "synthetic log\n" {
		t.Fatalf("original: %v", original)
	}
	listed := mcpCall(t, h, token, "crew_read", map[string]any{"collection": "attachments", "parent": dig(task, "id"), "fields": []any{"name", "sha256"}}, false)
	if items := dig(listed, "items").([]any); len(items) != 2 || dig(items[0], "name") != "step-1.png" {
		t.Fatalf("listing: %v", listed)
	}
	// Upload links stay owner-browser-only.
	mcpCall(t, h, token, "crew_write", map[string]any{"action": "upload_link.create", "reported_agent": "Network", "data": map[string]any{"task": dig(task, "id")}}, true)
}
