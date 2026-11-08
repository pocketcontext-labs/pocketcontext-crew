//go:build crew_core_testkit

// These tests compose Crew around core's appserver.TestServer, which needs a
// newer core release than the one Crew ships. They compile only with the
// crew_core_testkit build tag and -modfile=tests/core-testkit.mod, so go.mod and
// the production binary are unaffected. Run them with:
//
//	CGO_ENABLED=1 go test -modfile=tests/core-testkit.mod -tags "$(cat build-tags.txt),crew_core_testkit" ./internal/appconfig
package appconfig

import (
	"path/filepath"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/plugins/jsvm"
	"github.com/pocketcontext-labs/pocketcontext-core/appserver"

	"github.com/pocketcontext-labs/pocketcontext-crew/internal/crewruntime"
)

const syntheticDomain = "knowledge.example.com"

type testApp struct {
	app  core.App
	user *core.Record
}

// newTestApp runs Crew's real hooks and migrations on an isolated database and
// creates the one account. OnServe is left to the test server, which triggers it.
func newTestApp(t *testing.T) *testApp {
	t.Helper()
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	app := core.NewBaseApp(core.BaseAppConfig{DataDir: t.TempDir()})
	hooks := crewruntime.Hooks()
	if err := hooks.PreRegister(app, &appserver.Project{Cache: t.TempDir()}, appserver.ServeOptions{HTTPSDomain: syntheticDomain}); err != nil {
		t.Fatal(err)
	}
	jsvm.MustRegister(app, Runtime.HooksConfig(root, ""))
	if err := hooks.Register(app, appserver.RegisterContext{}); err != nil {
		t.Fatal(err)
	}
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// Close Crew's read-only connections like server shutdown does; Windows
		// cannot remove a temporary directory with open database files.
		_ = app.OnTerminate().Trigger(&core.TerminateEvent{App: app})
		_ = app.ResetBootstrapState()
	})
	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	u := core.NewRecord(users)
	u.SetEmail(Identity.LocalAccountEmail)
	u.SetPassword("synthetic-password")
	u.SetVerified(true)
	if err := app.Save(u); err != nil {
		t.Fatal(err)
	}
	return &testApp{app: app, user: u}
}

func syntheticHostedConfig() *appserver.HostedConfig {
	return &appserver.HostedConfig{OwnerEmail: "owner@example.test", From: "login@example.test", SMTP: core.SMTPConfig{Enabled: true, Host: "smtp.example.test", Port: 465, TLS: true, Username: "resend", Password: "synthetic"}}
}

func setOwnerEmail(t *testing.T, a *testApp) {
	t.Helper()
	a.user.SetEmail("owner@example.test")
	if err := a.app.Save(a.user); err != nil {
		t.Fatal(err)
	}
}
