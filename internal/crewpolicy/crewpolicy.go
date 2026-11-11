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
	OAuthResourceName:  "PocketContext Crew notes and tasks",
	OAuthConsent: appserver.OAuthConsentText{
		ConnectionsHTML: `<p>These apps can read and change notes and tasks in every bucket, request human review, and record your review decisions when you delegate them. They cannot enter webhook credentials. Revoke access to disconnect an app.</p>`,
		RequestHTML:     `<p><strong>{{.Name}}</strong> is asking to read and change notes and tasks in every bucket and request human review.</p><p>It can record review decisions you delegate to it, archive buckets and deactivate agents, following the rules in its instructions. It cannot enter or read webhook credentials, administer the server or get shell access.</p>`,
		// Unused while Page.SignInPath and Page.ConnectionsPath replace both places
		// Core would show it; kept so the plain pages still explain sign-in.
		SignInHTML: `If you are not signed in, open your fresh {{.Product}} reader sign-in link in another tab of this browser, then return here. Your setup agent can issue one with <code>open --public</code>. You can also <a href="/" target="_blank" rel="noopener">open the reader</a> and use your password if you set one.`,
		Page: appserver.OAuthPage{
			CSS:             oauthPageCSS,
			BrandHTML:       oauthBrandHTML,
			SignInPath:      "/#/signin",
			ConnectionsPath: "/#/connect",
		},
	},
	BudgetExhausted: "Crew request budget exhausted. Retry after the indicated delay.",
	OTPSubject:      "Log in to PocketContext",
	OTPSenderName:   "PocketContext",
	OTPLoginPath:    "/#/login", // the reader route in sign-in emails already sent
}

// The OAuth page's Content-Security-Policy loads no images or fonts, so the logo
// is inline and the wordmark uses brand.css's fallback face. Colours and type
// follow ui/src/theme.css and the reader's login card; no text is under 16px so
// iOS Safari never zooms.
const oauthBrandHTML = `<div class="crew-brand"><div class="product-brand"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="34" height="34" aria-hidden="true"><path d="M15 10h226v149l-113 87L15 159z" fill="#e9ede2" stroke="#688258" stroke-width="8" stroke-linejoin="round"/><path d="m86 124 30 30 64-70" fill="none" stroke="#2e493e" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg><span>PocketContext</span></div><strong>Crew</strong></div>`

const oauthPageCSS = `:root{color-scheme:light}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{background:#fafaf7}
body{margin:0 auto;min-height:100dvh;max-width:408px;padding:35px 24px;display:flex;flex-direction:column;justify-content:center;background:radial-gradient(ellipse at 50% 20%,#35694f0d,transparent 65%);color:#46554b;font:16px/1.6 Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}
.crew-brand{margin-bottom:32px}
.product-brand{display:inline-flex;align-items:center;gap:7px;color:#263b32;font:700 17px Arial,sans-serif;letter-spacing:-.6px}
.product-brand svg{display:block;flex-shrink:0}
.crew-brand strong{display:block;margin:6px 0 0 41px;color:#638365;font-size:16px;letter-spacing:3px;text-transform:uppercase}
h1{margin:0 0 20px;color:#25332c;font:400 34px/1.15 Georgia,serif;letter-spacing:-1px}
p{margin:0 0 14px}
p strong{color:#25332c;font-weight:600}
small{display:block;margin:0 0 24px;color:#596b5e;font-size:16px}
button,a{font:inherit;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
button{cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
a{color:#35694f}
#approve,#signin{display:block;width:100%;padding:13px 18px;border:0;border-radius:6px;background:#35694f;color:#f7faf7;font-weight:550;text-align:center;text-decoration:none}
#deny{display:block;margin:6px auto 0;padding:10px 12px;border:0;background:none;color:#526657;text-decoration:underline}
#message{margin:14px 0;color:#a13930;white-space:pre-wrap}
#message:empty{display:none}
#signin+p,#message+p{margin-top:24px;text-align:center}
button:focus-visible,a:focus-visible{outline:2px solid #35694f;outline-offset:4px}`

// Policy returns the public routes, maintenance reads and observability lists.
func Policy() appserver.Policy {
	return appserver.Policy{
		PublicRoute: func(core.App) func(method, path string) bool { return PublicRoute },
		Maintenance: maintenance.Policy{
			ReadPosts: map[string]bool{"/api/crew/read": true, "/api/crew/search": true, "/api/crew/query": true, "/api/crew/attachment-read": true, "/api/files/token": true},
			ReadGets:  map[string]bool{"/api/crew/schema": true, "/api/crew/attachment": true},
		},
		Observe:          Observe,
		OAuthScope:       OAuthScope,
		PublicBodyLimit:  110 << 20, // above the 90 MiB multipart cap Crew applies itself
		Legacy:           Legacy,
		Hosted:           HostedBudget,
		AllowPublicUIDev: true,
	}
}

// OAuthScope is the one scope of the MCP endpoint, inherited from PocketContext.
// Connected clients store it, so it must never change.
const OAuthScope = "knowledge"

// HostedBudget is one hosted account's request budget. Clients match the
// inherited label in 429 responses, so it must never change.
var HostedBudget = appserver.HostedBudget{Label: "authenticated_knowledge", Burst: 1200, PerSecond: 100}

// Legacy identifies databases of the PocketContext releases before the
// single-user schema (0.11.0), from which Crew derives and which it has always
// refused to open. Never remove an entry.
var Legacy = appserver.LegacySchema{
	Migrations: []string{
		"1790300000_users.js",
		"1790300100_knowledge.js",
		"1790300200_google_jit.js",
		"1790500000_search.js",
		"1790700000_home.js",
		"1791400000_properties.js",
		"1791500000_spaces.js",
		"1792700000_project_policy.js",
		"1792700100_space_management.js",
	},
	Tables:      []string{"space_members", "user_directory", "project_policy"},
	Description: "multi-account spaces",
}

// Observe lists the diagnostic labels; anything else is reported as unknown.
var Observe = mcpobserve.Policy{
	Tools:     []string{"crew_read", "crew_search", "crew_schema", "crew_query", "crew_write", "crew_attachment"},
	APIRoutes: []string{"/api/crew/read", "/api/crew/search", "/api/crew/schema", "/api/crew/query", "/api/crew/agent-write", "/api/crew/attachment-read"},
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
	// /api/crew/attachment checks the sign-in itself (auth header or a
	// short-lived file token from /api/files/token).
	if read && (p == "/api/realtime" || p == "/api/crew/schema" || p == "/api/crew/attachment") {
		return true
	}
	if method == http.MethodPost {
		switch p {
		case "/api/crew/read", "/api/crew/search", "/api/crew/query", "/api/crew/write", "/api/crew/agent-write", "/api/crew/attachment-read", "/api/files/token", "/api/bundle/redeem", "/api/collections/users/auth-with-password", "/api/collections/users/auth-refresh", "/api/realtime":
			return true
		// The one-time upload link endpoints: token-scoped, upload only.
		case "/api/crew/upload-link/info", "/api/crew/upload-link/upload":
			return true
		}
	}
	return false
}
