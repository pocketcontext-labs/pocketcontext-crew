//go:build !windows

package bundle

import "os"

func syncArchiveDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
func durableArchiveRename(from, to string) error { return os.Rename(from, to) }
