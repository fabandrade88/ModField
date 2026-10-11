// gen-manifest writes a signed update.json from the built agent binaries.
//
//	MODFIELD_UPDATE_KEY=<base64url ed25519 seed> \
//	  go run ./cmd/gen-manifest -dist agent/dist -base https://modfield.app/downloads/ -version 1.2.0
//
// It scans <dist> for modfield-agent_<os>_<arch>[.exe], hashes each, and signs
// the manifest the agent verifies (internal/update.Verify). The private key is
// read from the environment only, never a flag.
package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"modfield.dev/agent/internal/update"
)

var namePat = regexp.MustCompile(`^modfield-agent_(linux|windows|darwin)_(amd64|arm64)(\.exe)?$`)

func main() {
	dist := flag.String("dist", "dist", "directory with the built binaries")
	base := flag.String("base", "https://modfield.app/downloads/", "URL the binaries are served from")
	version := flag.String("version", "", "release version, e.g. 1.2.0 (required)")
	keyID := flag.String("key-id", "k2", "signing key id, must match a keyring entry")
	out := flag.String("out", "", "output path (default <dist>/update.json)")
	flag.Parse()
	if *version == "" {
		fail("-version is required")
	}
	seed := strings.TrimSpace(os.Getenv("MODFIELD_UPDATE_KEY"))
	if seed == "" {
		fail("MODFIELD_UPDATE_KEY (base64url ed25519 seed) is not set")
	}
	raw, err := base64.RawURLEncoding.DecodeString(seed)
	if err != nil || len(raw) != ed25519.SeedSize {
		fail("MODFIELD_UPDATE_KEY is not a valid base64url ed25519 seed")
	}
	key := ed25519.NewKeyFromSeed(raw)

	baseURL := *base
	if !strings.HasSuffix(baseURL, "/") {
		baseURL += "/"
	}
	entries, err := os.ReadDir(*dist)
	if err != nil {
		fail(err.Error())
	}
	assets := map[string]update.Asset{}
	for _, e := range entries {
		m := namePat.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		data, err := os.ReadFile(filepath.Join(*dist, e.Name()))
		if err != nil {
			fail(err.Error())
		}
		sum := sha256.Sum256(data)
		assets[m[1]+"-"+m[2]] = update.Asset{URL: baseURL + e.Name(), SHA256: hex.EncodeToString(sum[:])}
	}
	if len(assets) == 0 {
		fail("no modfield-agent_<os>_<arch> binaries found in " + *dist)
	}
	man, err := update.Sign(update.Payload{Version: *version, Date: time.Now().UTC(), Assets: assets}, *keyID, key)
	if err != nil {
		fail(err.Error())
	}
	buf, _ := json.MarshalIndent(man, "", "  ")
	dest := *out
	if dest == "" {
		dest = filepath.Join(*dist, "update.json")
	}
	if err := os.WriteFile(dest, append(buf, '\n'), 0o644); err != nil {
		fail(err.Error())
	}
	fmt.Printf("wrote %s (%d assets, key %s, v%s)\n", dest, len(assets), *keyID, *version)
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "gen-manifest: "+msg)
	os.Exit(1)
}
