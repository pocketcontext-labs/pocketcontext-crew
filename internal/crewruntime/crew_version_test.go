package crewruntime

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"github.com/pocketcontext-labs/pocketcontext-crew/internal/buildinfo"
)

func TestCrewRunningVersionRequiresOwnerSession(t *testing.T) {
	for _, hosted := range []bool{false, true} {
		name := "native"
		if hosted {
			name = "hosted"
		}
		t.Run(name, func(t *testing.T) {
			a := newTestApp(t)
			router, err := apis.NewRouter(a.app)
			if err != nil {
				t.Fatal(err)
			}
			if err := versionRoute(&core.ServeEvent{App: a.app, Router: router}); err != nil {
				t.Fatal(err)
			}
			if err = a.app.OnServe().Trigger(&core.ServeEvent{App: a.app, Router: router}); err != nil {
				t.Fatal(err)
			}
			raw, err := router.BuildMux()
			if err != nil {
				t.Fatal(err)
			}
			public := raw
			for _, tc := range []struct {
				name, url string
				handler   http.Handler
			}{
				{"private", "http://127.0.0.1:8096/api/bundle/version", raw},
				{"public", "https://knowledge.example.com/api/bundle/version", public},
			} {
				for _, token := range []string{"", a.token} {
					req := httptest.NewRequest("GET", tc.url, nil)
					req.RemoteAddr = "127.0.0.1:12345"
					if token != "" {
						req.Header.Set("Authorization", token)
					}
					response := httptest.NewRecorder()
					tc.handler.ServeHTTP(response, req)
					if token == "" {
						if response.Code != 401 {
							t.Fatalf("%s anonymous status=%d body=%s", tc.name, response.Code, response.Body)
						}
						continue
					}
					if response.Code != 200 {
						t.Fatalf("%s signed-in status=%d body=%s", tc.name, response.Code, response.Body)
					}
					if response.Header().Get("Cache-Control") != "no-store" {
						t.Fatal("running metadata may be cached")
					}
					var metadata map[string]string
					if err = json.Unmarshal(response.Body.Bytes(), &metadata); err != nil {
						t.Fatal(err)
					}
					if len(metadata) != 2 || metadata["version"] != buildinfo.Version || metadata["commit"] != buildinfo.Commit {
						t.Fatalf("unexpected metadata: %v", metadata)
					}
				}
			}
		})
	}
}
