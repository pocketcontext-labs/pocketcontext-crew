package appconfig

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketcontext-labs/pocketcontext-core/appserver"
)

// Protected attachment reads and the upload-link endpoints over the public
// HTTPS boundary (domain route allowlist): sign-in required for bytes, the
// link token alone only uploads.
func TestPublicAttachmentReadsRequireSignIn(t *testing.T) {
	a := newTestApp(t)
	token, err := a.user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	server, err := Runtime.NewTestServer(a.app, appserver.TestServerOptions{Domain: syntheticDomain, Cache: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	public := server.Public()
	send := func(method, path, contentType string, body io.Reader, auth string) *httptest.ResponseRecorder {
		r := server.MarkPublic(httptest.NewRequest(method, "https://"+syntheticDomain+path, body))
		if contentType != "" {
			r.Header.Set("Content-Type", contentType)
		}
		if auth != "" {
			r.Header.Set("Authorization", auth)
		}
		w := httptest.NewRecorder()
		public.ServeHTTP(w, r)
		return w
	}
	decode := func(w *httptest.ResponseRecorder) map[string]any {
		var out map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(w.Code, w.Body.String())
		}
		return out
	}
	multipartBody := func(fields map[string]string, name string, data []byte) (string, *bytes.Buffer) {
		var b bytes.Buffer
		w := multipart.NewWriter(&b)
		for k, v := range fields {
			w.WriteField(k, v)
		}
		part, _ := w.CreateFormFile("files", name)
		part.Write(data)
		w.Close()
		return w.FormDataContentType(), &b
	}
	created := send("POST", "/api/crew/write", "application/json", strings.NewReader(`{"action":"task.create","data":{"title":"Public attachment task"}}`), token)
	if created.Code != 200 {
		t.Fatal(created.Code, created.Body)
	}
	task := decode(created)["id"].(string)
	envelope, _ := json.Marshal(map[string]any{"action": "attachment.add", "data": map[string]any{"task": task}})
	contentType, body := multipartBody(map[string]string{"@jsonPayload": string(envelope)}, "notes.txt", []byte("synthetic public bytes"))
	added := send("POST", "/api/crew/write", contentType, body, token)
	if added.Code != 200 {
		t.Fatal("multipart over HTTPS", added.Code, added.Body)
	}
	id := decode(added)["attachments"].([]any)[0].(map[string]any)["id"].(string)
	if w := send("GET", "/api/crew/attachment?id="+id, "", nil, ""); w.Code != http.StatusUnauthorized {
		t.Fatal("unauthenticated public file read", w.Code)
	}
	signed := send("GET", "/api/crew/attachment?id="+id, "", nil, token)
	if signed.Code != 200 || signed.Body.String() != "synthetic public bytes" || signed.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("signed-in public file read", signed.Code, signed.Header())
	}
	fileToken := send("POST", "/api/files/token", "", nil, token)
	if fileToken.Code != 200 {
		t.Fatal("file token over HTTPS", fileToken.Code, fileToken.Body)
	}
	if w := send("GET", "/api/crew/attachment?id="+id+"&token="+decode(fileToken)["token"].(string), "", nil, ""); w.Code != 200 {
		t.Fatal("file-token read over HTTPS", w.Code, w.Body)
	}
	if w := send("POST", "/api/crew/attachment-read", "application/json", strings.NewReader(`{"id":"`+id+`","variant":"text"}`), ""); w.Code != http.StatusUnauthorized {
		t.Fatal("unauthenticated attachment-read", w.Code)
	}
	// PocketBase's generic file route stays private on the domain.
	if w := send("GET", "/api/files/crew_attachments/"+id+"/x.txt", "", nil, token); w.Code != http.StatusNotFound {
		t.Fatal("generic file route reachable", w.Code)
	}
	// Upload link: reader creates it, the phone uses only the token.
	link := send("POST", "/api/crew/write", "application/json", strings.NewReader(`{"action":"upload_link.create","data":{"task":"`+task+`"}}`), token)
	if link.Code != 200 {
		t.Fatal(link.Code, link.Body)
	}
	linked := decode(link)
	if linked["url"] != "https://"+syntheticDomain+"/#/upload/"+linked["token"].(string) {
		t.Fatal("upload link url", linked["url"])
	}
	info := send("POST", "/api/crew/upload-link/info", "application/json", strings.NewReader(`{"token":"`+linked["token"].(string)+`"}`), "")
	if info.Code != 200 || decode(info)["title"] != "Public attachment task" {
		t.Fatal("public info", info.Code, info.Body)
	}
	contentType, body = multipartBody(map[string]string{"token": linked["token"].(string)}, "phone.txt", []byte("from the phone"))
	if w := send("POST", "/api/crew/upload-link/upload", contentType, body, ""); w.Code != 200 {
		t.Fatal("public upload", w.Code, w.Body)
	}
	// The link token is not a sign-in.
	if w := send("GET", "/api/crew/attachment?id="+id+"&token="+linked["token"].(string), "", nil, ""); w.Code != http.StatusUnauthorized {
		t.Fatal("link token read a file", w.Code)
	}
}
