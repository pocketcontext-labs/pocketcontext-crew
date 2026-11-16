package crewruntime

import (
	"bytes"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/hook"

	assets "github.com/pocketcontext-labs/pocketcontext-crew"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/crewpolicy"
)

// readerIcons serves the home-screen, manifest and favicon files that
// ui/scripts/icons.mjs generates into ui/public (copied to the root of
// ui/dist). Core's reader routes serve only index.html and /assets/ scripts,
// styles, fonts and SVGs, so Crew serves these few fixed names itself from the
// embedded build. They are public like the reader's assets (crewpolicy): iOS
// fetches the apple-touch-icon without cookies.
func readerIcons(e *core.ServeEvent) error {
	dist, err := fs.Sub(assets.Assets, "ui/dist")
	if err != nil {
		return err
	}
	for name, contentType := range crewpolicy.ReaderIcons {
		e.Router.GET("/"+name, func(re *core.RequestEvent) error {
			data, err := fs.ReadFile(dist, name)
			if err != nil {
				return re.NotFoundError("Not found.", nil)
			}
			h := re.Response.Header()
			h.Set("Content-Type", contentType)
			// index.html links every icon with ?v=<content hash>; bare names
			// are what browsers probe on their own.
			if re.Request.URL.Query().Has("v") {
				h.Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				h.Set("Cache-Control", "public, max-age=3600")
			}
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("Referrer-Policy", "no-referrer")
			http.ServeContent(re.Response, re.Request, name, time.Time{}, bytes.NewReader(data))
			return nil
		})
	}
	// The reader page's CSP (from core) starts with default-src 'none' and has
	// no manifest-src, which would block the web app manifest; allow it from
	// the same origin only.
	e.Router.Bind(&hook.Handler[*core.RequestEvent]{
		Id:       "crewReaderManifestSrc",
		Priority: -1000,
		Func: func(re *core.RequestEvent) error {
			if r := re.Request; (r.Method == http.MethodGet || r.Method == http.MethodHead) && (r.URL.Path == "/" || r.URL.Path == "/index.html") {
				re.Response = &manifestCSPWriter{ResponseWriter: re.Response}
			}
			return re.Next()
		},
	})
	return nil
}

// manifestCSPWriter adds manifest-src 'self' to a reader page's CSP when the
// response headers are written.
type manifestCSPWriter struct {
	http.ResponseWriter
	done bool
}

func (w *manifestCSPWriter) patch() {
	if w.done {
		return
	}
	w.done = true
	h := w.ResponseWriter.Header()
	if csp := h.Get("Content-Security-Policy"); csp != "" && !strings.Contains(csp, "manifest-src") {
		h.Set("Content-Security-Policy", csp+"; manifest-src 'self'")
	}
}

func (w *manifestCSPWriter) WriteHeader(status int) {
	w.patch()
	w.ResponseWriter.WriteHeader(status)
}

func (w *manifestCSPWriter) Write(b []byte) (int, error) {
	w.patch()
	return w.ResponseWriter.Write(b)
}

// Unwrap lets PocketBase and http.ResponseController reach the real writer.
func (w *manifestCSPWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
