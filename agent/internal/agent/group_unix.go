//go:build unix

package agent

import (
	"fmt"
	"os"
	"os/user"
	"syscall"
)

// deviceGroup is the group that owns a device file (dialout on Debian, uucp on Arch).
func deviceGroup(name string) string {
	st, err := os.Stat(name)
	if err != nil {
		return ""
	}
	sys, ok := st.Sys().(*syscall.Stat_t)
	if !ok {
		return ""
	}
	g, err := user.LookupGroupId(fmt.Sprint(sys.Gid))
	if err != nil {
		return ""
	}
	return g.Name
}
