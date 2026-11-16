package appconfig

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image/png"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/pocketcontext-labs/pocketcontext-core/appserver"
)

// The reader's home-screen icon, favicons and web app manifest are reachable on
// the public HTTPS listener without sign-in (iOS fetches the apple-touch-icon
// without cookies), from the URLs index.html and the manifest link.
func TestPublicReaderIcons(t *testing.T) {
	a := newTestApp(t)
	reader, err := filepath.Abs("../../ui/dist")
	if err != nil {
		t.Fatal(err)
	}
	server, err := Runtime.NewTestServer(a.app, appserver.TestServerOptions{Domain: syntheticDomain, ReaderDir: reader, Cache: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	get := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		server.Public().ServeHTTP(w, server.MarkPublic(httptest.NewRequest(http.MethodGet, "https://"+syntheticDomain+path, nil)))
		if w.Code != http.StatusOK {
			t.Fatalf("GET %s: %d %s", path, w.Code, w.Body)
		}
		return w
	}
	index := get("/")
	if csp := index.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'none'") || !strings.HasSuffix(csp, "; manifest-src 'self'") {
		t.Fatal("reader CSP must allow the same-origin manifest:", csp)
	}
	links := map[string]string{}
	for _, m := range regexp.MustCompile(`<link rel="([a-z-]+)"(?: type="[^"]+")? href="([^"]+)"`).FindAllStringSubmatch(index.Body.String(), -1) {
		path, _, _ := strings.Cut(m[2], "?")
		links[m[1]+" "+filepath.Ext(path)[1:]] = m[2]
	}
	version := regexp.MustCompile(`^/[a-z0-9-]+\.[a-z]+\?v=[0-9a-f]{10}$`)
	pngSize := func(path string, wantAlpha bool) int {
		w := get(path)
		if w.Header().Get("Content-Type") != "image/png" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatal(path, w.Header())
		}
		img, err := png.Decode(bytes.NewReader(w.Body.Bytes()))
		if err != nil {
			t.Fatal(path, err)
		}
		// Colour type 2 (RGB) has no alpha channel; iOS turns alpha black.
		if colorType := w.Body.Bytes()[25]; (colorType == 6) != wantAlpha || colorType != 2 && colorType != 6 {
			t.Fatalf("%s colour type %d", path, colorType)
		}
		if b := img.Bounds(); b.Dx() != b.Dy() {
			t.Fatal(path, "not square", b)
		}
		return img.Bounds().Dx()
	}

	touch := links["apple-touch-icon png"]
	if !version.MatchString(touch) || pngSize(touch, false) != 180 {
		t.Fatal("apple-touch-icon", touch, links)
	}
	ico := links["icon ico"]
	if !version.MatchString(ico) {
		t.Fatal("favicon.ico link", links)
	}
	if w := get(ico); w.Header().Get("Content-Type") != "image/x-icon" || binary.LittleEndian.Uint16(w.Body.Bytes()[2:]) != 1 || w.Body.Bytes()[6] != 32 || w.Body.Bytes()[7] != 32 {
		t.Fatal("favicon.ico", w.Header(), w.Body.Len())
	}
	if svg := links["icon svg"]; !strings.HasPrefix(svg, "/assets/favicon-") || !strings.Contains(get(svg).Body.String(), `fill="#c8f169"`) {
		t.Fatal("favicon.svg", svg)
	}
	manifestURL := links["manifest webmanifest"]
	if !version.MatchString(manifestURL) {
		t.Fatal("manifest link", links)
	}
	w := get(manifestURL)
	if w.Header().Get("Content-Type") != "application/manifest+json" {
		t.Fatal("manifest type", w.Header())
	}
	var manifest struct {
		Icons []struct{ Src, Sizes, Type, Purpose string }
	}
	raw := map[string]any{}
	if err := json.Unmarshal(w.Body.Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(w.Body.Bytes(), &raw)
	if raw["name"] != "Crew" || raw["short_name"] != "Crew" || raw["start_url"] != "/" || raw["display"] != "standalone" || raw["theme_color"] != "#0d1712" || raw["background_color"] != "#0d1712" {
		t.Fatal("manifest", raw)
	}
	want := []string{"192x192 any", "512x512 any", "512x512 maskable"}
	if len(manifest.Icons) != len(want) {
		t.Fatal("manifest icons", manifest.Icons)
	}
	for i, icon := range manifest.Icons {
		size := pngSize(icon.Src, false)
		if !version.MatchString(icon.Src) || icon.Type != "image/png" || icon.Sizes+" "+icon.Purpose != want[i] || icon.Sizes != fmt.Sprintf("%dx%d", size, size) {
			t.Fatal("manifest icon", icon, size)
		}
	}
	// Bare names (what browsers probe without a link) work too, and nothing
	// else at the root does.
	get("/apple-touch-icon.png")
	get("/favicon.ico")
	for _, path := range []string{"/apple-touch-icon-precomposed.png", "/assets/icon-192.png", "/manifest.json"} {
		w := httptest.NewRecorder()
		server.Public().ServeHTTP(w, server.MarkPublic(httptest.NewRequest(http.MethodGet, "https://"+syntheticDomain+path, nil)))
		if w.Code == http.StatusOK {
			t.Fatal(path, "is served")
		}
	}
}
