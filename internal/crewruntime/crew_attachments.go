package crewruntime

// Attachment bytes: inspection for the JavaScript write path, protected file
// serving for the reader and CLI, and bounded byte reads for work clients.
// Records, limits, events and reviews stay in pb_hooks/crew_attachments.js,
// inside the same transaction as every other Crew write.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/draw"
	_ "image/gif" // DecodeConfig for verified images
	"image/jpeg"
	_ "image/png"
	"io"
	"math"
	"mime"
	"mime/multipart"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/hook"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/security"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	"golang.org/x/sync/singleflight"
)

const (
	attachmentMaxBytes       = 20 << 20 // per file; matches the migration's maxSize
	attachmentMaxPerRequest  = 20
	attachmentBase64MaxBytes = 5 << 20 // decoded bytes per JSON (MCP) request
	attachmentReadMaxBytes   = 4 << 20 // decoded bytes per attachment-read call
	attachmentReadDefault    = 1 << 20
	attachmentTextMaxBytes   = 2 << 20
	attachmentTextDefault    = 256 << 10
	attachmentThumbMaxPixels = 40_000_000
	attachmentNameMaxRunes   = 200
)

// attachmentThumbs are the declared thumb sizes: preview (inline/lightbox
// source on phones) and card (board and note cards).
var attachmentThumbs = map[string]string{"preview": "1600x0", "card": "320x0"}

var crewIDPattern = regexp.MustCompile(`^[a-z0-9]{15}$`)

// imageMagic identifies the only formats shown inline or thumbnailed. The
// extension never makes a file an image.
func imageMagic(head []byte) (mediaType, ext string) {
	switch {
	case bytes.HasPrefix(head, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png", "png"
	case bytes.HasPrefix(head, []byte{0xff, 0xd8, 0xff}):
		return "image/jpeg", "jpg"
	case bytes.HasPrefix(head, []byte("GIF87a")), bytes.HasPrefix(head, []byte("GIF89a")):
		return "image/gif", "gif"
	case len(head) >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WEBP":
		return "image/webp", "webp"
	}
	return "", ""
}

// extensionTypes is a fixed table: never the OS registry (which differs on
// Windows) and never content sniffing. The type is metadata; serving applies
// attachmentServeType on top.
var extensionTypes = map[string]string{
	"txt": "text/plain", "log": "text/plain", "text": "text/plain",
	"md": "text/markdown", "markdown": "text/markdown",
	"csv": "text/csv", "tsv": "text/tab-separated-values",
	"json": "application/json", "jsonl": "application/x-ndjson", "ndjson": "application/x-ndjson",
	"yaml": "application/yaml", "yml": "application/yaml", "toml": "text/plain",
	"xml": "application/xml", "html": "text/html", "htm": "text/html", "svg": "image/svg+xml",
	"js": "text/javascript", "css": "text/css",
	"pdf": "application/pdf",
	"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
	"avif": "image/avif", "heic": "image/heic", "bmp": "image/bmp", "tif": "image/tiff", "tiff": "image/tiff",
	"mp4": "video/mp4", "m4v": "video/mp4", "webm": "video/webm", "mov": "video/quicktime", "ogv": "video/ogg",
	"mp3": "audio/mpeg", "m4a": "audio/mp4", "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/ogg",
	"wav": "audio/wav", "flac": "audio/flac",
	"zip": "application/zip", "gz": "application/gzip", "tar": "application/x-tar", "7z": "application/x-7z-compressed",
}

// Image extensions whose bytes failed the magic check are not images.
var unverifiedImage = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

func extensionType(name string) string {
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(name)), ".")
	if t, ok := extensionTypes[ext]; ok && !unverifiedImage[t] {
		return t
	}
	return "application/octet-stream"
}

// attachmentServeType never serves an active type (HTML, SVG, XML, scripts).
// Passive text, PDF and media keep their type so the reader can preview or play
// them; everything else is opaque bytes.
func attachmentServeType(mediaType string, verifiedImage bool) string {
	if verifiedImage {
		return mediaType
	}
	switch {
	case mediaType == "text/plain", mediaType == "text/markdown", mediaType == "text/csv",
		mediaType == "text/tab-separated-values", mediaType == "application/json",
		mediaType == "application/x-ndjson", mediaType == "application/yaml":
		return mediaType + "; charset=utf-8"
	case mediaType == "application/pdf", strings.HasPrefix(mediaType, "video/"), strings.HasPrefix(mediaType, "audio/"):
		return mediaType
	}
	return "application/octet-stream"
}

// cleanAttachmentName keeps a readable display name: the last path segment,
// valid UTF-8, no control characters, at most 200 runes with its extension.
func cleanAttachmentName(name string) string {
	name = strings.ToValidUTF8(name, "")
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == unicode.ReplacementChar || bidiControl(r) {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || strings.Trim(name, ".") == "" {
		return ""
	}
	if utf8.RuneCountInString(name) > attachmentNameMaxRunes {
		ext := path.Ext(name)
		if utf8.RuneCountInString(ext) > 20 {
			ext = ""
		}
		runes := []rune(strings.TrimSuffix(name, ext))
		name = string(runes[:attachmentNameMaxRunes-utf8.RuneCountInString(ext)]) + ext
	}
	return name
}

// bidiControl reports the invisible direction marks and overrides that can
// make a name display differently from its bytes ("report<RLO>gnp.exe" shows
// as "reportexe.png").
func bidiControl(r rune) bool {
	return r == 0x061c || r == 0x200e || r == 0x200f || (r >= 0x202a && r <= 0x202e) || (r >= 0x2066 && r <= 0x2069)
}

var safeExtension = regexp.MustCompile(`^[a-z0-9]{1,10}$`)

// storageName is the on-disk name: ASCII, Windows-safe and unique; the display
// name lives in the record.
func storageName(display, imageExt string) string {
	ext := imageExt
	if ext == "" {
		ext = strings.TrimPrefix(strings.ToLower(path.Ext(display)), ".")
		if !safeExtension.MatchString(ext) {
			ext = "bin"
		}
	}
	return "a_" + security.RandomStringWithAlphabet(12, "abcdefghijklmnopqrstuvwxyz0123456789") + "." + ext
}

func attachmentFailure(index int, name, code, message string) map[string]any {
	return map[string]any{"index": index, "name": name, "error_code": code, "error_message": message}
}

// inspectAttachment hashes and classifies one file. open must return the
// complete content; size is the declared size.
func inspectAttachment(index int, original string, size int64, open func() (io.ReadSeekCloser, error), file func() (*filesystem.File, error)) map[string]any {
	display := cleanAttachmentName(original)
	if display == "" {
		return attachmentFailure(index, original, "invalid_name", "File needs a name")
	}
	if size <= 0 {
		return attachmentFailure(index, display, "empty_file", display+" is empty")
	}
	if size > attachmentMaxBytes {
		return attachmentFailure(index, display, "file_too_large", display+" is larger than 20 MiB")
	}
	r, err := open()
	if err != nil {
		return attachmentFailure(index, display, "unreadable", display+" could not be read")
	}
	defer r.Close()
	head := make([]byte, 32)
	n, _ := io.ReadFull(r, head)
	head = head[:n]
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return attachmentFailure(index, display, "unreadable", display+" could not be read")
	}
	h := sha256.New()
	copied, err := io.Copy(h, io.LimitReader(r, attachmentMaxBytes+1))
	if err != nil || copied != size {
		return attachmentFailure(index, display, "unreadable", display+" could not be read completely")
	}
	mediaType, ext := imageMagic(head)
	width, height := 0, 0
	if mediaType != "" {
		if _, err := r.Seek(0, io.SeekStart); err != nil {
			return attachmentFailure(index, display, "unreadable", display+" could not be read")
		}
		config, _, err := image.DecodeConfig(r)
		if err != nil || config.Width <= 0 || config.Height <= 0 {
			mediaType, ext = "", "" // magic without a decodable header: a plain file
		} else {
			width, height = config.Width, config.Height
		}
	}
	isImage := mediaType != ""
	if !isImage {
		mediaType = extensionType(display)
	}
	f, err := file()
	if err != nil {
		return attachmentFailure(index, display, "unreadable", display+" could not be read")
	}
	f.Name = storageName(display, ext)
	f.OriginalName = display
	return map[string]any{
		"index": index, "name": display, "file": f, "size": size,
		"sha256": hex.EncodeToString(h.Sum(nil)), "media_type": mediaType,
		"image": isImage, "width": width, "height": height,
	}
}

// inspectHook lets tests observe that file inspection ran; nil in production.
var inspectHook func()

type bytesSeekCloser struct{ *bytes.Reader }

func (bytesSeekCloser) Close() error { return nil }

// crewAttachmentFiles is the $pocketcontext binding used by attachment.add,
// task.create and note.create (and the upload-link endpoint). Files arrive
// either as multipart parts named "files" or as data.files entries
// {name, content_base64}. A request-level problem returns {error}; per-file
// problems are entries with error_code/error_message so the caller can report
// each file independently.
func crewAttachmentFiles(e *core.RequestEvent, list []any) map[string]any {
	if inspectHook != nil {
		inspectHook()
	}
	files := []map[string]any{}
	fail := func(message string) map[string]any { return map[string]any{"error": message, "files": files} }
	var headers []*multipart.FileHeader
	if e != nil && e.Request != nil && strings.HasPrefix(strings.ToLower(e.Request.Header.Get("Content-Type")), "multipart/form-data") {
		if e.Request.MultipartForm == nil {
			if err := e.Request.ParseMultipartForm(uploadMultipartMemory); err != nil {
				return fail("Invalid multipart request")
			}
		}
		if form := e.Request.MultipartForm; form != nil {
			for key := range form.File {
				if key != "files" {
					return fail("Send files in multipart parts named files")
				}
			}
			headers = form.File["files"]
		}
	}
	if len(headers) > 0 && len(list) > 0 {
		return fail("Send files either as multipart parts or as base64 data.files, not both")
	}
	if len(headers)+len(list) > attachmentMaxPerRequest {
		return fail(fmt.Sprintf("At most %d files per request", attachmentMaxPerRequest))
	}
	for i, fh := range headers {
		fh := fh
		files = append(files, inspectAttachment(i+1, fh.Filename, fh.Size,
			func() (io.ReadSeekCloser, error) {
				f, err := fh.Open()
				if err != nil {
					return nil, err
				}
				return f, nil
			},
			func() (*filesystem.File, error) { return filesystem.NewFileFromMultipart(fh) }))
	}
	total := 0
	for i, raw := range list {
		entry, ok := raw.(map[string]any)
		name, _ := entry["name"].(string)
		content, okContent := entry["content_base64"].(string)
		if !ok || !okContent || len(entry) != 2 {
			files = append(files, attachmentFailure(i+1, name, "invalid_file", "Each data.files entry needs exactly name and content_base64"))
			continue
		}
		content = strings.TrimSpace(content)
		if total+base64.StdEncoding.DecodedLen(len(content)) > attachmentBase64MaxBytes+3 {
			return fail("Base64 files are limited to 5 MiB of decoded bytes per request; send fewer or smaller files, or use multipart")
		}
		data, err := base64.StdEncoding.DecodeString(content)
		if err != nil {
			data, err = base64.RawStdEncoding.DecodeString(content)
		}
		if err != nil {
			files = append(files, attachmentFailure(i+1, name, "invalid_base64", "content_base64 is not valid standard base64"))
			continue
		}
		total += len(data)
		if total > attachmentBase64MaxBytes {
			return fail("Base64 files are limited to 5 MiB of decoded bytes per request; send fewer or smaller files, or use multipart")
		}
		files = append(files, inspectAttachment(i+1, name, int64(len(data)),
			func() (io.ReadSeekCloser, error) { return bytesSeekCloser{bytes.NewReader(data)}, nil },
			func() (*filesystem.File, error) { return filesystem.NewFileFromBytes(data, "upload") }))
	}
	return map[string]any{"files": files}
}

// The unauthenticated upload-link endpoints are guarded in Go before any
// JavaScript runs or any body is read. Hosted mode sees one proxy address, so
// limits are keyed by what the request presents, not by IP:
//   - a missing, malformed or unknown token takes from one shared "bad"
//     bucket, so random-token traffic is cheap to refuse and never spends the
//     allowance of a request holding a real link;
//   - a known token (any state) takes from that link's own bucket;
//   - uploads must be multipart/form-data (checked before the body is read),
//     at most uploadInFlight run at once (503 with Retry-After otherwise), and
//     file parts beyond 1 MiB stream to temporary files.
//
// Tokens travel in the X-Crew-Upload-Token header, never in the URL.
const (
	uploadTokenHeader     = "X-Crew-Upload-Token"
	uploadBadBurst        = 20
	uploadLinkBurst       = 10
	uploadRefill          = 3 * time.Second
	uploadInFlight        = 2
	uploadBusyRetry       = 5 // seconds
	uploadInfoBodyLimit   = 4096
	uploadMultipartMemory = 1 << 20
	uploadLinkBucketsMax  = 1024 // full buckets are pruned beyond this
)

var uploadTokenPattern = regexp.MustCompile(`^[A-Za-z0-9]{43}$`)

type rateBucket struct {
	tokens float64
	last   time.Time
}

// take refills, then takes one token: 0, or whole seconds until one is available.
func (b *rateBucket) take(now time.Time, burst float64) int {
	if b.last.IsZero() {
		b.tokens = burst
	} else {
		b.tokens += float64(now.Sub(b.last)) / float64(uploadRefill)
		if b.tokens > burst {
			b.tokens = burst
		}
	}
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return 0
	}
	wait := time.Duration((1 - b.tokens) * float64(uploadRefill))
	return int((wait + time.Second - 1) / time.Second)
}

type uploadGuardState struct {
	mu       sync.Mutex
	now      func() time.Time
	bad      rateBucket
	links    map[string]*rateBucket
	inflight chan struct{}
}

func newUploadGuard() *uploadGuardState {
	return &uploadGuardState{now: time.Now, links: map[string]*rateBucket{}, inflight: make(chan struct{}, uploadInFlight)}
}

var uploadGuard = newUploadGuard()

// allow charges the link's bucket for a known link id, else the bad bucket.
func (g *uploadGuardState) allow(linkID string) int {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	if linkID == "" {
		return g.bad.take(now, uploadBadBurst)
	}
	b := g.links[linkID]
	if b == nil {
		if len(g.links) >= uploadLinkBucketsMax {
			for id, x := range g.links {
				if now.Sub(x.last) >= uploadLinkBurst*uploadRefill {
					delete(g.links, id)
				}
			}
		}
		b = &rateBucket{}
		g.links[linkID] = b
	}
	return b.take(now, uploadLinkBurst)
}

func (g *uploadGuardState) reset() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.bad = rateBucket{}
	g.links = map[string]*rateBucket{}
}

func uploadRefusal(e *core.RequestEvent, status int, retry int, message string, data map[string]any) error {
	if retry > 0 {
		e.Response.Header().Set("Retry-After", strconv.Itoa(retry))
	}
	if data == nil {
		data = map[string]any{}
	}
	return e.JSON(status, map[string]any{"status": status, "message": message, "data": data})
}

// uploadLinkID returns the id of the link a well-formed token names, or "".
func uploadLinkID(app core.App, token string) string {
	if !uploadTokenPattern.MatchString(token) {
		return ""
	}
	rec, err := app.FindFirstRecordByFilter("crew_upload_links", "token_hash={:h}", dbx.Params{"h": security.SHA256(token)})
	if err != nil {
		return ""
	}
	return rec.Id
}

// crewUploadGuard is the middleware for POST /api/crew/upload-link/{info,upload}.
func crewUploadGuard(kind string) *hook.Handler[*core.RequestEvent] {
	upload := kind == "upload"
	return &hook.Handler[*core.RequestEvent]{Func: func(e *core.RequestEvent) error {
		e.Response.Header().Set("Cache-Control", "no-store")
		if upload {
			mediaType, _, _ := mime.ParseMediaType(e.Request.Header.Get("Content-Type"))
			if mediaType != "multipart/form-data" {
				return uploadRefusal(e, http.StatusUnsupportedMediaType, 0, "Send files as multipart/form-data", nil)
			}
		} else if e.Request.ContentLength > uploadInfoBodyLimit {
			return uploadRefusal(e, http.StatusRequestEntityTooLarge, 0, "Request body too large", nil)
		}
		linkID := uploadLinkID(e.App, e.Request.Header.Get(uploadTokenHeader))
		if wait := uploadGuard.allow(linkID); wait > 0 {
			return uploadRefusal(e, http.StatusTooManyRequests, wait, "Too many upload requests. Try again shortly.",
				map[string]any{"rate_limit": map[string]any{"limit": "upload_link", "retry_after_seconds": wait}})
		}
		if !upload {
			e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, uploadInfoBodyLimit)
			return e.Next()
		}
		select {
		case uploadGuard.inflight <- struct{}{}:
			defer func() { <-uploadGuard.inflight }()
		default:
			return uploadRefusal(e, http.StatusServiceUnavailable, uploadBusyRetry, "Another upload is in progress. Try again shortly.", nil)
		}
		return e.Next()
	}}
}

// crewUploadLinkFiles parses an upload-link request (file parts named files,
// no other fields) with little memory and inspects its files.
func crewUploadLinkFiles(e *core.RequestEvent) map[string]any {
	if e.Request.MultipartForm == nil {
		if err := e.Request.ParseMultipartForm(uploadMultipartMemory); err != nil {
			return map[string]any{"error": "Invalid multipart request", "files": []map[string]any{}}
		}
	}
	for key := range e.Request.MultipartForm.Value {
		return map[string]any{"error": "Unsupported field: " + key, "files": []map[string]any{}}
	}
	return crewAttachmentFiles(e, nil)
}

// attachmentAuth accepts the owner's auth header or a short-lived PocketBase
// file token (?token=, from POST /api/files/token) so <img> and <video> can load.
func attachmentAuth(re *core.RequestEvent) *core.Record {
	if re.Auth != nil {
		if re.Auth.Collection().Name == "users" {
			return re.Auth
		}
		return nil
	}
	token := re.Request.URL.Query().Get("token")
	if token == "" {
		return nil
	}
	record, err := re.App.FindAuthRecordByToken(token, core.TokenTypeFile)
	if err != nil || record.Collection().Name != "users" {
		return nil
	}
	return record
}

func findAttachment(app core.App, id string) (*core.Record, error) {
	if !crewIDPattern.MatchString(id) {
		return nil, errors.New("not found")
	}
	return app.FindRecordById("crew_attachments", id)
}

type thumbMaker struct {
	pending singleflight.Group
	slots   chan struct{}
}

// One thumbnail at a time bounds decode memory (at most 40 MP, about 160 MB).
var thumbs = &thumbMaker{slots: make(chan struct{}, 1)}

// thumbnail returns the key and content type of the requested downscaled copy,
// or the original when the image is already that small, too large to decode
// safely, or thumbnailing fails.
func (t *thumbMaker) thumbnail(ctx context.Context, app core.App, fsys *filesystem.System, rec *core.Record, size string) (string, string) {
	name := rec.GetString("file")
	original := rec.BaseFilesPath() + "/" + name
	width, _ := strconv.Atoi(strings.SplitN(size, "x", 2)[0])
	if rec.GetInt("width") <= width || tooManyPixels(rec) {
		return original, rec.GetString("media_type")
	}
	key := rec.BaseFilesPath() + "/thumbs_" + name + "/" + size + "_" + name
	if ok, _ := fsys.Exists(key); !ok {
		// Maintenance admits these routes as reads; never write thumbs then.
		if readOnly, _ := app.Store().Get("contextMaintenanceReadOnly").(bool); readOnly {
			return original, rec.GetString("media_type")
		}
		ch := t.pending.DoChan(key, func() (any, error) {
			select {
			case t.slots <- struct{}{}:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
			defer func() { <-t.slots }()
			if ok, _ := fsys.Exists(key); ok {
				return nil, nil
			}
			return nil, fsys.CreateThumb(original, key, size)
		})
		if res := <-ch; res.Err != nil {
			return original, rec.GetString("media_type")
		}
	}
	contentType := "image/png"
	if attrs, err := fsys.Attributes(key); err == nil {
		if _, ok := map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true}[attrs.ContentType]; ok {
			contentType = attrs.ContentType
		}
	}
	return key, contentType
}

func tooManyPixels(rec *core.Record) bool {
	return int64(rec.GetInt("width"))*int64(rec.GetInt("height")) > attachmentThumbMaxPixels
}

// previewUnavailable is the 413 work clients treat as "metadata only".
func previewUnavailable(re *core.RequestEvent, message string) error {
	return re.JSON(http.StatusRequestEntityTooLarge, map[string]any{"status": 413, "message": message,
		"data": map[string]any{"code": "preview_unavailable"}})
}

// capped returns a JPEG of the image at most the requested width and at most
// attachmentReadMaxBytes: an image whose original (or plain thumbnail) is
// larger than a work-client read allows. Transparency is flattened on white
// and only a GIF's first frame is kept. The result is cached beside the
// thumbnails unless the instance is in read-only maintenance.
func (t *thumbMaker) capped(ctx context.Context, app core.App, fsys *filesystem.System, rec *core.Record, size string) ([]byte, string, error) {
	name := rec.GetString("file")
	key := rec.BaseFilesPath() + "/thumbs_" + name + "/" + size + "_capped_" + strings.TrimSuffix(name, path.Ext(name)) + ".jpg"
	readKey := func() ([]byte, error) {
		r, err := fsys.GetReader(key)
		if err != nil {
			return nil, err
		}
		defer r.Close()
		return io.ReadAll(io.LimitReader(r, attachmentReadMaxBytes+1))
	}
	if ok, _ := fsys.Exists(key); ok {
		data, err := readKey()
		return data, "image/jpeg", err
	}
	width, _ := strconv.Atoi(strings.SplitN(size, "x", 2)[0])
	ch := t.pending.DoChan(key, func() (any, error) {
		select {
		case t.slots <- struct{}{}:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		defer func() { <-t.slots }()
		r, err := fsys.GetReader(rec.BaseFilesPath() + "/" + name)
		if err != nil {
			return nil, err
		}
		src, _, err := image.Decode(io.LimitReader(r, attachmentMaxBytes+1))
		r.Close()
		if err != nil {
			return nil, err
		}
		data, err := cappedJPEG(src, width, attachmentReadMaxBytes)
		if err != nil {
			return nil, err
		}
		if readOnly, _ := app.Store().Get("contextMaintenanceReadOnly").(bool); !readOnly {
			_ = fsys.Upload(data, key) // a cache; serving does not depend on it
		}
		return data, nil
	})
	res := <-ch
	if res.Err != nil {
		return nil, "", res.Err
	}
	return res.Val.([]byte), "image/jpeg", nil
}

// cappedJPEG scales src to at most maxWidth (never up) and encodes JPEG,
// shrinking further until the result is at most limit bytes.
func cappedJPEG(src image.Image, maxWidth, limit int) ([]byte, error) {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w > maxWidth {
		h = max(1, int(int64(h)*int64(maxWidth)/int64(w)))
		w = maxWidth
	}
	for attempt := 0; attempt < 8; attempt++ {
		dst := image.NewRGBA(image.Rect(0, 0, w, h))
		draw.Draw(dst, dst.Bounds(), image.White, image.Point{}, draw.Src)
		xdraw.ApproxBiLinear.Scale(dst, dst.Bounds(), src, b, draw.Over, nil)
		var out bytes.Buffer
		if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 80}); err != nil {
			return nil, err
		}
		if out.Len() <= limit {
			return out.Bytes(), nil
		}
		// Bytes scale roughly with area; aim a little under the limit.
		f := math.Sqrt(float64(limit)/float64(out.Len())) * 0.9
		w, h = max(1, int(float64(w)*f)), max(1, int(float64(h)*f))
	}
	return nil, errors.New("image does not fit the preview limit")
}

// attachmentFile serves the protected bytes: GET /api/crew/attachment?id=ID
// [&thumb=1600x0|320x0][&download=1][&token=FILE_TOKEN]. Verified images are
// inline unless download=1; every other file is an attachment download with
// a passive or opaque type. nosniff and a sandbox CSP always apply.
func attachmentFile(re *core.RequestEvent) error {
	if attachmentAuth(re) == nil {
		return re.UnauthorizedError("Sign in to read attachments.", nil)
	}
	q := re.Request.URL.Query()
	rec, err := findAttachment(re.App, q.Get("id"))
	if err != nil {
		return re.NotFoundError("Attachment not found.", nil)
	}
	size := q.Get("thumb")
	if size != "" && size != "1600x0" && size != "320x0" {
		return re.BadRequestError("thumb must be 1600x0 or 320x0", nil)
	}
	isImage := rec.GetBool("image")
	if size != "" && !isImage {
		return re.BadRequestError("Thumbnails exist only for images", nil)
	}
	fsys, err := re.App.NewFilesystem()
	if err != nil {
		return re.InternalServerError("Storage unavailable", nil)
	}
	defer fsys.Close()
	key, contentType := rec.BaseFilesPath()+"/"+rec.GetString("file"), rec.GetString("media_type")
	if size != "" {
		key, contentType = thumbs.thumbnail(re.Request.Context(), re.App, fsys, rec, size)
	}
	disposition := "attachment"
	if isImage && q.Get("download") != "1" {
		disposition = "inline"
	}
	name := rec.GetString("name")
	if size != "" && key != rec.BaseFilesPath()+"/"+rec.GetString("file") {
		name = size + "-" + name
	}
	h := re.Response.Header()
	h.Set("Content-Type", attachmentServeType(contentType, isImage))
	h.Set("Content-Disposition", contentDisposition(disposition, name))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Cache-Control", "private, max-age=3600")
	if err := fsys.Serve(re.Response, re.Request, key, name); err != nil {
		return re.NotFoundError("Attachment file missing.", nil)
	}
	return nil
}

func contentDisposition(kind, name string) string {
	if value := mime.FormatMediaType(kind, map[string]string{"filename": name}); value != "" {
		return value
	}
	return kind
}

// attachmentRead is the bounded work-client read: POST /api/crew/attachment-read
// {id, variant: original|preview|card|text, offset, max_bytes}. It never
// returns a URL or storage path; bytes come back as base64 (or UTF-8 text).
func attachmentRead(re *core.RequestEvent) error {
	re.Response.Header().Set("Cache-Control", "no-store")
	var body struct {
		ID       string `json:"id"`
		Variant  string `json:"variant"`
		Offset   int64  `json:"offset"`
		MaxBytes int64  `json:"max_bytes"`
	}
	if err := decodeCrewBody(re, 4096, &body); err != nil {
		return re.BadRequestError("Expected JSON with id, variant and optional offset and max_bytes", nil)
	}
	rec, err := findAttachment(re.App, body.ID)
	if err != nil {
		return re.NotFoundError("Attachment not found.", nil)
	}
	if body.Variant == "" {
		body.Variant = "original"
	}
	if body.Offset < 0 || body.MaxBytes < 0 {
		return re.BadRequestError("offset and max_bytes must not be negative", nil)
	}
	fsys, err := re.App.NewFilesystem()
	if err != nil {
		return re.InternalServerError("Storage unavailable", nil)
	}
	defer fsys.Close()
	original := rec.BaseFilesPath() + "/" + rec.GetString("file")
	meta := rec.PublicExport()
	out := map[string]any{"attachment": meta, "variant": body.Variant}
	readAll := func(key string, limit int64) ([]byte, error) {
		r, err := fsys.GetReader(key)
		if err != nil {
			return nil, err
		}
		defer r.Close()
		return io.ReadAll(io.LimitReader(r, limit))
	}
	switch body.Variant {
	case "preview", "card":
		if !rec.GetBool("image") {
			return re.BadRequestError("preview and card exist only for images; read original or text", nil)
		}
		if body.Offset != 0 {
			return re.BadRequestError("preview and card are returned whole; offset must be 0", nil)
		}
		if tooManyPixels(rec) {
			return previewUnavailable(re, "Image is larger than 40 megapixels and has no preview; use its metadata, or read original bytes")
		}
		key, contentType := thumbs.thumbnail(re.Request.Context(), re.App, fsys, rec, attachmentThumbs[body.Variant])
		data, err := readAll(key, attachmentReadMaxBytes+1)
		if err != nil {
			return re.NotFoundError("Attachment file missing.", nil)
		}
		if len(data) > attachmentReadMaxBytes {
			// Already that small (or a large thumbnail): re-encode, capped.
			data, contentType, err = thumbs.capped(re.Request.Context(), re.App, fsys, rec, attachmentThumbs[body.Variant])
			if err != nil || len(data) > attachmentReadMaxBytes {
				return previewUnavailable(re, "No preview of this image fits in 4 MiB; use its metadata, or read original bytes")
			}
		}
		width, height := rec.GetInt("width"), rec.GetInt("height")
		if config, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil {
			width, height = config.Width, config.Height
		}
		out["media_type"], out["encoding"] = contentType, "base64"
		out["offset"], out["length"], out["total_size"], out["next_offset"] = 0, len(data), len(data), nil
		out["width"], out["height"] = width, height
		out["content_base64"] = base64.StdEncoding.EncodeToString(data)
		return re.JSON(http.StatusOK, out)
	case "original", "text":
	default:
		return re.BadRequestError("variant must be original, preview, card or text", nil)
	}
	total := int64(rec.GetInt("size"))
	limit, maximum := int64(attachmentReadDefault), int64(attachmentReadMaxBytes)
	if body.Variant == "text" {
		if rec.GetBool("image") {
			return re.JSON(http.StatusUnsupportedMediaType, map[string]any{"status": 415, "message": "Images are not text; read preview, card or original", "data": map[string]any{}})
		}
		limit, maximum = attachmentTextDefault, attachmentTextMaxBytes
	}
	if body.MaxBytes > 0 {
		limit = body.MaxBytes
	}
	if limit > maximum {
		return re.BadRequestError(fmt.Sprintf("max_bytes is at most %d for %s", maximum, body.Variant), nil)
	}
	if body.Offset > total {
		return re.BadRequestError("offset is beyond the end of the file", nil)
	}
	r, err := fsys.GetReader(original)
	if err != nil {
		return re.NotFoundError("Attachment file missing.", nil)
	}
	defer r.Close()
	if _, err := r.Seek(body.Offset, io.SeekStart); err != nil {
		return re.InternalServerError("Cannot read attachment", nil)
	}
	data, err := io.ReadAll(io.LimitReader(r, limit))
	if err != nil {
		return re.InternalServerError("Cannot read attachment", nil)
	}
	end := body.Offset + int64(len(data))
	if body.Variant == "text" {
		if len(data) > 0 && !utf8.RuneStart(data[0]) {
			return re.BadRequestError("offset is inside a UTF-8 character; use next_offset from the previous read", nil)
		}
		if end < total {
			// Keep whole characters; the next read starts at the cut.
			if start := lastRuneStart(data); start < len(data) && !utf8.FullRune(data[start:]) {
				data = data[:start]
			}
			if len(data) == 0 {
				return re.BadRequestError("max_bytes is too small for one character", nil)
			}
			end = body.Offset + int64(len(data))
		}
		if !utf8.Valid(data) {
			return re.JSON(http.StatusUnsupportedMediaType, map[string]any{"status": 415, "message": "Not UTF-8 text; read the original bytes", "data": map[string]any{}})
		}
		out["encoding"], out["text"] = "utf-8", string(data)
	} else {
		out["encoding"], out["content_base64"] = "base64", base64.StdEncoding.EncodeToString(data)
	}
	out["media_type"] = rec.GetString("media_type")
	out["offset"], out["length"], out["total_size"] = body.Offset, len(data), total
	if end < total {
		out["next_offset"] = end
	} else {
		out["next_offset"] = nil
	}
	return re.JSON(http.StatusOK, out)
}

func lastRuneStart(data []byte) int {
	for i := len(data) - 1; i >= 0 && i >= len(data)-utf8.UTFMax; i-- {
		if utf8.RuneStart(data[i]) {
			return i
		}
	}
	return len(data)
}

func registerAttachmentRoutes(e *core.ServeEvent) {
	e.Router.GET("/api/crew/attachment", attachmentFile)
	e.Router.POST("/api/crew/attachment-read", attachmentRead).Bind(apis.RequireAuth("users"))
}
