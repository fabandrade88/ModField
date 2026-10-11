#!/bin/sh
# ModField agent installer for Linux, without sudo:
#   curl -fsSL https://modfield.app/downloads/latest/install.sh | sh
# Installs to ~/.local/bin, verifies SHA-256 and the minisign signature
# (when minisign is available), and enables a systemd --user unit.
set -eu

BASE="${MODFIELD_BASE:-https://modfield.app/downloads}"
# Public minisign key of the release process (safe to publish). Override to rotate.
MINISIGN_KEY="${MODFIELD_MINISIGN_KEY:-RWTAAaRpSIOVUS9BNohClcjIxnJn7d2grA8fQ9tzQG/vmov7er4dxE2a}"

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FILE="modfield-agent_linux_${ARCH}"
echo "Downloading $FILE..."
curl -fsSL "$BASE/latest/$FILE" -o "$TMP/modfield-agent"
curl -fsSL "$BASE/latest/checksums.txt" -o "$TMP/checksums.txt"
(cd "$TMP" && grep " $FILE\$" checksums.txt | sed "s| $FILE\$| modfield-agent|" | sha256sum -c -)

if [ -n "$MINISIGN_KEY" ]; then
  if command -v minisign >/dev/null 2>&1; then
    curl -fsSL "$BASE/latest/checksums.txt.minisig" -o "$TMP/checksums.txt.minisig"
    minisign -Vm "$TMP/checksums.txt" -P "$MINISIGN_KEY"
  else
    echo "minisign not found: only the SHA-256 was checked." >&2
  fi
fi

mkdir -p "$HOME/.local/bin"
install -m 755 "$TMP/modfield-agent" "$HOME/.local/bin/modfield-agent"

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  curl -fsSL "$BASE/latest/modfield-agent.service" -o "$HOME/.config/systemd/user/modfield-agent.service"
  systemctl --user daemon-reload
  systemctl --user enable --now modfield-agent
  echo "Agent installed and running (systemctl --user status modfield-agent)."
else
  echo "Agent installed in ~/.local/bin. Start it with: modfield-agent"
fi

# Serial ports need the user in the group that owns them (one sudo, once).
for dev in /dev/ttyUSB0 /dev/ttyACM0; do
  [ -e "$dev" ] || continue
  GROUP="$(stat -c %G "$dev")"
  if ! id -nG | tr ' ' '\n' | grep -qx "$GROUP"; then
    echo
    echo "To use $dev, add yourself to the $GROUP group once, then log in again:"
    echo "  sudo usermod -aG $GROUP \$USER"
  fi
  break
done
