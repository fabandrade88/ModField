// Package web embeds the static site build (apps/web/out), copied here by
// scripts/embed-ui.sh before a release build.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// UI returns the embedded build, or nil when only the placeholder is present.
func UI() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return nil
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil
	}
	return sub
}
