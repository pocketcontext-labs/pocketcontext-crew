package crewruntime

import (
	"bytes"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/security"
	"github.com/golang-jwt/jwt/v5"
)

func previewLink(t *testing.T, a *testApp, token, id string, want int) map[string]any {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"id": id})
	return a.request(t, "POST", "/api/crew/attachment-preview", token, string(raw), want)
}

// previewQuery turns a signed preview URL into the attachment route's query.
func previewQuery(t *testing.T, link string) string {
	t.Helper()
	u, err := url.Parse(link)
	if err != nil || u.Path != "/api/crew/attachment" {
		t.Fatal("preview url", link, err)
	}
	return u.RawQuery
}

func TestAttachmentHTMLPreview(t *testing.T) {
	a := newTestApp(t)
	task := newTask(t, a, map[string]any{})
	page := []byte(`<!doctype html><title>Synthetic prototype</title><script>document.title="ran"</script>`)
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>`)
	out := multipartRequest(t, a, "/api/crew/write", a.token, envelope("attachment.add", map[string]any{"task": task["id"]}),
		[]testFile{{"homepage.html", page}, {"logo.svg", svg}, {"notes.txt", []byte("plain")}}, 200)
	ids := []string{}
	for _, x := range out["attachments"].([]any) {
		ids = append(ids, x.(map[string]any)["id"].(string))
	}
	html, svgID, text := ids[0], ids[1], ids[2]

	// Signing needs the owner's sign-in and a previewable file.
	previewLink(t, a, "", html, 401)
	previewLink(t, a, a.token, "zzzzzzzzzzzzzzz", 404)
	previewLink(t, a, a.token, text, 400)
	link := previewLink(t, a, a.token, html, 200)
	expires, err := time.Parse(time.RFC3339, link["expires_at"].(string))
	if err != nil || time.Until(expires) > previewTTL || time.Until(expires) < previewTTL-time.Minute {
		t.Fatal("expires_at", link)
	}
	query := previewQuery(t, link["url"].(string))

	// The frame sends no credentials: the token alone opens this one file.
	res := attachmentGet(t, a, query, "", 200)
	h := res.Header()
	if !bytes.Equal(res.Body.Bytes(), page) || h.Get("Content-Type") != "text/html; charset=utf-8" ||
		!strings.HasPrefix(h.Get("Content-Disposition"), "inline") || h.Get("X-Content-Type-Options") != "nosniff" ||
		h.Get("Referrer-Policy") != "no-referrer" || h.Get("Cache-Control") != "no-store" || (h.Get("X-Frame-Options") != "" && h.Get("X-Frame-Options") != "SAMEORIGIN") {
		t.Fatal("preview headers", h)
	}
	csp := h.Get("Content-Security-Policy")
	for _, want := range []string{"sandbox allow-scripts;", "default-src 'none'", "connect-src 'none'", "form-action 'none'", "frame-ancestors 'self'"} {
		if !strings.Contains(csp, want) {
			t.Errorf("preview CSP lacks %q: %s", want, csp)
		}
	}
	for _, never := range []string{"allow-same-origin", "allow-top-navigation", "allow-popups", "allow-forms", "allow-modals", "allow-downloads", "http", "*"} {
		if strings.Contains(csp, never) {
			t.Errorf("preview CSP allows %q: %s", never, csp)
		}
	}

	// The token is for that attachment only, and only for previews.
	token := strings.TrimPrefix(query[strings.Index(query, "preview="):], "preview=")
	attachmentGet(t, a, "id="+svgID+"&preview="+token, "", 401)
	attachmentGet(t, a, "id="+text+"&preview="+token, "", 401)
	attachmentGet(t, a, "id="+html+"&token="+token, "", 401)
	attachmentGet(t, a, "id="+html+"&preview=bogus", "", 401)
	// An auth token or a file token is not a preview token.
	attachmentGet(t, a, "id="+html+"&preview="+a.token, "", 401)
	fileToken := a.request(t, "POST", "/api/files/token", a.token, "", 200)["token"].(string)
	attachmentGet(t, a, "id="+html+"&preview="+fileToken, "", 401)

	// Expired tokens and tokens signed with another key are refused.
	owner, err := a.app.FindFirstRecordByFilter("users", "id!=''")
	if err != nil {
		t.Fatal(err)
	}
	claims := jwt.MapClaims{core.TokenClaimId: owner.Id, core.TokenClaimType: previewTokenType, core.TokenClaimCollectionId: owner.Collection().Id, "attachment": html}
	expired, _ := security.NewJWT(claims, previewKey(owner), -time.Minute)
	attachmentGet(t, a, "id="+html+"&preview="+expired, "", 401)
	forged, _ := security.NewJWT(claims, "not-the-key", time.Minute)
	attachmentGet(t, a, "id="+html+"&preview="+forged, "", 401)

	// Everywhere else HTML and SVG stay downloads with a passive type.
	plain := attachmentGet(t, a, "id="+html, a.token, 200)
	if plain.Header().Get("Content-Type") != "application/octet-stream" || !strings.HasPrefix(plain.Header().Get("Content-Disposition"), "attachment") {
		t.Fatal("html served actively without preview", plain.Header())
	}

	// SVG previews in the same sandbox.
	svgRes := attachmentGet(t, a, previewQuery(t, previewLink(t, a, a.token, svgID, 200)["url"].(string)), "", 200)
	if svgRes.Header().Get("Content-Type") != "image/svg+xml" || !strings.HasPrefix(svgRes.Header().Get("Content-Security-Policy"), "sandbox allow-scripts;") {
		t.Fatal("svg preview headers", svgRes.Header())
	}
}

func TestSessionGuideSetting(t *testing.T) {
	a := newTestApp(t)
	read := a.request(t, "POST", "/api/crew/read", a.token, `{"collection":"settings"}`, 200)
	s := read["items"].([]any)[0].(map[string]any)
	if s["session_guide_off"] != false {
		t.Fatal("default session_guide_off", s)
	}
	id, rev := s["id"].(string), int(s["revision"].(float64))
	crewWrite(t, a, false, "settings.update", id, rev, map[string]any{"session_guide_off": "yes"}, 400)
	crewWrite(t, a, false, "settings.update", id, rev, map[string]any{"storage_limit_bytes": 1 << 20}, 400)
	updated := crewWrite(t, a, false, "settings.update", id, rev, map[string]any{"session_guide_off": true}, 200)
	if updated["session_guide_off"] != true || updated["revision"] != float64(rev+1) || updated["storage_limit_bytes"] != float64(5<<30) {
		t.Fatal("settings.update", updated)
	}
	crewWrite(t, a, false, "settings.update", id, rev, map[string]any{"session_guide_off": false}, 409)
	if len(eventsOf(t, a, id, "settings.update")) != 1 {
		t.Fatal("settings.update event")
	}
	doc := capabilitiesItem(t, a, `{"collection":"capabilities"}`)
	op := doc["operations"].(map[string]any)["settings.update"].(map[string]any)
	if op["authority"] != "shared_mcp" {
		t.Fatal("settings.update capability", op)
	}
}
