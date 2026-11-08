// Package client provides Crew administration and authenticated MCP operations.
// It talks to the local server with a
// token obtained through the private local key, or, in remote mode (--url), to
// a forwarded server with a stored session token; never with a stored password.
package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/pocketcontext-labs/pocketcontext-core/appserver"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/buildinfo"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

var idPattern = regexp.MustCompile(`^[a-z0-9]{15}$`)

// Fail is a command failure with the documented exit code:
// 1 HTTP or transport error, 2 usage or configuration, 3 check differences, 4 HTTP 409.
type Fail struct {
	Code    int
	Message string
}

func (f *Fail) Error() string { return f.Message }

func fail(code int, format string, args ...any) error {
	return &Fail{code, fmt.Sprintf(format, args...)}
}

// Client is one authenticated session against a PocketContext server.
type Client struct {
	Base        string // server URL without a trailing slash
	DB          string // local database; empty in remote mode
	token       string
	remote      bool
	http        *http.Client
	LongTimeout time.Duration
}

func newClient(base string) (*Client, error) {
	return &Client{Base: base, http: &http.Client{
		Timeout: 30 * time.Second,
		// A followed redirect could send the token elsewhere.
		CheckRedirect: noRedirect,
	}}, nil
}

// New ensures the server is running and obtains a token for the local account.
func New(p *appserver.Project) (*Client, error) {
	c, err := newClient(p.URL())
	if err != nil {
		return nil, err
	}
	c.DB = p.DB
	if err := appserver.EnsureRunning(p, appserver.StartOptions{}); err != nil {
		return nil, fail(1, "%v", err)
	}
	c.http, err = appserver.LocalHTTPClient(p, 30*time.Second)
	if err != nil {
		return nil, fail(1, "%v", err)
	}
	key, err := appserver.ReadKey(p)
	if err != nil {
		return nil, fail(1, "%v", err)
	}
	status, data, err := c.send("POST", "/api/bundle/token", nil, map[string]string{"X-PocketContext-Local-Key": key}, "", nil)
	if err != nil {
		return nil, err
	}
	if status != 200 {
		return nil, fail(1, "local sign-in failed (HTTP %d): %s", status, message(data))
	}
	token, _ := data.(map[string]any)["token"].(string)
	if token == "" {
		return nil, fail(1, "local sign-in returned no token")
	}
	c.token = token
	return c, nil
}

func message(data any) string {
	if m, ok := data.(map[string]any); ok {
		if s, ok := m["message"].(string); ok {
			return s
		}
	}
	return ""
}

func (c *Client) send(method, path string, body any, headers map[string]string, contentType string, raw []byte) (int, any, error) {
	var reader io.Reader
	if raw != nil {
		reader = bytes.NewReader(raw)
	} else if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		reader = bytes.NewReader(encoded)
		contentType = "application/json"
	}
	req, err := http.NewRequest(method, c.Base+path, reader)
	if err != nil {
		return 0, nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("User-Agent", "PocketContext/"+buildinfo.Version)
	if c.token != "" {
		req.Header.Set("Authorization", c.token)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	client := c.http
	if c.LongTimeout > 0 {
		copy := *c.http
		copy.Timeout = c.LongTimeout
		client = &copy
	}
	resp, err := client.Do(req)
	if err != nil {
		if c.remote {
			return 0, nil, fail(1, "the PocketContext server at %s is not reachable: %v; check the forward to the agent computer", c.Base, err)
		}
		return 0, nil, fail(1, "cannot reach the PocketContext server at %s: %v", c.Base, err)
	}
	defer resp.Body.Close()
	if c.remote && resp.StatusCode == http.StatusUnauthorized {
		return 0, nil, expired(c.Base)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 256<<20))
	if err != nil {
		return 0, nil, fail(1, "reading the response: %v", err)
	}
	var parsed any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&parsed); err != nil {
		parsed = string(data)
	}
	if throttled := responseRateLimit(method, path, resp.StatusCode, parsed, resp.Header); throttled != nil {
		return resp.StatusCode, parsed, throttled
	}
	return resp.StatusCode, parsed, nil
}

// Must sends an authenticated JSON request and turns HTTP errors into failures.
func (c *Client) Must(method, path string, body any) (any, error) {
	status, data, err := c.send(method, path, body, nil, "", nil)
	if err != nil {
		return nil, err
	}
	safeRead := method == "GET" || path == "/api/crew/read" || path == "/api/crew/search" || path == "/api/crew/query"
	for attempt := 0; safeRead && status == 503 && attempt < 3; attempt++ {
		time.Sleep(time.Duration(500*(attempt+1)) * time.Millisecond)
		if status, data, err = c.send(method, path, body, nil, "", nil); err != nil {
			return nil, err
		}
	}
	return checked(method, path, status, data)
}

func checked(method, path string, status int, data any) (any, error) {
	if throttled := responseRateLimit(method, path, status, data, nil); throttled != nil {
		return nil, throttled
	}
	if status < 400 {
		return data, nil
	}
	pretty, _ := json.MarshalIndent(data, "", "  ")
	lines := []string{fmt.Sprintf("HTTP %d from %s %s", status, method, path), string(pretty)}
	conflict := status == 409

	if conflict {
		code, _ := dig(data, "data", "reason", "code").(string)
		if code == "" || code == "revision_conflict" {
			lines = append(lines, "HTTP 409: another request changed the record first. Read it again, confirm the change still applies, then retry.")
		} else {
			lines = append(lines, fmt.Sprintf("HTTP 409: Crew refused this operation (%s). Do not retry it unchanged; follow the message above.", code))
		}
		return nil, &Fail{4, strings.Join(lines, "\n")}
	}
	return nil, &Fail{1, strings.Join(lines, "\n")}
}

func dig(value any, keys ...string) any {
	for _, k := range keys {
		m, ok := value.(map[string]any)
		if !ok {
			return nil
		}
		value = m[k]
	}
	return value
}

func Print(data any, pretty bool) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if pretty {
		encoder.SetIndent("", "  ")
	}
	_ = encoder.Encode(data)
	os.Stdout.Write(buf.Bytes())
}
