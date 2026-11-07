//go:build windows

package bundle

import "golang.org/x/sys/windows"

// Windows has no portable directory fsync. Each archive file is flushed before
// publication, and write-through moves provide the metadata durability barrier.
func syncArchiveDirectory(string) error { return nil }
func durableArchiveRename(from, to string) error {
	src, err := windows.UTF16PtrFromString(from)
	if err != nil {
		return err
	}
	dst, err := windows.UTF16PtrFromString(to)
	if err != nil {
		return err
	}
	return windows.MoveFileEx(src, dst, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}
