//go:build unix

package update

import (
	"os"
	"syscall"
)

func restart(exe string) error { return syscall.Exec(exe, os.Args, os.Environ()) }
