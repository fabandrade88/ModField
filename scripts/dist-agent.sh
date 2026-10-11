#!/bin/sh
# Builds the agent for every target into agent/dist/, with the web UI embedded:
#   agent/dist/modfield-agent_<os>_<arch>[.exe]   plain binaries
#   agent/dist/ModField-Agent-<v>-windows-<arch>-portable.zip
#   agent/dist/checksums.txt                       SHA-256, the format install.sh checks
#   agent/dist/latest/                             the layout install.sh downloads from
# macOS builds here have no tray icon (the tray needs CGO, i.e. a Mac); the
# release workflow builds them on a macOS runner.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${VERSION:-$(sed -n 's/^\s*version\s*= "\(.*\)"/\1/p' "$ROOT/agent/cmd/modfield-agent/main.go")}"
DIST="$ROOT/agent/dist"

echo "== web build and embed"
(cd "$ROOT" && pnpm build >/dev/null)
sh "$ROOT/scripts/embed-ui.sh"

rm -rf "$DIST"
mkdir -p "$DIST/latest"
cd "$ROOT/agent"
for target in linux/amd64 linux/arm64 windows/amd64 windows/arm64 darwin/amd64 darwin/arm64; do
  os=${target%/*}
  arch=${target#*/}
  ext=""
  tags=""
  gui=""
  # Windows: a tray app, not a console program (no black window on double-click).
  [ "$os" = windows ] && ext=".exe" && gui="-H windowsgui"
  [ "$os" = darwin ] && tags="-tags notray"
  out="$DIST/modfield-agent_${os}_${arch}${ext}"
  echo "== $os/$arch"
  # shellcheck disable=SC2086
  GOOS=$os GOARCH=$arch CGO_ENABLED=0 go build -trimpath $tags \
    -ldflags "-s -w $gui -X main.version=$VERSION" -o "$out" ./cmd/modfield-agent
done

echo "== windows portable zips"
sh "$ROOT/scripts/windows-portable.sh" "$DIST" "$VERSION"

echo "== checksums"
(cd "$DIST" && sha256sum modfield-agent_* ModField-Agent-*.zip > checksums.txt)

# What https://modfield.app/downloads/latest/ serves to install.sh.
cp "$DIST"/modfield-agent_linux_* "$DIST/checksums.txt" "$DIST/latest/"
cp "$ROOT/agent/installer/linux/modfield-agent.service" "$ROOT/agent/installer/linux/install.sh" "$DIST/latest/"

# The site serves them at /downloads (the Home screen reads manifest.json).
PUB="$ROOT/apps/web/public/downloads"
rm -rf "$PUB"
mkdir -p "$PUB"
cp -R "$DIST"/. "$PUB"/
node "$ROOT/scripts/gen-download-manifest.mjs" "$PUB" "$VERSION"
echo "published to apps/web/public/downloads (served at /downloads)"

# Signed auto-update manifest (update.json), when the release signing key is set.
# The agent verifies it against the embedded ed25519 keyring (internal/update).
if [ -n "${MODFIELD_UPDATE_KEY:-}" ]; then
  DL_URL="${MODFIELD_DOWNLOADS_URL:-https://modfield.app/downloads/}"
  (cd "$ROOT/agent" && go run ./cmd/gen-manifest -dist "$DIST" -base "$DL_URL" -version "$VERSION" -key-id "${MODFIELD_UPDATE_KEY_ID:-k2}")
  cp "$DIST/update.json" "$PUB/update.json"
  echo "signed update.json written (auto-update manifest, served at ${DL_URL}update.json)"
else
  echo "MODFIELD_UPDATE_KEY not set: skipping update.json (auto-update stays off until published)"
fi

echo
ls -la "$DIST" | awk 'NR>1 {printf "%10s  %s\n", $5, $9}'
