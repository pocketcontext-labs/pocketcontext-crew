package crewruntime

import (
	"net/http"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/security"
	"github.com/golang-jwt/jwt/v5"
)

// The sandboxed HTML preview (0.26.0). The reader frames an HTML or SVG
// attachment from GET /api/crew/attachment?id=ID&preview=TOKEN. The frame sends
// no credentials, so a short-lived token signed for that one attachment and the
// signed-in owner authorizes it. The response's CSP sandbox gives the page an
// opaque origin (in the frame and in a new tab): it runs its own inline scripts
// but cannot read Crew's storage or DOM, call Crew as the owner, navigate the
// top window, open windows, submit forms or load anything from the network.

const (
	previewTokenType = "crew_preview"
	previewTTL       = 5 * time.Minute
	// previewKeySuffix separates preview tokens from PocketBase file tokens
	// signed with the same record key.
	previewKeySuffix = "|crew-attachment-preview"
)

// previewCSP is the sandbox for previewed pages. Only the reader may frame them.
const previewCSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; " +
	"style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; " +
	"connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"

// previewable reports whether an attachment's stored type opens in the preview.
func previewable(mediaType string) bool {
	return mediaType == "text/html" || mediaType == "image/svg+xml"
}

func previewKey(user *core.Record) string {
	return user.TokenKey() + user.Collection().FileToken.Secret + previewKeySuffix
}

// newPreviewToken signs a token for one attachment and the signed-in owner.
func newPreviewToken(user *core.Record, attachmentID string) (string, error) {
	return security.NewJWT(jwt.MapClaims{
		core.TokenClaimId:           user.Id,
		core.TokenClaimType:         previewTokenType,
		core.TokenClaimCollectionId: user.Collection().Id,
		"attachment":                attachmentID,
	}, previewKey(user), previewTTL)
}

// previewTokenValid checks the signature, expiry, type, owner and attachment.
func previewTokenValid(app core.App, token, attachmentID string) bool {
	unverified, err := security.ParseUnverifiedJWT(token)
	if err != nil {
		return false
	}
	id, _ := unverified[core.TokenClaimId].(string)
	if id == "" {
		return false
	}
	user, err := app.FindRecordById("users", id)
	if err != nil {
		return false
	}
	claims, err := security.ParseJWT(token, previewKey(user))
	if err != nil {
		return false
	}
	return claims[core.TokenClaimType] == previewTokenType &&
		claims["attachment"] == attachmentID &&
		claims[core.TokenClaimCollectionId] == user.Collection().Id
}

// attachmentPreviewLink: POST /api/crew/attachment-preview {id} (signed in)
// returns {url, expires_at} for one previewable attachment.
func attachmentPreviewLink(re *core.RequestEvent) error {
	if re.Auth == nil || re.Auth.Collection().Name != "users" {
		return re.UnauthorizedError("Sign in to preview attachments.", nil)
	}
	var body struct {
		ID string `json:"id"`
	}
	if err := re.BindBody(&body); err != nil {
		return re.BadRequestError("Send the attachment id.", nil)
	}
	rec, err := findAttachment(re.App, body.ID)
	if err != nil {
		return re.NotFoundError("Attachment not found.", nil)
	}
	if !previewable(rec.GetString("media_type")) {
		return re.BadRequestError("Only HTML and SVG attachments have a preview (not_previewable).", nil)
	}
	token, err := newPreviewToken(re.Auth, rec.Id)
	if err != nil {
		return re.InternalServerError("Could not sign the preview.", nil)
	}
	return re.JSON(http.StatusOK, map[string]any{
		"url":        "/api/crew/attachment?id=" + rec.Id + "&preview=" + token,
		"expires_at": time.Now().Add(previewTTL).UTC().Format(time.RFC3339),
	})
}

// attachmentPreviewFile serves one previewable attachment in the sandbox.
func attachmentPreviewFile(re *core.RequestEvent, token string) error {
	id := re.Request.URL.Query().Get("id")
	rec, err := findAttachment(re.App, id)
	if err != nil || !previewTokenValid(re.App, token, id) {
		return re.UnauthorizedError("This preview link has expired. Open the file again in Crew.", nil)
	}
	mediaType := rec.GetString("media_type")
	if !previewable(mediaType) {
		return re.BadRequestError("Only HTML and SVG attachments have a preview (not_previewable).", nil)
	}
	fsys, err := re.App.NewFilesystem()
	if err != nil {
		return re.InternalServerError("Storage unavailable", nil)
	}
	defer fsys.Close()
	contentType := "text/html; charset=utf-8"
	if mediaType == "image/svg+xml" {
		contentType = "image/svg+xml"
	}
	name := rec.GetString("name")
	h := re.Response.Header()
	h.Set("Content-Type", contentType)
	h.Set("Content-Disposition", contentDisposition("inline", name))
	h.Set("Content-Security-Policy", previewCSP)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Cross-Origin-Opener-Policy", "same-origin")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Robots-Tag", "noindex")
	if err := fsys.Serve(re.Response, re.Request, rec.BaseFilesPath()+"/"+rec.GetString("file"), name); err != nil {
		return re.NotFoundError("Attachment file missing.", nil)
	}
	return nil
}

func registerAttachmentPreviewRoutes(e *core.ServeEvent) {
	e.Router.POST("/api/crew/attachment-preview", attachmentPreviewLink).Bind(apis.RequireAuth("users"))
}
