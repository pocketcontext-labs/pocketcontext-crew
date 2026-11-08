// Package crewpolicy holds what makes this server PocketContext Crew rather
// than another application of pocketcontext-core: its identity, public route
// allowlist, maintenance reads and copy. It carries no runtime state.
package crewpolicy

import (
	"net/http"
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"github.com/pocketcontext-labs/pocketcontext-core/appidentity"
	"github.com/pocketcontext-labs/pocketcontext-core/appserver"
	"github.com/pocketcontext-labs/pocketcontext-core/maintenance"
	"github.com/pocketcontext-labs/pocketcontext-core/mcpobserve"
)

// Identity is Crew's identity. Names of files, variables and headers that older
// binaries, hosted containers and backups rely on must never change here.
var Identity = appidentity.Identity{
	AppID:             "pocketcontext-crew",
	LegacyAppIDs:      []string{"pocketcontext"},
	DisplayName:       "PocketContext Crew",
	Command:           "pocketcontext-crew",
	SkillName:         "pocketcontext-crew",
	Marker:            ".pocketcontext-crew",
	RouterMarker:      ".pocketcontext-crew-router",
	RegistryNamespace: "pocketcontext-crew",
	CacheRoot:         "pocketcontext", // holds the working copy, keys and hosted state; never move
	SocketHost:        "pocketcontext.internal",
	SocketDirPrefix:   "pocketcontext",
	DefaultPort:       8099,
	DatabaseFile:      "pocketcontext.db",
	ConfigFile:        "pocketcontext.json",
	EnvPrefix:         "POCKETCONTEXT",
	LocalKeyHeader:    "X-PocketContext-Local-Key",
	LocalAccountEmail: "me@pocketcontext.localhost",
	ReaderStorageKey:  "pocketcontext.reader.auth",
	HookGlobal:        "$pocketcontext",
}

// Text is the copy shown to people.
var Text = appserver.Text{
	AccountName:        "PocketContext",
	LegacyRecreateHint: "Keep using the earlier release for it, or start a new project with `pocketcontext-crew init --db NEW_PATH` and recreate the Crew records you need",
	OAuthResourceName:  "PocketContext Crew memory and tasks",
	OAuthConsent: appserver.OAuthConsentText{
		ConnectionsHTML: `<p>These apps can read and change shared memory and tasks in every bucket, and request human review. They cannot record your approval decisions. Revoke access to disconnect an app.</p>`,
		RequestHTML:     `<p><strong>{{.Name}}</strong> is asking to read and change shared memory and tasks in every bucket, request human review, and access supporting knowledge and originals.</p><p>This does not grant human approval decisions, bucket archival, agent deactivation, server administration or shell access.</p>`,
	},
	BudgetExhausted: "Crew request budget exhausted. Retry after the indicated delay.",
	OTPSubject:      "Log in to PocketContext",
	OTPSenderName:   "PocketContext",
}

// Policy returns the public routes, maintenance reads and observability lists.
func Policy() appserver.Policy {
	return appserver.Policy{
		PublicRoute: func(core.App) func(method, path string) bool { return PublicRoute },
		Maintenance: maintenance.Policy{
			ReadPosts: map[string]bool{"/api/crew/read": true, "/api/crew/search": true, "/api/crew/query": true},
			ReadGets:  map[string]bool{"/api/crew/schema": true},
		},
		Observe:          Observe,
		AllowPublicUIDev: true,
	}
}

// Observe lists the diagnostic labels; anything else is reported as unknown.
var Observe = mcpobserve.Policy{
	Tools:     []string{"crew_read", "crew_search", "crew_schema", "crew_query", "crew_write"},
	APIRoutes: []string{"/api/crew/read", "/api/crew/search", "/api/crew/schema", "/api/crew/query", "/api/crew/agent-write"},
}

// PublicRoute is deliberately an allowlist. A future local API does not become
// public merely because it was registered on the application's router.
func PublicRoute(method, p string) bool {
	read := method == http.MethodGet || method == http.MethodHead
	if read && (p == "/" || p == "/api/bundle/auth-mode" || p == "/api/bundle/version" || p == "/bundle/login" || p == "/bundle/login.js") {
		return true
	}
	if read && strings.HasPrefix(p, "/assets/") && appserver.ReaderAssetName(strings.TrimPrefix(p, "/assets/")) {
		return true
	}
	if read && (p == "/api/realtime" || p == "/api/crew/schema") {
		return true
	}
	if method == http.MethodPost {
		switch p {
		case "/api/crew/read", "/api/crew/search", "/api/crew/query", "/api/crew/write", "/api/crew/agent-write", "/api/bundle/redeem", "/api/collections/users/auth-with-password", "/api/collections/users/auth-refresh", "/api/realtime":
			return true
		}
	}
	return false
}
