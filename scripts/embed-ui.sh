#!/bin/sh
# Copies the static site build into the agent, so it can serve the UI itself
# on http://127.0.0.1:47807 (for browsers that block the public site's access
# to localhost). Run after `pnpm build`.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/apps/web/out"
DIST="$ROOT/agent/web/dist"
if [ ! -f "$OUT/index.html" ]; then
  echo "apps/web/out not found: run 'pnpm build' first" >&2
  exit 1
fi
find "$DIST" -mindepth 1 ! -name README.txt -exec rm -rf {} +
cp -R "$OUT"/. "$DIST"/
echo "UI embedded into agent/web/dist"
