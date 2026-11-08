package client

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/pocketcontext-labs/pocketcontext-core/appserver"
	"github.com/pocketcontext-labs/pocketcontext-core/atomicfile"
	"github.com/pocketcontext-labs/pocketcontext-core/sqliteuri"

	"github.com/pocketcontext-labs/pocketcontext-crew/internal/appconfig"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/buildinfo"
)

type upgradeCheckResult struct {
	ID     string `json:"id"`
	Status string `json:"status"` // pass, warn or block
	Detail string `json:"detail"`
}

// exitUpgradeBlocked is returned when a block check fails. 2 is usage and 1 is a
// failure of the check itself, as documented in the runbook.
const exitUpgradeBlocked = 3

var hexInstance = regexp.MustCompile(`^[0-9a-f]{32}$`)

// runUpgradeCheck is a local, offline, read-only diagnostic. It never starts a
// server, never opens the synced database, takes no lock and changes no file.
func runUpgradeCheck(p *appserver.Project, a *args, pretty bool) error {
	checks := []upgradeCheckResult{}
	serverRunning := false
	add := func(id, status, format string, args ...any) {
		detail := fmt.Sprintf(format, args...)
		// A running server legitimately holds the lease and working copy; only
		// the inventory step expects it, so it is the only step that relaxes.
		if inventory := a.bools["inventory"]; inventory && serverRunning && status == "block" && (id == "lease" || id == "workingCopy") {
			status = "warn"
			detail += " (expected while the server runs)"
		}
		checks = append(checks, upgradeCheckResult{id, status, detail})
	}
	from := a.flags["from"]
	// Project files: the database must exist and be a regular file.
	info, statErr := os.Stat(p.DB)
	config, configErr := os.ReadFile(p.ConfigPath)
	switch {
	case statErr != nil || !info.Mode().IsRegular():
		add("project.files", "block", "no readable database file at %s", p.DB)
	case configErr != nil:
		add("project.files", "block", "cannot read %s: %v", p.ConfigPath, configErr)
	case !json.Valid(config):
		add("project.files", "block", "%s is not valid JSON", p.ConfigPath)
	default:
		add("project.files", "pass", "database and configuration are readable")
	}
	if hexInstance.MatchString(p.Config.Instance) {
		add("project.instance", "pass", "instance %s", p.Config.Instance)
	} else {
		add("project.instance", "block", "%s has no valid project identity (instance %q)", p.ConfigPath, p.Config.Instance)
	}
	// Running server: a mismatched server on this port must be reported, not adopted.
	running, runErr := appserver.Running(p)
	serverRunning = running && runErr == nil
	switch {
	case runErr != nil:
		add("server.stopped", "block", "%v", runErr)
	case running:
		version := ""
		if i, err := appserver.Health(p); err == nil {
			version = i.Version
		}
		status := "block"
		if a.bools["inventory"] {
			status = "warn"
		}
		add("server.stopped", status, "a server for this project is running (version %q); stop it with its own binary, then re-check", version)
	default:
		add("server.stopped", "pass", "no server answers for this project")
	}
	// Lease: nothing is claimed here. A fresh lease means a writer is active.
	lease, leaseErr := appserver.ReadLease(p)
	switch {
	case leaseErr != nil:
		add("lease", "block", "cannot read %s: %v", p.LeaseFile(), leaseErr)
	case lease == nil:
		add("lease", "pass", "no lease")
	case time.Since(lease.Heartbeat) >= appserver.LeaseTimeout:
		add("lease", "pass", "stale lease from %s", lease.Host)
	default:
		add("lease", "block", "a writer on %s heartbeat %s ago; stop it there and wait for the lease to expire", lease.Host, time.Since(lease.Heartbeat).Round(time.Second))
	}
	checkWorkingCopy(p, add)
	if conflicts := appserver.Conflicts(p); len(conflicts) > 0 {
		add("conflicts", "warn", "conflict copies need an explicit decision with recover: %s", strings.Join(conflicts, ", "))
	} else {
		add("conflicts", "pass", "no conflict copies")
	}
	checkDatabaseFormat(p, add)
	checkOldExecutable(p, from, add)
	registry(add)
	skill(p, add)
	add("sync", "warn", "confirm the sync client is idle for this folder before continuing; this cannot be proven")
	ready := true
	for _, c := range checks {
		if c.Status == "block" {
			ready = false
		}
	}
	if pretty {
		for _, c := range checks {
			fmt.Printf("%-18s %-5s %s\n", c.ID, c.Status, c.Detail)
		}
		fmt.Println("ready:", ready)
	} else {
		Print(map[string]any{"ok": true, "ready": ready, "binary": appconfig.Identity.Command, "version": buildinfo.Version, "checks": checks}, false)
	}
	if !ready {
		return fail(exitUpgradeBlocked, "upgrade check found blocking items")
	}
	return nil
}

// checkWorkingCopy compares the synced file with the cached base, reading only
// the state file and the database bytes.
func checkWorkingCopy(p *appserver.Project, add func(string, string, string, ...any)) {
	const id = "workingCopy"
	data, err := os.ReadFile(filepath.Join(p.LiveDir(), "state.json"))
	if errors.Is(err, os.ErrNotExist) {
		add(id, "pass", "no working copy state")
		return
	}
	if err != nil {
		add(id, "block", "cannot read working copy state: %v", err)
		return
	}
	var state struct {
		Dirty bool `json:"dirty"`
		Base  *struct {
			SHA256 string `json:"sha256"`
		} `json:"base"`
	}
	if err := json.Unmarshal(data, &state); err != nil {
		add(id, "block", "damaged working copy state: %v", err)
		return
	}
	if state.Dirty {
		add(id, "block", "the working copy has unsaved changes; start this project once with the binary that wrote them, stop it, and re-check, or follow recover")
		return
	}
	if state.Base == nil {
		add(id, "pass", "no synced base recorded")
		return
	}
	sum, err := atomicfile.FileSHA256(p.DB)
	if err != nil {
		add(id, "block", "cannot hash the database: %v", err)
		return
	}
	if sum != state.Base.SHA256 {
		add(id, "block", "the synced database differs from the last write-back on this computer; wait for sync, or follow recover")
		return
	}
	add(id, "pass", "working copy is clean and matches the synced database")
}

// checkDatabaseFormat reads a private copy, so the synced database is never opened.
func checkDatabaseFormat(p *appserver.Project, add func(string, string, string, ...any)) {
	const id = "database.format"
	dir, err := os.MkdirTemp("", "crew-upgrade-check-")
	if err != nil {
		add(id, "block", "cannot create a private copy: %v", err)
		return
	}
	defer os.RemoveAll(dir)
	if err := os.Chmod(dir, 0700); err != nil {
		add(id, "block", "cannot secure a private copy: %v", err)
		return
	}
	copied := filepath.Join(dir, "copy.db")
	if err := atomicfile.CopyFile(p.DB, copied); err != nil {
		add(id, "block", "cannot copy the database: %v", err)
		return
	}
	if err := appconfig.Runtime.CheckDatabase(copied, p.DB); err != nil {
		add(id, "block", "%v", err)
		return
	}
	count, err := migrationCount(copied)
	if err != nil {
		add(id, "block", "cannot read the migration ledger: %v", err)
		return
	}
	add(id, "pass", "%d applied migrations are known to this release", count)
}

func migrationCount(path string) (int, error) {
	u := sqliteuri.File(path)
	conn, err := sql.Open("sqlite3", u.String())
	if err != nil {
		return 0, err
	}
	defer conn.Close()
	var count int
	err = conn.QueryRow("SELECT count(*) FROM _migrations").Scan(&count)
	return count, err
}

func checkOldExecutable(p *appserver.Project, from string, add func(string, string, string, ...any)) {
	const id = "oldExecutable"
	candidates := []string{"pocketcontext-crew", "pocketcontext-crew.exe", "pocketcontext", "pocketcontext.exe"}
	for _, name := range candidates {
		path := filepath.Join(p.Dir, name)
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		version, err := binaryVersion(path)
		if err != nil {
			add(id, "warn", "%s: %v", path, err)
			return
		}
		if from != "" && version != from {
			add(id, "warn", "%s reports %s, expected %s", path, version, from)
			return
		}
		add(id, "pass", "%s reports %s", path, version)
		return
	}
	add(id, "warn", "no executable beside the database (a staged path is fine)")
}

func registry(add func(string, string, string, ...any)) {
	const id = "registry.current"
	path, err := appconfig.Profiles.Path()
	if err != nil {
		add(id, "warn", "cannot locate the registry: %v", err)
		return
	}
	r, err := appconfig.Profiles.Read()
	if err != nil {
		add(id, "warn", "%s: %v", path, err)
		return
	}
	add(id, "pass", "%d profiles in %s", len(r.Profiles), path)
	legacy := filepath.Join(filepath.Dir(filepath.Dir(path)), "pocketcontext", "profiles.json")
	if data, err := os.ReadFile(legacy); err == nil {
		add("registry.legacy", "warn", "the earlier shared registry remains at %s (%d bytes); it is left untouched for rollback and the other product", legacy, len(data))
	}
}

func skill(p *appserver.Project, add func(string, string, string, ...any)) {
	r, err := appconfig.Profiles.Read()
	if err != nil {
		add("skill", "warn", "%v", err)
		return
	}
	for _, e := range r.Profiles {
		if e.Instance == p.Config.Instance && e.Skill != "" {
			if _, err := os.Stat(e.Skill); err == nil {
				add("skill", "pass", "%s", e.Skill)
			} else {
				add("skill", "warn", "%s is missing; run skill", e.Skill)
			}
			return
		}
	}
	add("skill", "warn", "this project has no current skill; run skill after upgrading")
}
