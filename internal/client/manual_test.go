package client

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestManualOfflineDeterministicAndExclusive(t *testing.T) {
	t.Setenv("POCKETCONTEXT_DB", filepath.Join(t.TempDir(), "never", "db"))
	t.Setenv("POCKETCONTEXT_URL", "http://not-allowed.example")
	root := t.TempDir()
	one, two := filepath.Join(root, "one"), filepath.Join(root, "two")
	for _, dir := range []string{one, two} {
		if e := run([]string{"manual", "--out", dir}); e != nil {
			t.Fatal(e)
		}
	}
	for _, file := range append(manualFiles, "manifest.json") {
		a, e := os.ReadFile(filepath.Join(one, file))
		if e != nil {
			t.Fatal(e)
		}
		b, e := os.ReadFile(filepath.Join(two, file))
		if e != nil || !bytes.Equal(a, b) {
			t.Fatalf("non-deterministic %s: %v", file, e)
		}
	}
	if e := run([]string{"manual", "--out", one}); e == nil {
		t.Fatal("overwrote existing manual")
	}
	readme, _ := os.ReadFile(filepath.Join(one, "README.md"))
	if bytes.Contains(readme, []byte("\n## Build\n")) || bytes.Contains(readme, []byte("\n## Layout\n")) {
		t.Fatal("developer section exported")
	}
	var m map[string]any
	b, _ := os.ReadFile(filepath.Join(one, "manifest.json"))
	if json.Unmarshal(b, &m) != nil || m["version"] != manualVersion {
		t.Fatal("invalid manifest")
	}
	// The manual names the current release: its notes, and GitHub links to its tag.
	notes, err := os.ReadFile(filepath.Join(one, "docs", "releases", clientRelease+".md"))
	if err != nil || !bytes.Contains(notes, []byte("# Crew "+clientRelease)) {
		t.Fatalf("manual lacks the %s release notes: %v", clientRelease, err)
	}
	local, _ := os.ReadFile(filepath.Join(one, "docs", "local.md"))
	if !bytes.Contains(local, []byte("pocketcontext-crew/blob/v"+clientRelease+"/docs/webhooks.md")) || bytes.Contains(local, []byte("blob/v0.2.0/")) {
		t.Fatal("manual links do not point at the release tag")
	}
}
