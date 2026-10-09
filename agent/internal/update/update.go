// Package update is the agent's self-update: a signed manifest, checked once
// a day, a downloaded binary verified by SHA-256 and swapped in on the next
// start. The previous binary is kept for rollback.
//
// Manifest: {"payload": base64url(JSON Payload), "signature": base64url, "keyId": "k1"}.
// The signature covers the raw payload bytes, so nothing depends on JSON
// canonicalization.
package update

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Set by the release build.
var (
	// ManifestURL is where the signed manifest lives.
	ManifestURL = "https://modfield.app/agent/manifest.json"
	// Keyring is "id:base64url-pubkey,id:base64url-pubkey": the current key and the next one.
	Keyring = ""
)

// Asset is one binary of a release.
type Asset struct {
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
}

// Payload is the signed content.
type Payload struct {
	Version string           `json:"version"`
	Date    time.Time        `json:"date"`
	Assets  map[string]Asset `json:"assets"` // "linux-amd64", "windows-arm64", ...
	// RetireKeys lists key ids no longer accepted once this manifest is (key rotation).
	RetireKeys []string `json:"retireKeys,omitempty"`
}

// Manifest is the file on the server.
type Manifest struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
	KeyID     string `json:"keyId"`
}

// State persists what the agent has accepted, against rollback attacks.
type State struct {
	LastDate    time.Time `json:"lastDate"`
	RetiredKeys []string  `json:"retiredKeys,omitempty"`
}

var b64 = base64.RawURLEncoding

// ParseKeyring parses Keyring.
func ParseKeyring(s string) (map[string]ed25519.PublicKey, error) {
	out := map[string]ed25519.PublicKey{}
	for _, part := range strings.Split(s, ",") {
		if part = strings.TrimSpace(part); part == "" {
			continue
		}
		id, key, ok := strings.Cut(part, ":")
		raw, err := b64.DecodeString(key)
		if !ok || err != nil || len(raw) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("bad keyring entry %q", part)
		}
		out[id] = raw
	}
	return out, nil
}

// Errors returned by Verify.
var (
	ErrSignature = errors.New("manifest signature invalid")
	ErrRetired   = errors.New("manifest signed with a retired key")
	ErrOld       = errors.New("manifest is older than one already accepted")
	ErrNotNewer  = errors.New("manifest version is not newer than the running one")
)

// Verify checks signature, key, freshness and version, and returns the payload.
func Verify(m Manifest, keys map[string]ed25519.PublicKey, st State, current string) (*Payload, error) {
	key, ok := keys[m.KeyID]
	if !ok {
		return nil, ErrSignature
	}
	for _, r := range st.RetiredKeys {
		if r == m.KeyID {
			return nil, ErrRetired
		}
	}
	raw, err1 := b64.DecodeString(m.Payload)
	sig, err2 := b64.DecodeString(m.Signature)
	if err1 != nil || err2 != nil || !ed25519.Verify(key, raw, sig) {
		return nil, ErrSignature
	}
	var p Payload
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fmt.Errorf("payload: %w", err)
	}
	if p.Date.Before(st.LastDate) {
		return nil, ErrOld
	}
	if Compare(p.Version, current) <= 0 {
		return &p, ErrNotNewer
	}
	return &p, nil
}

// Compare compares "1.2.3" style versions; a pre-release sorts before its release.
func Compare(a, b string) int {
	split := func(v string) ([3]int, string) {
		v = strings.TrimPrefix(v, "v")
		core, pre, _ := strings.Cut(v, "-")
		var n [3]int
		for i, part := range strings.SplitN(core, ".", 3) {
			n[i], _ = strconv.Atoi(part)
		}
		return n, pre
	}
	na, pa := split(a)
	nb, pb := split(b)
	for i := range na {
		if na[i] != nb[i] {
			if na[i] < nb[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case pa == pb:
		return 0
	case pa == "":
		return 1
	case pb == "":
		return -1
	case pa < pb:
		return -1
	}
	return 1
}

// Config is what the loop needs.
type Config struct {
	Current string
	DataDir string
	Log     *slog.Logger
	Client  *http.Client
}

func dir(dataDir string) string { return filepath.Join(dataDir, "update") }

// Enabled reads the tray setting (default on).
func Enabled(dataDir string) bool {
	raw, err := os.ReadFile(filepath.Join(dataDir, "config.json"))
	if err != nil {
		return true
	}
	var c struct {
		AutoUpdate *bool `json:"autoUpdate"`
	}
	if json.Unmarshal(raw, &c) != nil || c.AutoUpdate == nil {
		return true
	}
	return *c.AutoUpdate
}

// SetEnabled saves the tray setting.
func SetEnabled(dataDir string, on bool) error {
	raw, _ := json.Marshal(map[string]bool{"autoUpdate": on})
	return os.WriteFile(filepath.Join(dataDir, "config.json"), raw, 0o600)
}

// Loop checks now and every 24 h until ctx ends.
func Loop(ctx context.Context, c Config) {
	if Keyring == "" {
		c.Log.Info("update keys not set in this build; automatic updates are off")
		return
	}
	for {
		if Enabled(c.DataDir) {
			if v, err := Check(ctx, c); err != nil && !errors.Is(err, ErrNotNewer) {
				c.Log.Warn("update check failed", "err", err)
			} else if v != "" {
				c.Log.Info("update downloaded; it applies on the next start", "version", v)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(24 * time.Hour):
		}
	}
}

func loadState(dataDir string) State {
	var st State
	raw, err := os.ReadFile(filepath.Join(dir(dataDir), "state.json"))
	if err == nil {
		_ = json.Unmarshal(raw, &st)
	}
	return st
}

// Check fetches and verifies the manifest and stages a newer binary. It returns the staged version.
func Check(ctx context.Context, c Config) (string, error) {
	keys, err := ParseKeyring(Keyring)
	if err != nil {
		return "", err
	}
	client := c.Client
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	body, err := get(ctx, client, ManifestURL, 1<<20)
	if err != nil {
		return "", err
	}
	var m Manifest
	if err := json.Unmarshal(body, &m); err != nil {
		return "", fmt.Errorf("manifest: %w", err)
	}
	st := loadState(c.DataDir)
	p, err := Verify(m, keys, st, c.Current)
	if err != nil {
		return "", err
	}
	asset, ok := p.Assets[runtime.GOOS+"-"+runtime.GOARCH]
	if !ok {
		return "", fmt.Errorf("no build for %s-%s in %s", runtime.GOOS, runtime.GOARCH, p.Version)
	}
	bin, err := get(ctx, client, asset.URL, 200<<20)
	if err != nil {
		return "", err
	}
	if sum := sha256.Sum256(bin); hex.EncodeToString(sum[:]) != strings.ToLower(asset.SHA256) {
		return "", errors.New("downloaded binary does not match the signed SHA-256")
	}
	if err := Stage(c.DataDir, p.Version, bin); err != nil {
		return "", err
	}
	st.LastDate = p.Date
	st.RetiredKeys = append(st.RetiredKeys, p.RetireKeys...)
	raw, _ := json.Marshal(st)
	_ = os.WriteFile(filepath.Join(dir(c.DataDir), "state.json"), raw, 0o600)
	return p.Version, nil
}

func get(ctx context.Context, client *http.Client, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: %s", url, res.Status)
	}
	return io.ReadAll(io.LimitReader(res.Body, limit))
}

// Stage writes a verified binary for ApplyPending.
func Stage(dataDir, version string, bin []byte) error {
	d := dir(dataDir)
	if err := os.MkdirAll(d, 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(d, "pending.bin"), bin, 0o700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(d, "pending.version"), []byte(version), 0o600)
}

// ApplyPending swaps a staged binary in before the agent starts serving and
// restarts into it. The running binary is kept as <exe>.old.
func ApplyPending(dataDir string, log *slog.Logger) error {
	pending := filepath.Join(dir(dataDir), "pending.bin")
	if _, err := os.Stat(pending); err != nil {
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if exe, err = filepath.EvalSymlinks(exe); err != nil {
		return err
	}
	bin, err := os.ReadFile(pending)
	if err != nil {
		return err
	}
	// Renaming a running executable is allowed on Windows too; overwriting it is not.
	old := exe + ".old"
	_ = os.Remove(old)
	if err := os.Rename(exe, old); err != nil {
		return err
	}
	if err := os.WriteFile(exe, bin, 0o755); err != nil {
		_ = os.Rename(old, exe)
		return err
	}
	_ = os.Remove(pending)
	v, _ := os.ReadFile(filepath.Join(dir(dataDir), "pending.version"))
	log.Info("update applied; restarting", "version", string(v))
	return restart(exe)
}

// Rollback restores <exe>.old.
func Rollback() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	old := exe + ".old"
	if _, err := os.Stat(old); err != nil {
		return errors.New("no previous version to roll back to")
	}
	_ = os.Remove(exe + ".bad")
	if err := os.Rename(exe, exe+".bad"); err != nil {
		return err
	}
	return os.Rename(old, exe)
}
