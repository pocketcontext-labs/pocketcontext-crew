package crewruntime

import (
	"io/fs"
	"regexp"
	"strings"
	"testing"

	assets "github.com/pocketcontext-labs/pocketcontext-crew"
)

// Hooks and migrations must not reach the operating system: $os exposes
// process creation ($os.cmd, $os.exec, $os.startProcess), and external tools
// such as sha256sum are missing on stock Windows. File access goes through
// app.newFilesystem(); anything else belongs in registerHookBindings.
func TestHooksStartNoProcesses(t *testing.T) {
	forbidden := regexp.MustCompile(`\$os\b|\bchild_process\b`)
	scanned := 0
	for _, dir := range []string{"pb_hooks", "pb_migrations"} {
		err := fs.WalkDir(assets.Assets, dir, func(name string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(name, ".js") {
				return err
			}
			data, err := assets.Assets.ReadFile(name)
			if err != nil {
				return err
			}
			scanned++
			for i, line := range strings.Split(string(data), "\n") {
				if m := forbidden.FindString(line); m != "" {
					t.Errorf("%s:%d uses %s; hooks must not depend on external tools or OS processes", name, i+1, m)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if scanned == 0 {
		t.Fatal("no embedded hooks or migrations scanned")
	}
}
