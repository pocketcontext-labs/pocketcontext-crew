package client

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/pocketcontext-labs/pocketcontext-core/appidentity"
	"github.com/pocketcontext-labs/pocketcontext-core/appserver"

	assets "github.com/pocketcontext-labs/pocketcontext-crew"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/appconfig"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/crewpolicy"
)

// atlasIdentity is the sibling application's identity, in a separate process.
func atlasIdentity() appidentity.Identity {
	id := crewpolicy.Identity
	id.AppID, id.DisplayName, id.Command = "pocketcontext-atlas", "PocketContext Atlas", "pocketcontext-atlas"
	id.SkillName, id.Marker, id.RouterMarker = "pocketcontext-atlas", ".pocketcontext-atlas", ".pocketcontext-atlas-router"
	id.RegistryNamespace = "pocketcontext-atlas"
	id.DefaultPort = 8096
	return id
}

func atlasRuntime(t testing.TB) *appserver.Runtime {
	rt, err := appserver.New(appserver.Config{Identity: atlasIdentity(), Version: "0.25.0-test", Assets: assets.Assets, Policy: crewpolicy.Policy(), Text: crewpolicy.Text})
	if err != nil {
		t.Fatal(err)
	}
	return rt
}

// TestMain lets this test binary re-exec as a server process.
func TestMain(m *testing.M) {
	if role := os.Getenv("COEXIST_ROLE"); role != "" {
		rt := appconfig.Runtime
		if role == "atlas" {
			var err error
			rt, err = appserver.New(appserver.Config{Identity: atlasIdentity(), Version: "0.25.0-test", Assets: assets.Assets, Policy: crewpolicy.Policy(), Text: crewpolicy.Text})
			if err != nil {
				panic(err)
			}
		}
		p, err := rt.Resolve(os.Getenv("COEXIST_DB"))
		if err != nil {
			panic(err)
		}
		ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer cancel()
		if err := appserver.ServeContext(ctx, p, appserver.ServeOptions{Headless: false, TakeOver: true}); err != nil && ctx.Err() == nil {
			panic(err)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

// Crew and an Atlas-identity process share a computer with separate skills,
// registries and ports; neither accepts the other's server as its own.
func TestCoexistenceWithSiblingIdentity(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses SIGTERM to stop the sibling processes")
	}
	root := t.TempDir()
	home := filepath.Join(root, "home")
	env := append(os.Environ(), "HOME="+home, "XDG_CONFIG_HOME="+filepath.Join(home, ".config"), "XDG_CACHE_HOME="+filepath.Join(home, ".cache"))
	if err := os.MkdirAll(home, 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(home, ".cache"))
	project := func(name string, port int) string {
		dir := filepath.Join(root, name)
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		data, _ := json.Marshal(map[string]any{"port": port, "instance": strings.Repeat(name[:1], 32)})
		if err := os.WriteFile(filepath.Join(dir, "pocketcontext.json"), data, 0600); err != nil {
			t.Fatal(err)
		}
		return filepath.Join(dir, "pocketcontext.db")
	}
	crewPort, atlasPort := freePort(t), freePort(t)
	crewDB, atlasDB := project("crew", crewPort), project("atlas", atlasPort)
	start := func(role, db string) *exec.Cmd {
		cmd := exec.Command(os.Args[0])
		cmd.Env = append(env, "COEXIST_ROLE="+role, "COEXIST_DB="+db)
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = cmd.Process.Signal(syscall.SIGTERM); _ = cmd.Wait() })
		return cmd
	}
	start("crew", crewDB)
	start("atlas", atlasDB)
	crewP, err := appconfig.Runtime.Resolve(crewDB)
	if err != nil {
		t.Fatal(err)
	}
	atlas := atlasRuntime(t)
	atlasP, err := atlas.Resolve(atlasDB)
	if err != nil {
		t.Fatal(err)
	}
	waitHealthy := func(p *appserver.Project, want string) {
		t.Helper()
		var last error
		for deadline := time.Now().Add(45 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
			i, err := appserver.Health(p)
			if err == nil {
				if i.App != want {
					t.Fatalf("Health app = %q, want %q", i.App, want)
				}
				return
			}
			last = err
		}
		t.Fatalf("%s never became healthy: %v", want, last)
	}
	waitHealthy(crewP, "pocketcontext-crew")
	waitHealthy(atlasP, "pocketcontext-atlas")

	// Crew pointed at Atlas's port sees another program, and never adopts it.
	foreign := filepath.Join(root, "foreign")
	if err := os.MkdirAll(foreign, 0700); err != nil {
		t.Fatal(err)
	}
	configForeign, _ := json.Marshal(map[string]any{"port": atlasPort, "instance": strings.Repeat("f", 32)})
	if err := os.WriteFile(filepath.Join(foreign, "pocketcontext.json"), configForeign, 0600); err != nil {
		t.Fatal(err)
	}
	foreignP, err := appconfig.Runtime.Resolve(filepath.Join(foreign, "pocketcontext.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := appserver.Health(foreignP); err == nil || !strings.Contains(err.Error(), "another program") {
		t.Fatalf("Atlas's port accepted as Crew: %v", err)
	}

	// Skill directories, markers and registries are the application's own.
	targets := skillTargets(home)
	if !strings.HasSuffix(targets["claude-code"][1], filepath.Join("skills", "pocketcontext-crew")) || marker != ".pocketcontext-crew" {
		t.Fatalf("Crew skill %v, marker %s", targets["claude-code"], marker)
	}
	crewRegistry, err := appconfig.Profiles.Path()
	if err != nil {
		t.Fatal(err)
	}
	atlasRegistry, err := atlas.Profiles().Path()
	if err != nil {
		t.Fatal(err)
	}
	if crewRegistry == atlasRegistry || filepath.Base(filepath.Dir(crewRegistry)) != "pocketcontext-crew" {
		t.Fatalf("registries collide: %s, %s", crewRegistry, atlasRegistry)
	}

	// An earlier shared skill directory and registry are left alone.
	legacySkill := filepath.Join(home, ".claude", "skills", "pocketcontext")
	if err := os.MkdirAll(legacySkill, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacySkill, "SKILL.md"), []byte("synthetic earlier skill\n"), 0600); err != nil {
		t.Fatal(err)
	}
	legacyRegistry := filepath.Join(home, ".config", "pocketcontext", "profiles.json")
	if err := os.MkdirAll(filepath.Dir(legacyRegistry), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyRegistry, []byte(`{"format":1,"profiles":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(home, ".claude"), 0700); err != nil {
		t.Fatal(err)
	}
	dir := targets["claude-code"][1]
	if err := writeRouter(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(legacySkill, ".pocketcontext-crew")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("legacy skill directory was written: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(legacySkill, "SKILL.md")); err != nil || string(data) != "synthetic earlier skill\n" {
		t.Fatalf("legacy skill changed: %q %v", data, err)
	}

}
