package crewruntime

import (
	"strings"
	"testing"
	"time"

	"github.com/pocketcontext-labs/pocketcontext-crew/internal/crewpolicy"
)

func TestArtifactMarkdownKeepsOnlyPublishedImagesAndExternalLinks(t *testing.T) {
	token := strings.Repeat("A", 32)
	source := strings.Join([]string{
		"# Plan",
		"![chart](attachment:aaaaaaaaaaaaaaa) ![other](attachment:bbbbbbbbbbbbbbb) ![remote](https://tracker.example/p.png)",
		"[task](#/tasks/x) [home](https://crew.example.com/#/notes/y) [port](https://crew.example.com:443/z) [docs](https://example.com/d)",
		"[js](javascript:alert(1)) [mail](mailto:a@example.com) <https://crew.example.com/a> https://example.org/x",
		"<img src=x onerror=alert(1)> <script>alert(1)</script>",
		"| a | b |\n|---|---|\n| 1 | 2 |",
	}, "\n\n")
	out := string(renderArtifactMarkdown(source, token, []string{"aaaaaaaaaaaaaaa"}, map[string]bool{"crew.example.com": true}))
	for _, want := range []string{
		`<img src="/a/` + token + `/files/1" alt="chart">`,
		`<a href="https://example.com/d" rel="nofollow noopener noreferrer">docs</a>`,
		`<a href="mailto:a@example.com" rel="nofollow noopener noreferrer">mail</a>`,
		`<a href="https://example.org/x" rel="nofollow noopener noreferrer">`,
		"<table>", "<h1>Plan</h1>",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in\n%s", want, out)
		}
	}
	for _, refused := range []string{"bbbbbbbbbbbbbbb", "tracker.example", "#/tasks", `href="https://crew.example.com`, "javascript:", "<script", "onerror", "<img src=x"} {
		if strings.Contains(out, refused) {
			t.Errorf("rendered %q in\n%s", refused, out)
		}
	}
	// Unwrapped links and images keep their text.
	for _, text := range []string{"other", "remote", "task", "home", "port", "js"} {
		if !strings.Contains(out, text) {
			t.Errorf("lost text %q in\n%s", text, out)
		}
	}
}

func TestArtifactPageHeadAndStyleHash(t *testing.T) {
	page := string(renderArtifactPage(`Q3 <plan> & "notes"`, "Body", "2026-11-12T10:00:00Z", strings.Repeat("b", 32), nil, nil))
	if !strings.Contains(page, `<title>Q3 &lt;plan&gt; &amp; &#34;notes&#34;</title>`) || !strings.Contains(page, `content="noindex, nofollow, noarchive"`) ||
		!strings.Contains(page, "Published 12 November 2026") || strings.Contains(page, "<script") {
		t.Fatal(page)
	}
	if !strings.Contains(artifactCSP, "style-src 'sha256-") || strings.Contains(artifactCSP, "unsafe") || strings.Contains(artifactCSP, "script-src") {
		t.Fatal(artifactCSP)
	}
}

func TestArtifactGuardSeparatesUnknownTokensFromLinks(t *testing.T) {
	g := newArtifactGuard()
	now := time.Unix(1_800_000_000, 0)
	g.now = func() time.Time { return now }
	for i := 0; i < artifactBadBurst; i++ {
		if g.allow("") != 0 {
			t.Fatal("bad bucket exhausted early", i)
		}
	}
	if g.allow("") == 0 {
		t.Fatal("unknown tokens not limited")
	}
	if g.allow("artifact1") != 0 {
		t.Fatal("a real link spent the unknown-token allowance")
	}
	now = now.Add(artifactBadRefill)
	if g.allow("") != 0 {
		t.Fatal("bad bucket did not refill")
	}
}

func TestArtifactPathsAndTokenPattern(t *testing.T) {
	token := "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z"
	if !artifactTokenPattern.MatchString(token) || artifactTokenPattern.MatchString(token[:31]) || artifactTokenPattern.MatchString(token+"-") {
		t.Fatal("token pattern")
	}
	for p, want := range map[string]bool{
		"/a/" + token: true, "/a/" + token + "/files/12": true, "/a/": false, "/a/x/files/": false,
		"/a/" + token + "/files/1/x": false, "/a/../api": false, "/a/" + token + "/": false,
	} {
		if crewpolicy.ArtifactPath(p) != want {
			t.Errorf("%s: %v", p, !want)
		}
	}
}

func TestArtifactExpiryFailsClosed(t *testing.T) {
	now := time.Date(2026, 11, 12, 12, 0, 0, 0, time.UTC)
	for value, want := range map[string]bool{
		"":                         false,
		"2026-11-12T12:00:00.001Z": false,
		"2026-11-12T12:00:00.000Z": true,
		"2026-11-11T00:00:00Z":     true,
		"tomorrow":                 true,
	} {
		if got := artifactExpired(value, now); got != want {
			t.Errorf("artifactExpired(%q) = %v, want %v", value, got, want)
		}
	}
}
