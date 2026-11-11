// Package crewruntime is the Crew product code that runs inside the shared
// pocketcontext-core server: records, webhooks and the retired-knowledge archive.
package crewruntime

import (
	"context"
	"fmt"
	"net/http"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"github.com/dop251/goja"

	"github.com/pocketcontext-labs/pocketcontext-core/appserver"
	"github.com/pocketcontext-labs/pocketcontext-core/atomicfile"

	"github.com/pocketcontext-labs/pocketcontext-crew/internal/buildinfo"
)

type (
	Project = appserver.Project
	Store   = appserver.Store
)

// Hooks returns Crew's product code at each point the server diverges.
func Hooks() appserver.Hooks {
	return appserver.Hooks{
		AfterDatabaseCheck: func(p *Project, store *Store) error {
			if err := prepareKnowledgeArchive(p, store); err != nil {
				return fmt.Errorf("preserving retired knowledge: %w", err)
			}
			return nil
		},
		PreRegister: func(app core.App, p *Project, opts appserver.ServeOptions) error {
			configureWebhookRuntime(app, p, opts.HTTPSDomain)
			return nil
		},
		Register: func(app core.App, _ appserver.RegisterContext) error {
			registerCrewReads(app)
			return nil
		},
		OnServeStart: func(e *core.ServeEvent, p *Project) error {
			return restoreLocalWebhookMarker(e.App, p)
		},
		Routes:          versionRoute,
		Background:      func(ctx context.Context, app core.App) { newWebhookDispatcher(app).run(ctx) },
		OnHostedRestore: restoreWebhookState,
		Bindings:        func(*goja.Runtime) map[string]any { return hookBindings() },
	}
}

// versionRoute serves build metadata that stays behind the owner's signed-in
// session, separate from local instance metadata (private paths and keys).
func versionRoute(e *core.ServeEvent) error {
	e.Router.GET("/api/bundle/version", func(re *core.RequestEvent) error {
		re.Response.Header().Set("Cache-Control", "no-store")
		return re.JSON(http.StatusOK, map[string]string{"version": buildinfo.Version, "commit": buildinfo.Commit})
	}).Bind(apis.RequireAuth("users"))
	return nil
}

func hookBindings() map[string]any {
	return map[string]any{
		"crewVersion": func() map[string]string {
			return map[string]string{"version": buildinfo.Version, "commit": buildinfo.Commit}
		},
		"verifyKnowledgeArchive":  verifyKnowledgeArchive,
		"recordKnowledgeArchive":  recordKnowledgeArchive,
		"webhookSeal":             webhookSeal,
		"webhookFingerprint":      webhookFingerprint,
		"webhookValidateEndpoint": webhookValidateEndpoint,
		"webhookInstanceURL":      webhookInstanceURL,
		"webhookBaseURL":          webhookInstanceURL,
		"webhookCredentialReady":  webhookCredentialReady,
		"webhookUUID":             webhookUUID,
		"crewRecordLink":          crewRecordLink,
		"crewAttachmentFiles":     crewAttachmentFiles,
		"crewUploadAllow":         uploadLimiter.allow,
	}
}

var (
	writeAtomic = atomicfile.WriteAtomic
	copyFile    = atomicfile.CopyFile
	fileSHA256  = atomicfile.FileSHA256
)
