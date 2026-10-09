// Package platform holds per-OS paths and helpers. Everything lives in the
// user's own directories: nothing needs administrator rights.
package platform

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// DataDir is %LOCALAPPDATA%\ModField, ~/Library/Application Support/ModField or ~/.local/share/modfield.
func DataDir() string {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		if d := os.Getenv("LOCALAPPDATA"); d != "" {
			return filepath.Join(d, "ModField")
		}
		return filepath.Join(home, "AppData", "Local", "ModField")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "ModField")
	default:
		if d := os.Getenv("XDG_DATA_HOME"); d != "" {
			return filepath.Join(d, "modfield")
		}
		return filepath.Join(home, ".local", "share", "modfield")
	}
}

// OpenURL opens a page in the default browser without waiting for it.
func OpenURL(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
	go func() { _ = cmd.Wait() }()
}
