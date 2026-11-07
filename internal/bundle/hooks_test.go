package bundle

import (
	"bytes"
	"io"
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

// patternReader yields byte i%251 at offset i, n bytes in total.
type patternReader struct{ off, n int }

func (r *patternReader) Read(p []byte) (int, error) {
	if r.off >= r.n {
		return 0, io.EOF
	}
	k := min(len(p), r.n-r.off)
	for i := range k {
		p[i] = byte((r.off + i) % 251)
	}
	r.off += k
	return k, nil
}

// syntheticNote has a BOM, CRLF line endings and multi-byte UTF-8.
const syntheticNote = "\ufeff---\r\ntitle: Synthetic note\r\n---\r\n# Café — budget\r\n\r\nLine with tab\there and emoji 📝.\n"

// Digests below were produced by the previous implementation (sha256sum over
// the original's bytes), so hashes stored in existing databases keep verifying.
func TestReaderSHA256MatchesPreviousDigests(t *testing.T) {
	for _, c := range []struct {
		name string
		r    io.Reader
		want string
	}{
		{"empty", strings.NewReader(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},
		{"note", strings.NewReader(syntheticNote), "f07b4bcb6d3e4ef1378a96d7975e0b6174d31780dd5435ac8be90493744d18f4"},
		{"invalid-utf8", bytes.NewReader([]byte{0xff, 0xfe, 0x00, 0x80}), "5a741968f40e57485ed6e1a1af381adeb2714223c35acedf1ad0670e42df2eb5"},
		// Beyond the 16 MiB that PocketBase's toString(reader) reads: the whole stream is hashed.
		{"34MiB", &patternReader{n: 34 << 20}, "5dd363e09b6e26690d147aeef0a2c22539a1a51a79a43e1ed125bba927450b49"},
	} {
		got, err := readerSHA256(c.r)
		if err != nil || got != c.want {
			t.Errorf("%s: %q, %v; want %s", c.name, got, err, c.want)
		}
	}
}
