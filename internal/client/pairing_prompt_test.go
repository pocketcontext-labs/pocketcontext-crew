package client

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The pinned client release drifts silently when a release bumps only the
// reader package and workflow default; generated invitations would then send
// clients to a release that does not exist.
func TestClientReleaseMatchesRepositoryVersion(t *testing.T) {
	root := filepath.Join("..", "..")
	raw, err := os.ReadFile(filepath.Join(root, "ui", "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	var pkg struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		t.Fatal(err)
	}
	if pkg.Version != clientRelease {
		t.Fatalf("client setup prompt pins %s but ui/package.json is %s", clientRelease, pkg.Version)
	}
	workflow, err := os.ReadFile(filepath.Join(root, ".github", "workflows", "release.yml"))
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(`(?m)^\s+default: '([0-9]+\.[0-9]+\.[0-9]+)'`).FindSubmatch(workflow)
	if match == nil || string(match[1]) != clientRelease {
		t.Fatalf("client setup prompt pins %s but the release workflow default is %q", clientRelease, match)
	}
}

func TestClientSetupPromptLinksPinnedCrewRelease(t *testing.T) {
	prompt := clientSetupPrompt([]byte(`{}`))
	if !strings.Contains(prompt, "Use PocketContext Crew "+clientRelease+" from ") || !strings.Contains(prompt, "Reuse "+clientRelease+";") {
		t.Fatal("prompt does not name the pinned Crew release")
	}
	if !strings.Contains(prompt, "set CREW_INSTALL_DIR to") || strings.Contains(prompt, "POCKETCONTEXT_INSTALL_DIR") {
		t.Fatal("prompt does not name the Crew Windows installer variable")
	}
	base := "https://github.com/pocketcontext-labs/pocketcontext-crew/"
	want := map[string]bool{
		base + "releases/tag/v" + clientRelease:                       false,
		base + "blob/v" + clientRelease + "/README.md":                false,
		base + "releases/download/v" + clientRelease + "/install.sh":  false,
		base + "releases/download/v" + clientRelease + "/install.ps1": false,
	}
	for _, link := range regexp.MustCompile(`https?://[^\s)]+`).FindAllString(prompt, -1) {
		link = strings.TrimRight(link, ".,")
		if _, ok := want[link]; !ok {
			t.Fatalf("unexpected link in client setup prompt: %s", link)
		}
		want[link] = true
	}
	for link, seen := range want {
		if !seen {
			t.Fatalf("client setup prompt lacks %s", link)
		}
	}
}
