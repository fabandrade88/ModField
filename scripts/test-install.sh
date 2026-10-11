#!/bin/sh
# End-to-end test of agent/installer/linux/install.sh against agent/dist/latest
# served locally (instead of https://modfield.app/downloads). Run scripts/dist-agent.sh first.
# Nothing touches the real user: HOME is a temp dir and systemctl is a fake
# that only records its calls.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/agent/dist"
[ -f "$DIST/latest/install.sh" ] || { echo "run scripts/dist-agent.sh first" >&2; exit 1; }
WORK="$(mktemp -d)"
PIDS=""
cleanup() { for p in $PIDS; do kill "$p" 2>/dev/null || true; done; rm -rf "$WORK"; }
trap cleanup EXIT

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }
serve() { # dir -> base URL
  port=$(free_port)
  python3 -m http.server "$port" --bind 127.0.0.1 --directory "$1" >/dev/null 2>&1 &
  PIDS="$PIDS $!"
  for _ in $(seq 50); do curl -fs "http://127.0.0.1:$port/" >/dev/null 2>&1 && break; sleep 0.1; done
  echo "http://127.0.0.1:$port"
}
pass() { echo "  ok  $1"; }
fail() { echo "  FAIL $1" >&2; exit 1; }

BASE=$(serve "$DIST")

echo "== A: install on this machine (temp HOME, fake systemctl)"
H="$WORK/home-a"; SHIM="$WORK/shim"; mkdir -p "$H" "$SHIM"
cat > "$SHIM/systemctl" <<SH
#!/bin/sh
echo "\$*" >> "$WORK/systemctl.log"
exit 0
SH
chmod +x "$SHIM/systemctl"
curl -fsSL "$BASE/latest/install.sh" | env HOME="$H" PATH="$SHIM:$PATH" MODFIELD_BASE="$BASE" sh > "$WORK/a.out" 2>&1 || { cat "$WORK/a.out"; fail "installer exited with an error"; }
grep -q "modfield-agent: OK" "$WORK/a.out" && pass "SHA-256 checked" || fail "no checksum line in the output"
[ -x "$H/.local/bin/modfield-agent" ] && pass "binary in ~/.local/bin" || fail "binary not installed"
[ "$("$H/.local/bin/modfield-agent" version)" = "$("$DIST/modfield-agent_linux_amd64" version)" ] && pass "installed version $("$H/.local/bin/modfield-agent" version)" || fail "wrong version"
cmp -s "$H/.config/systemd/user/modfield-agent.service" "$ROOT/agent/installer/linux/modfield-agent.service" && pass "systemd --user unit written" || fail "unit missing"
grep -qx -- "--user daemon-reload" "$WORK/systemctl.log" && grep -qx -- "--user enable --now modfield-agent" "$WORK/systemctl.log" && pass "systemctl --user daemon-reload / enable --now" || { cat "$WORK/systemctl.log"; fail "systemctl not called as expected"; }

# Run what was installed, the way the unit would.
P=$(free_port)
"$H/.local/bin/modfield-agent" --headless --no-browser --no-update --port "$P" --data-dir "$H/.local/share/modfield" > "$WORK/agent.log" 2>&1 &
PIDS="$PIDS $!"
for _ in $(seq 50); do curl -fs "http://127.0.0.1:$P/pair" >/dev/null 2>&1 && break; sleep 0.1; done
curl -fs "http://127.0.0.1:$P/pair" | grep -q "Parear navegador" && pass "agent runs and serves /pair" || { cat "$WORK/agent.log"; fail "agent did not start"; }
curl -fs "http://127.0.0.1:$P/pt/" | grep -q "_next/static" && pass "agent serves the embedded UI at /pt/" || fail "embedded UI missing"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example' "http://127.0.0.1:$P/v1/hello")" = 403 ] && pass "foreign origin refused (403)" || fail "origin check"
[ -f "$H/.local/share/modfield/agent.key" ] && [ "$(stat -c %a "$H/.local/share/modfield/agent.key")" = 600 ] && pass "key created with mode 600" || fail "agent key"

echo "== B: a tampered download is refused"
T="$WORK/tampered"; mkdir -p "$T/latest"
cp "$DIST/latest/"* "$T/latest/"
printf 'x' >> "$T/latest/modfield-agent_linux_amd64"
BASE_T=$(serve "$T")
H2="$WORK/home-b"; mkdir -p "$H2"
if curl -fsSL "$BASE_T/latest/install.sh" | env HOME="$H2" PATH="$SHIM:$PATH" MODFIELD_BASE="$BASE_T" sh > "$WORK/b.out" 2>&1; then
  cat "$WORK/b.out"; fail "installer accepted a binary that does not match checksums.txt"
fi
grep -q "FAILED" "$WORK/b.out" && pass "checksum mismatch reported" || { cat "$WORK/b.out"; fail "no checksum error"; }
[ ! -e "$H2/.local/bin/modfield-agent" ] && pass "nothing installed" || fail "binary installed anyway"

echo "== C: clean Debian container, ordinary user, no sudo, no systemd"
if docker info >/dev/null 2>&1; then
  docker run --rm --network host -v "$DIST:/dist:ro" debian:stable-slim sh -euc "
    apt-get update -qq >/dev/null && apt-get install -y -qq curl ca-certificates >/dev/null
    useradd -m tecnico
    su tecnico -c 'curl -fsSL $BASE/latest/install.sh | MODFIELD_BASE=$BASE sh'
    su tecnico -c '~/.local/bin/modfield-agent version'
    test ! -e /usr/local/bin/modfield-agent
  " > "$WORK/c.out" 2>&1 || { cat "$WORK/c.out"; fail "container install"; }
  grep -q "Agent installed in ~/.local/bin" "$WORK/c.out" && pass "falls back to ~/.local/bin without systemd" || { cat "$WORK/c.out"; fail "fallback message"; }
  grep -qx "$("$DIST/modfield-agent_linux_amd64" version)" "$WORK/c.out" && pass "runs as an ordinary user" || fail "version in container"
else
  echo "  skip docker not available"
fi
echo "all install checks passed"
