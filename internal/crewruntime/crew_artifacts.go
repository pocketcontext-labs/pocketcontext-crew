package crewruntime

// Public artifact pages (0.21.0): GET /a/<token> renders a published
// artifact's frozen snapshot as a standalone HTML page, and
// GET /a/<token>/files/<n> serves its nth image. These are the only Crew
// pages readable without signing in. The token (32 base62 characters, about
// 190 bits, random and never derived from the id) is the secret; revoking
// clears it, so a revoked or unknown token gets the same plain 404. Since
// 0.22.0 a link may expire: from expires_at on, its token gets that same 404
// with no manual action, and archived artifacts never serve.
//
// The page has no script, no Crew navigation and no links back into Crew:
// Markdown is rendered with the notes' GFM semantics, raw HTML is omitted,
// images resolve only through the artifact's published file list, and links
// survive only when they are http(s) or mailto and point to another host.
// Responses carry noindex, no-referrer, a strict CSP and no-store, so a
// revoke takes effect on the next request.
//
// Rate limits are keyed like the upload-link guard: hosted mode sees one
// proxy address, so a per-IP limit would throttle everyone together. A
// missing, malformed or unknown token takes from one shared bucket, so
// guessing is cheap to refuse and never spends a real link's allowance; a
// known token takes from that artifact's own bucket.

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"html"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

const (
	artifactBadBurst      = 60
	artifactBadRefill     = time.Second
	artifactLinkBurst     = 120
	artifactLinkRefill    = 500 * time.Millisecond
	artifactBucketsMax    = 1024
	artifactMaxFiles      = 9999
	artifactRelAttribute  = "nofollow noopener noreferrer"
	artifactRobotsHeader  = "noindex, nofollow, noarchive"
	artifactNotFoundBody  = "This link is no longer available.\n"
	artifactRateLimitBody = "Too many requests. Try again shortly.\n"
)

var artifactTokenPattern = regexp.MustCompile(`^[A-Za-z0-9]{32}$`)

type artifactGuardState struct {
	mu    sync.Mutex
	now   func() time.Time
	bad   rateBucket
	links map[string]*rateBucket
}

func newArtifactGuard() *artifactGuardState {
	return &artifactGuardState{now: time.Now, links: map[string]*rateBucket{}}
}

var artifactGuard = newArtifactGuard()

// allow charges the artifact's bucket for a known id, else the shared one.
func (g *artifactGuardState) allow(id string) int {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	if id == "" {
		return g.bad.take(now, artifactBadBurst, artifactBadRefill)
	}
	b := g.links[id]
	if b == nil {
		if len(g.links) >= artifactBucketsMax {
			for key, x := range g.links {
				if now.Sub(x.last) >= artifactLinkBurst*artifactLinkRefill {
					delete(g.links, key)
				}
			}
		}
		b = &rateBucket{}
		g.links[id] = b
	}
	return b.take(now, artifactLinkBurst, artifactLinkRefill)
}

func (g *artifactGuardState) reset() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.bad = rateBucket{}
	g.links = map[string]*rateBucket{}
}

// publishedArtifact finds the live published artifact a well-formed token
// names: not archived and not expired.
func publishedArtifact(app core.App, token string) *core.Record {
	if !artifactTokenPattern.MatchString(token) {
		return nil
	}
	rec, err := app.FindFirstRecordByFilter("crew_artifacts", "token={:t} && status='published' && archived=false", dbx.Params{"t": token})
	if err != nil || rec.GetString("token") != token || artifactExpired(rec.GetString("expires_at"), time.Now()) {
		return nil
	}
	return rec
}

// artifactExpired reports whether an expiry time has passed; an unreadable
// non-empty expiry fails closed.
func artifactExpired(expiresAt string, now time.Time) bool {
	if expiresAt == "" {
		return false
	}
	at, err := time.Parse(time.RFC3339Nano, expiresAt)
	return err != nil || !now.Before(at)
}

// artifactHeaders apply to every /a/ response, found or not.
func artifactHeaders(h http.Header) {
	h.Set("Cache-Control", "no-store")
	h.Set("X-Robots-Tag", artifactRobotsHeader)
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
}

func artifactPlain(re *core.RequestEvent, status int, body string) error {
	h := re.Response.Header()
	h.Set("Content-Type", "text/plain; charset=utf-8")
	h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	re.Response.WriteHeader(status)
	if re.Request.Method != http.MethodHead {
		_, _ = re.Response.Write([]byte(body))
	}
	return nil
}

// artifactLookup applies the headers, the rate limit and the token lookup
// shared by the page and its files; a nil record means a response was sent.
func artifactLookup(re *core.RequestEvent) *core.Record {
	artifactHeaders(re.Response.Header())
	rec := publishedArtifact(re.App, re.Request.PathValue("token"))
	id := ""
	if rec != nil {
		id = rec.Id
	}
	if wait := artifactGuard.allow(id); wait > 0 {
		re.Response.Header().Set("Retry-After", strconv.Itoa(wait))
		_ = artifactPlain(re, http.StatusTooManyRequests, artifactRateLimitBody)
		return nil
	}
	if rec == nil {
		_ = artifactPlain(re, http.StatusNotFound, artifactNotFoundBody)
		return nil
	}
	return rec
}

func artifactFiles(rec *core.Record) []string {
	var files []string
	_ = json.Unmarshal([]byte(rec.GetString("published_files")), &files)
	return files
}

// artifactPage serves GET/HEAD /a/{token}.
func artifactPage(re *core.RequestEvent) error {
	rec := artifactLookup(re)
	if rec == nil {
		return nil
	}
	token := rec.GetString("token")
	blocked := map[string]bool{strings.ToLower(re.Request.Host): true}
	if base, err := url.Parse(webhookInstanceURL(re.App)); err == nil && base.Host != "" {
		blocked[strings.ToLower(base.Host)] = true
	}
	page := renderArtifactPage(rec.GetString("published_title"), rec.GetString("published_body"), rec.GetString("published_at"), token, artifactFiles(rec), blocked)
	h := re.Response.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Content-Security-Policy", artifactCSP)
	re.Response.WriteHeader(http.StatusOK)
	if re.Request.Method == http.MethodHead {
		return nil
	}
	_, _ = re.Response.Write(page)
	// A view is counted with one statement, outside the record's revision,
	// so it never overwrites a concurrent draft edit.
	_, _ = re.App.DB().NewQuery("UPDATE crew_artifacts SET view_count=view_count+1, last_viewed_at={:at} WHERE id={:id}").
		Bind(dbx.Params{"at": time.Now().UTC().Format(time.RFC3339Nano), "id": rec.Id}).Execute()
	return nil
}

// artifactFile serves GET/HEAD /a/{token}/files/{n}: the nth published image
// (from 1), as its 1600 px preview so phones load it quickly.
func artifactFile(re *core.RequestEvent) error {
	rec := artifactLookup(re)
	if rec == nil {
		return nil
	}
	files := artifactFiles(rec)
	raw := re.Request.PathValue("n")
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > len(files) || n > artifactMaxFiles || strconv.Itoa(n) != raw {
		return artifactPlain(re, http.StatusNotFound, artifactNotFoundBody)
	}
	att, err := findAttachment(re.App, files[n-1])
	if err != nil || !att.GetBool("image") {
		return artifactPlain(re, http.StatusNotFound, artifactNotFoundBody)
	}
	fsys, err := re.App.NewFilesystem()
	if err != nil {
		return artifactPlain(re, http.StatusServiceUnavailable, "Storage unavailable\n")
	}
	defer fsys.Close()
	key, contentType := thumbs.thumbnail(re.Request.Context(), re.App, fsys, att, "preview")
	h := re.Response.Header()
	h.Set("Content-Type", attachmentServeType(contentType, true))
	h.Set("Content-Disposition", contentDisposition("inline", "image-"+raw+imageExt(contentType)))
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	if err := fsys.Serve(re.Response, re.Request, key, "image-"+raw); err != nil {
		return artifactPlain(re, http.StatusNotFound, artifactNotFoundBody)
	}
	return nil
}

// imageExt returns a file extension for an image content type (display only).
func imageExt(contentType string) string {
	switch contentType {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	}
	return ""
}

func registerArtifactRoutes(e *core.ServeEvent) {
	e.Router.GET("/a/{token}", artifactPage)
	e.Router.GET("/a/{token}/files/{n}", artifactFile)
}

const artifactStyle = `:root{color-scheme:light dark;--bg:#fafaf7;--fg:#2c3a32;--muted:#5f6f64;--rule:#dfe3d8;--code:#eef1ea;--link:#35694f}
@media (prefers-color-scheme:dark){:root{--bg:#141815;--fg:#e2e8e1;--muted:#a3b0a6;--rule:#2d352f;--code:#1e2520;--link:#8fc3a4}}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0 auto;max-width:720px;padding:40px 20px 64px;color:var(--fg);font:17px/1.65 Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}
header{margin-bottom:28px;padding-bottom:16px;border-bottom:1px solid var(--rule)}
h1{margin:0 0 6px;font:400 34px/1.2 Georgia,serif;letter-spacing:-.5px}
header p{margin:0;color:var(--muted);font-size:15px}
article h1{font-size:28px}article h2{font:600 22px/1.3 inherit;margin:32px 0 10px}article h3{font-size:18px;margin:24px 0 8px}
a{color:var(--link)}
img{max-width:100%;height:auto;border-radius:6px}
pre{overflow-x:auto;padding:12px 14px;border-radius:6px;background:var(--code);font-size:14px;line-height:1.5}
code{font:14px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);padding:1px 4px;border-radius:4px}
pre code{padding:0;background:none}
blockquote{margin:16px 0;padding:0 16px;border-left:3px solid var(--rule);color:var(--muted)}
table{border-collapse:collapse;display:block;overflow-x:auto;margin:16px 0}
th,td{border:1px solid var(--rule);padding:6px 10px;text-align:left}
hr{border:0;border-top:1px solid var(--rule);margin:28px 0}`

var artifactCSP = func() string {
	sum := sha256.Sum256([]byte(artifactStyle))
	return "default-src 'none'; img-src 'self'; style-src 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) +
		"'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
}()

// renderArtifactPage builds the standalone page for a published snapshot.
func renderArtifactPage(title, body, publishedAt, token string, files []string, blockedHosts map[string]bool) []byte {
	var out bytes.Buffer
	out.WriteString("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">")
	out.WriteString("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">")
	out.WriteString("<meta name=\"robots\" content=\"" + artifactRobotsHeader + "\">")
	out.WriteString("<meta name=\"referrer\" content=\"no-referrer\">")
	out.WriteString("<title>" + html.EscapeString(title) + "</title>")
	out.WriteString("<style>" + artifactStyle + "</style></head><body><header><h1>")
	out.WriteString(html.EscapeString(title))
	out.WriteString("</h1>")
	if at, err := time.Parse(time.RFC3339Nano, publishedAt); err == nil {
		out.WriteString("<p>Published " + at.UTC().Format("2 January 2006") + "</p>")
	}
	out.WriteString("</header><article>")
	out.Write(renderArtifactMarkdown(body, token, files, blockedHosts))
	out.WriteString("</article></body></html>\n")
	return out.Bytes()
}

// renderArtifactMarkdown renders GFM like notes (raw HTML omitted) after
// rewriting the tree: attachment images point at /a/<token>/files/<n>, other
// images become their text, and links that are not external http(s) or
// mailto become their text.
func renderArtifactMarkdown(source, token string, files []string, blockedHosts map[string]bool) []byte {
	src := []byte(source)
	doc := crewMarkdown.Parser().Parse(text.NewReader(src), parser.WithContext(parser.NewContext()))
	index := map[string]int{}
	for i, id := range files {
		index[id] = i + 1
	}
	type change struct {
		node    ast.Node
		replace ast.Node // nil: unwrap (keep the children in place)
	}
	var changes []change
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch v := n.(type) {
		case *ast.Image:
			dest := strings.TrimSpace(decodeDestination(string(v.Destination)))
			if strings.HasPrefix(strings.ToLower(dest), "attachment:") {
				if n := index[dest[len("attachment:"):]]; n > 0 {
					v.Destination = []byte("/a/" + token + "/files/" + strconv.Itoa(n))
					v.Title = nil
					return ast.WalkSkipChildren, nil
				}
			}
			changes = append(changes, change{node: v})
			return ast.WalkSkipChildren, nil
		case *ast.Link:
			dest := strings.TrimSpace(decodeDestination(string(v.Destination)))
			if allowedArtifactLink(dest, blockedHosts) {
				v.Destination = []byte(dest)
				v.SetAttributeString("rel", []byte(artifactRelAttribute))
			} else {
				changes = append(changes, change{node: v})
			}
		case *ast.AutoLink:
			link := string(v.URL(src))
			if v.AutoLinkType == ast.AutoLinkEmail && !strings.HasPrefix(strings.ToLower(link), "mailto:") {
				link = "mailto:" + link
			}
			if allowedArtifactLink(link, blockedHosts) {
				v.SetAttributeString("rel", []byte(artifactRelAttribute))
			} else {
				changes = append(changes, change{node: v, replace: ast.NewString(v.Label(src))})
			}
		}
		return ast.WalkContinue, nil
	})
	for _, c := range changes {
		parent := c.node.Parent()
		if parent == nil {
			continue
		}
		if c.replace != nil {
			parent.ReplaceChild(parent, c.node, c.replace)
			continue
		}
		for child := c.node.FirstChild(); child != nil; {
			next := child.NextSibling()
			parent.InsertBefore(parent, c.node, child)
			child = next
		}
		parent.RemoveChild(parent, c.node)
	}
	var out bytes.Buffer
	if err := crewMarkdown.Renderer().Render(&out, src, doc); err != nil {
		return []byte("<p>" + html.EscapeString(source) + "</p>")
	}
	return out.Bytes()
}

// allowedArtifactLink keeps only external http(s) and mailto links.
func allowedArtifactLink(dest string, blockedHosts map[string]bool) bool {
	u, err := url.Parse(dest)
	if err != nil {
		return false
	}
	switch strings.ToLower(u.Scheme) {
	case "mailto":
		return u.Opaque != ""
	case "http", "https":
		host := strings.ToLower(u.Host)
		if host == "" || blockedHosts[host] {
			return false
		}
		if h := strings.ToLower(u.Hostname()); blockedHosts[h] {
			return false
		}
		for blocked := range blockedHosts {
			if i := strings.LastIndexByte(blocked, ':'); i > 0 && blocked[:i] == strings.ToLower(u.Hostname()) {
				return false
			}
		}
		return true
	}
	return false
}
