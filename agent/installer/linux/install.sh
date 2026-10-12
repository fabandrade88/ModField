#!/bin/sh
# ModField agent installer for Linux and macOS, without sudo or administrator:
#   curl -fsSL https://modfield.app/downloads/latest/install.sh | sh
# Installs to ~/.local/bin, verifies SHA-256 and the minisign signature (when
# minisign is available), and sets it to start at login — a systemd --user unit
# on Linux, a per-user LaunchAgent on macOS. curl-downloaded files carry no
# macOS quarantine flag, so Gatekeeper does not block the agent.
set -eu

BASE="${MODFIELD_BASE:-https://modfield.app/downloads}"
# Public minisign key of the release process (safe to publish). Override to rotate.
MINISIGN_KEY="${MODFIELD_MINISIGN_KEY:-RWSkUdVjB3+FPtH+5FU/V56IYePxZvH2q3N651z47sTcFvWRoMl2O90B}"

case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  *) echo "Unsupported system: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

# The SHA-256 checker differs: coreutils on Linux, shasum on macOS.
if command -v sha256sum >/dev/null 2>&1; then
  sha256_check() { sha256sum -c -; }
else
  sha256_check() { shasum -a 256 -c -; }
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FILE="modfield-agent_${OS}_${ARCH}"
echo "Downloading $FILE..."
curl -fsSL "$BASE/latest/$FILE" -o "$TMP/modfield-agent"
curl -fsSL "$BASE/latest/checksums.txt" -o "$TMP/checksums.txt"
(cd "$TMP" && grep " $FILE\$" checksums.txt | sed "s| $FILE\$| modfield-agent|" | sha256_check)

if [ -n "$MINISIGN_KEY" ]; then
  if ! command -v minisign >/dev/null 2>&1; then
    echo "minisign not found: only the SHA-256 was checked." >&2
  elif curl -fsSL "$BASE/latest/checksums.txt.minisig" -o "$TMP/checksums.txt.minisig"; then
    # SHA-256 (above) always runs; the signature is the extra guarantee when published.
    minisign -Vm "$TMP/checksums.txt" -P "$MINISIGN_KEY"
  else
    echo "no minisign signature published at this source: only the SHA-256 was checked." >&2
  fi
fi

mkdir -p "$HOME/.local/bin"
install -m 755 "$TMP/modfield-agent" "$HOME/.local/bin/modfield-agent"

if [ "$OS" = darwin ]; then
  # Per-user LaunchAgent: starts at login, restarts if it exits. No admin.
  PLIST="$HOME/Library/LaunchAgents/app.modfield.agent.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>app.modfield.agent</string>
  <key>ProgramArguments</key><array><string>$HOME/.local/bin/modfield-agent</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
PLISTEOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST"
  echo "Agent installed and running. It also starts at login."
  echo "Stop/remove it with: launchctl unload -w \"$PLIST\""
elif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  curl -fsSL "$BASE/latest/modfield-agent.service" -o "$HOME/.config/systemd/user/modfield-agent.service"
  systemctl --user daemon-reload
  systemctl --user enable --now modfield-agent
  echo "Agent installed and running (systemctl --user status modfield-agent)."
else
  echo "Agent installed in ~/.local/bin. Start it with: modfield-agent"
fi

# Linux serial ports need the user in the group that owns them (one sudo, once).
if [ "$OS" = linux ]; then
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
fi
