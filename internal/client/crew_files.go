package client

// File transport for the CLI work commands. attach and write --file send
// multipart requests to the work-client route (field @jsonPayload holds the
// same JSON envelope crew_write sends; file parts are named files). attachment
// downloads through the bounded work-client read, verifies the checksum and
// never overwrites a file.
import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	crewAttachmentRoute   = "/api/crew/attachment-read"
	crewFileMaxBytes      = 20 << 20 // per file, as on the server
	crewFilesPerRequest   = 20       // server maximum per request
	crewFileTimeout       = 10 * time.Minute
	crewReadOriginalBytes = 4 << 20 // attachment-read maximum for original
	crewReadTextBytes     = 2 << 20 // attachment-read maximum for text
)

// crewMultipartBudget is the file bytes per multipart request; the server
// accepts 90 MiB in total (under Cloudflare's 100 MB request limit), leaving
// 1 MiB for the envelope. A variable so tests can force batching.
var crewMultipartBudget int64 = 89 << 20

var crewAttachmentVariants = map[string]bool{"original": true, "preview": true, "card": true, "text": true}

// crewFile is one local file to send, checked before any request.
type crewFile struct {
	path, name string
	size       int64
}

// checkCrewFiles checks local files (regular, non-empty, at most 20 MiB) and
// names each by its base name.
func checkCrewFiles(command string, paths []string) ([]crewFile, error) {
	if len(paths) > crewFilesPerRequest {
		return nil, fail(2, "%s: at most %d files per command (an item holds at most 20 active attachments)", command, crewFilesPerRequest)
	}
	files := make([]crewFile, 0, len(paths))
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil {
			return nil, fail(2, "%s: %v", command, err)
		}
		if !info.Mode().IsRegular() {
			return nil, fail(2, "%s: %s is not a regular file", command, path)
		}
		if info.Size() == 0 {
			return nil, fail(2, "%s: %s is empty", command, path)
		}
		if info.Size() > crewFileMaxBytes {
			return nil, fail(2, "%s: %s is larger than 20 MiB, the per-file limit", command, path)
		}
		files = append(files, crewFile{path: path, name: filepath.Base(path), size: info.Size()})
	}
	return files, nil
}

// multipartBody builds the multipart request: the JSON envelope, then files.
func multipartBody(envelope any, files []crewFile) ([]byte, string, error) {
	payload, err := json.Marshal(envelope)
	if err != nil {
		return nil, "", err
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	if err := w.WriteField("@jsonPayload", string(payload)); err != nil {
		return nil, "", err
	}
	for _, f := range files {
		part, err := w.CreateFormFile("files", f.name)
		if err != nil {
			return nil, "", err
		}
		in, err := os.Open(f.path)
		if err != nil {
			return nil, "", fail(1, "reading %s: %v", f.path, err)
		}
		n, err := io.Copy(part, io.LimitReader(in, crewFileMaxBytes+1))
		in.Close()
		if err != nil {
			return nil, "", fail(1, "reading %s: %v", f.path, err)
		}
		if n != f.size {
			return nil, "", fail(1, "%s changed while it was being sent; nothing was sent", f.path)
		}
	}
	if err := w.Close(); err != nil {
		return nil, "", err
	}
	return body.Bytes(), w.FormDataContentType(), nil
}

// sendFiles sends one multipart write and returns the HTTP status and body.
func sendFiles(c *Client, path string, envelope any, files []crewFile) (int, any, error) {
	raw, contentType, err := multipartBody(envelope, files)
	if err != nil {
		return 0, nil, err
	}
	saved := c.LongTimeout
	c.LongTimeout = crewFileTimeout
	defer func() { c.LongTimeout = saved }()
	return c.send("POST", path, nil, nil, contentType, raw)
}

// --- attach ---------------------------------------------------------------

type attachCommand struct {
	kind, parent string
	envelope     map[string]any
	files        []crewFile
}

func prepareAttach(a *args) (*attachCommand, error) {
	usage := crewCommandUsage["attach"]
	if len(a.pos) == 0 {
		return nil, fail(2, "usage: pocketcontext-crew %s", usage)
	}
	task, note := a.flags["task"], a.flags["note"]
	if (task == "") == (note == "") {
		return nil, fail(2, "attach: name exactly one of --task ID or --note ID")
	}
	kind, parent := "task", task
	if note != "" {
		kind, parent = "note", note
	}
	if !idPattern.MatchString(parent) {
		return nil, fail(2, "attach: --%s must be a 15-character Crew id", kind)
	}
	agent := strings.TrimSpace(a.flags["reported-agent"])
	if agent == "" {
		return nil, fail(2, "attach: --reported-agent NAME is required (your agent name; attribution, not identity)")
	}
	envelope := map[string]any{"action": "attachment.add", "reported_agent": agent, "reason": a.flags["reason"], "data": map[string]any{kind: parent}}
	if raw, ok := a.flags["execution"]; ok {
		var proof map[string]any
		if err := json.Unmarshal([]byte(raw), &proof); err != nil || proof == nil {
			return nil, fail(2, "attach: --execution must be a JSON object {id,worker_id,fence}")
		}
		envelope["execution"] = proof
	}
	files, err := checkCrewFiles("attach", a.pos)
	if err != nil {
		return nil, err
	}
	return &attachCommand{kind: kind, parent: parent, envelope: envelope, files: files}, nil
}

// batches splits files into requests of at most 20 files and 89 MiB.
func (a *attachCommand) batches() [][]crewFile {
	var out [][]crewFile
	var current []crewFile
	var size int64
	for _, f := range a.files {
		if len(current) > 0 && (len(current) == crewFilesPerRequest || size+f.size > crewMultipartBudget) {
			out, current, size = append(out, current), nil, 0
		}
		current, size = append(current, f), size+f.size
	}
	return append(out, current)
}

// run sends each batch and reports every file. It exits nonzero only when no
// file was saved; any other refusal (missing item, conflict, rate limit)
// stops at once.
func (a *attachCommand) run(c *Client) (any, error) {
	results := []map[string]any{}
	attachments := []any{}
	saved, offset := 0, 0
	withdrawn := false
	for _, batch := range a.batches() {
		status, data, err := sendFiles(c, crewWriteRoute, a.envelope, batch)
		if err != nil {
			return nil, err
		}
		perFile := map[int]map[string]any{}
		switch {
		case status < 300:
			for _, r := range asList(dig(data, "results")) {
				if m, ok := r.(map[string]any); ok {
					perFile[intValue(m["index"])] = m
				}
			}
			attachments = append(attachments, asList(dig(data, "attachments"))...)
			if dig(data, "review_withdrawn") == true {
				withdrawn = true
			}
		case status == 400 && hasFileErrors(data):
			fields, _ := dig(data, "data").(map[string]any)
			for key, value := range fields {
				if n, err := strconv.Atoi(strings.TrimPrefix(key, "files.")); err == nil {
					perFile[n] = map[string]any{"ok": false, "error": value}
				}
			}
		default:
			if _, err := checked("POST", crewWriteRoute, status, data); err != nil {
				if saved > 0 {
					return nil, fail(1, "%v\n%d file(s) were already saved; read the %s's attachments before retrying", err, saved, a.kind)
				}
				return nil, err
			}
		}
		for i, f := range batch {
			r := map[string]any{"index": offset + i + 1, "file": f.path, "name": f.name, "ok": false}
			if got, ok := perFile[i+1]; ok {
				r["ok"] = got["ok"] == true
				if id, ok := got["id"]; ok {
					r["id"] = id
				}
				if e, ok := got["error"]; ok {
					r["error"] = e
				}
			} else {
				r["error"] = map[string]any{"code": "unknown", "message": "the server reported no result for this file"}
			}
			if r["ok"] == true {
				saved++
			}
			results = append(results, r)
		}
		offset += len(batch)
	}
	out := map[string]any{a.kind: a.parent, "saved": saved, "failed": len(a.files) - saved, "results": results, "attachments": attachments, "review_withdrawn": withdrawn}
	if saved == 0 {
		return out, fail(1, "attach: no file was saved; see results")
	}
	return out, nil
}

func hasFileErrors(data any) bool {
	fields, _ := dig(data, "data").(map[string]any)
	for key := range fields {
		if strings.HasPrefix(key, "files.") {
			return true
		}
	}
	return false
}

func asList(v any) []any { l, _ := v.([]any); return l }

func intValue(v any) int {
	switch n := v.(type) {
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	case float64:
		return int(n)
	case int:
		return n
	}
	return 0
}

// --- attachment (download) ------------------------------------------------

type downloadCommand struct {
	id, out, variant string
}

func prepareDownload(a *args) (*downloadCommand, error) {
	if err := a.need(1, crewCommandUsage["attachment"]); err != nil {
		return nil, err
	}
	d := &downloadCommand{id: a.pos[0], out: a.flags["out"], variant: a.flags["variant"]}
	if !idPattern.MatchString(d.id) {
		return nil, fail(2, "attachment: ID must be a 15-character Crew attachment id")
	}
	if d.variant == "" {
		d.variant = "original"
	}
	if !crewAttachmentVariants[d.variant] {
		return nil, fail(2, "attachment: --variant must be original, preview, card or text")
	}
	if strings.TrimSpace(d.out) == "" {
		return nil, fail(2, "attachment: --out FILE (or an existing directory) is required")
	}
	if info, err := os.Stat(d.out); err == nil && !info.IsDir() {
		return nil, fail(2, "attachment: %s already exists; choose a new file name", d.out)
	} else if err == nil {
		return d, nil
	}
	if info, err := os.Stat(filepath.Dir(d.out)); err != nil || !info.IsDir() {
		return nil, fail(2, "attachment: the folder of %s does not exist", d.out)
	}
	return d, nil
}

func (d *downloadCommand) read(c *Client, offset int64, maxBytes int) (map[string]any, error) {
	body := map[string]any{"id": d.id, "variant": d.variant}
	if d.variant == "original" || d.variant == "text" {
		body["offset"], body["max_bytes"] = offset, maxBytes
	}
	data, err := c.Must("POST", crewAttachmentRoute, body)
	if err != nil {
		return nil, err
	}
	m, ok := data.(map[string]any)
	if !ok {
		return nil, fail(1, "attachment-read returned no object")
	}
	return m, nil
}

// run pages through the attachment into a temporary file beside the target,
// verifies size and sha256 (original and text, whose bytes are the
// original's), and moves it into place without replacing an existing file.
func (d *downloadCommand) run(c *Client) (any, error) {
	saved := c.LongTimeout
	c.LongTimeout = crewFileTimeout
	defer func() { c.LongTimeout = saved }()
	first, err := d.read(c, 0, d.pageSize())
	if err != nil {
		return nil, err
	}
	meta, _ := first["attachment"].(map[string]any)
	name, _ := meta["name"].(string)
	target := d.out
	if info, err := os.Stat(target); err == nil && info.IsDir() {
		target = filepath.Join(target, safeFileName(name, d.id))
	}
	if _, err := os.Lstat(target); err == nil {
		return nil, fail(2, "attachment: %s already exists; choose a new file name", target)
	}
	temp, err := os.CreateTemp(filepath.Dir(target), ".crew-attachment-*.part")
	if err != nil {
		return nil, fail(1, "attachment: %v", err)
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	hash := sha256.New()
	writer := io.MultiWriter(temp, hash)
	var written int64
	page := first
	for {
		chunk, err := pageBytes(page)
		if err == nil && int64(intValue(page["offset"])) != written {
			err = fmt.Errorf("the server returned offset %v, expected %d", page["offset"], written)
		}
		if err == nil && page["attachment"] != nil && dig(page, "attachment", "sha256") != meta["sha256"] {
			err = errors.New("the attachment changed while it was being read")
		}
		if err != nil {
			temp.Close()
			return nil, fail(1, "attachment: %v", err)
		}
		if _, err := writer.Write(chunk); err != nil {
			temp.Close()
			return nil, fail(1, "attachment: writing %s: %v", tempName, err)
		}
		written += int64(len(chunk))
		next := page["next_offset"]
		if next == nil {
			break
		}
		if int64(intValue(next)) != written || len(chunk) == 0 {
			temp.Close()
			return nil, fail(1, "attachment: unexpected next_offset %v after %d bytes", next, written)
		}
		if page, err = d.read(c, written, d.pageSize()); err != nil {
			temp.Close()
			return nil, err
		}
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return nil, fail(1, "attachment: %v", err)
	}
	if err := temp.Close(); err != nil {
		return nil, fail(1, "attachment: %v", err)
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	verified := false
	if d.variant == "original" || d.variant == "text" {
		size := int64(intValue(meta["size"]))
		if written != size || digest != meta["sha256"] {
			return nil, fail(1, "attachment: checksum mismatch (got %d bytes, sha256 %s; the record has %d bytes, sha256 %v); nothing was written", written, digest, size, meta["sha256"])
		}
		verified = true
	}
	if err := placeNew(tempName, target); err != nil {
		return nil, err
	}
	out := map[string]any{"id": d.id, "name": name, "variant": d.variant, "path": target, "bytes": written, "sha256": digest, "media_type": first["media_type"], "verified": verified}
	if !verified {
		out["note"] = d.variant + " is a downscaled image; its sha256 differs from the original's"
	}
	return out, nil
}

func (d *downloadCommand) pageSize() int {
	if d.variant == "text" {
		return crewReadTextBytes
	}
	return crewReadOriginalBytes
}

func pageBytes(page map[string]any) ([]byte, error) {
	if text, ok := page["text"].(string); ok && page["encoding"] == "utf-8" {
		return []byte(text), nil
	}
	encoded, ok := page["content_base64"].(string)
	if !ok {
		return nil, errors.New("the server returned no content")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("invalid base64 content: %v", err)
	}
	if length, ok := page["length"]; ok && intValue(length) != len(data) {
		return nil, fmt.Errorf("the server reported %v bytes but sent %d", length, len(data))
	}
	return data, nil
}

// placeNew moves a finished temporary file to target without replacing an
// existing file. A hard link fails when target exists on every platform;
// where links are unsupported, a checked rename is the fallback.
func placeNew(temp, target string) error {
	if err := os.Link(temp, target); err == nil {
		return nil
	}
	if _, err := os.Lstat(target); err == nil {
		return fail(2, "attachment: %s already exists; nothing was overwritten", target)
	}
	if err := os.Rename(temp, target); err != nil {
		return fail(1, "attachment: %v", err)
	}
	return nil
}

// safeFileName turns an attachment's display name into a file name that is
// valid on Windows, macOS and Linux: no separators, control or reserved
// characters, no trailing dots or spaces, no reserved device names, at most
// 150 bytes. An empty result falls back to the attachment id.
func safeFileName(name, id string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r < 32 || r == 127 || unicode.Is(unicode.Cf, r):
		case strings.ContainsRune(`<>:"/\|?*`, r):
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	out := strings.TrimRight(strings.TrimSpace(b.String()), ". ")
	out = strings.TrimLeft(out, ".")
	for len(out) > 150 {
		_, size := utf8.DecodeLastRuneInString(out)
		out = out[:len(out)-size]
	}
	out = strings.TrimRight(out, ". ")
	if out == "" {
		return id
	}
	stem := strings.ToUpper(strings.TrimSpace(strings.SplitN(out, ".", 2)[0]))
	switch stem {
	case "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$":
		return "_" + out
	}
	if len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && stem[3] >= '0' && stem[3] <= '9' {
		return "_" + out
	}
	return out
}
