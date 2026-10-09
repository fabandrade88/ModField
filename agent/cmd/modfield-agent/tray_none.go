//go:build notray

package main

import (
	"context"

	"modfield.dev/agent/internal/agent"
)

// runTray in builds without a tray (cross-compiled macOS without CGO): headless.
func runTray(ctx context.Context, _ *agent.Agent, _ int, _ string, quit func()) {
	<-ctx.Done()
	quit()
}
