//go:build !unix

package agent

// deviceGroup has no meaning outside Unix.
func deviceGroup(string) string { return "" }
