#!/bin/sh
# Registers the LaunchAgent for the current user. Run from inside the .app
# (Contents/Resources) or with the agent path as $1. No sudo.
set -eu
AGENT="${1:-$(cd "$(dirname "$0")/../MacOS" && pwd)/modfield-agent}"
PLIST="$HOME/Library/LaunchAgents/dev.modfield.agent.plist"
mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__AGENT__|$AGENT|" "$(dirname "$0")/dev.modfield.agent.plist" > "$PLIST"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "ModField agent registered for $(id -un)."
