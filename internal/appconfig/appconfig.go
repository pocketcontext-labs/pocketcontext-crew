// Package appconfig constructs the Crew runtime on pocketcontext-core.
package appconfig

import (
	"net/http"
	"slices"
	"strings"

	"github.com/pocketcontext-labs/pocketcontext-core/appidentity"
	"github.com/pocketcontext-labs/pocketcontext-core/appserver"
	"github.com/pocketcontext-labs/pocketcontext-core/profiles"

	assets "github.com/pocketcontext-labs/pocketcontext-crew"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/buildinfo"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/crewpolicy"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/crewruntime"
)

// Identity is Crew's validated identity.
var Identity appidentity.Identity = crewpolicy.Identity

// Runtime is the one validated runtime of this process.
var Runtime = mustRuntime()

// Profiles is this application's private profile registry.
var Profiles *profiles.Store = Runtime.Profiles()

func mustRuntime() *appserver.Runtime {
	rt, err := appserver.New(appserver.Config{
		Identity: crewpolicy.Identity, Version: buildinfo.Version, Commit: buildinfo.Commit, Assets: assets.Assets,
		Policy: crewpolicy.Policy(), Hooks: crewruntime.Hooks(), Text: crewpolicy.Text,
	})
	if err != nil {
		panic(err)
	}
	return rt
}

// KnownApp reports whether an app id belongs to this application or an earlier
// release of it. An earlier id may be diagnosed and stopped, never adopted.
func KnownApp(app string) bool {
	return app == Identity.AppID || slices.Contains(Identity.LegacyAppIDs, app)
}

// ValidatedMCPPublicRequest identifies a request that passed the configured
// public host and origin boundary. A client or forwarded header cannot supply it.
func ValidatedMCPPublicRequest(r *http.Request) bool {
	origin, ok := appserver.PublicOrigin(r)
	if !ok || !appserver.IsPublicRequest(r) {
		return false
	}
	if "https://"+strings.TrimSuffix(r.Host, ":443") != origin {
		return false
	}
	return r.Header.Get("Origin") == "" || r.Header.Get("Origin") == origin
}
