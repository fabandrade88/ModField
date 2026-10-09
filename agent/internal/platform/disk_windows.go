//go:build windows

package platform

import "golang.org/x/sys/windows"

// FreeBytes is the space available to the user on the volume holding dir.
func FreeBytes(dir string) (uint64, error) {
	p, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		return 0, err
	}
	var free, total, all uint64
	if err := windows.GetDiskFreeSpaceEx(p, &free, &total, &all); err != nil {
		return 0, err
	}
	return free, nil
}
