#!/bin/sh
# Builds the Windows portable ZIPs from the raw .exe binaries already in a dist
# directory:
#   modfield-agent_windows_<arch>.exe -> ModField-Agent-<version>-windows-<arch>-portable.zip
# Shared by scripts/dist-agent.sh and the release workflow so both produce the
# identical "portable" artifacts the Home download list offers for Windows.
set -eu
# Absolute, so the zip output path still resolves after we cd into the temp dir.
DIST="$(cd "$1" && pwd)"
VERSION="$2"
for arch in amd64 arm64; do
  src="$DIST/modfield-agent_windows_${arch}.exe"
  [ -f "$src" ] || { echo "windows-portable: missing $src" >&2; exit 1; }
  tmp="$(mktemp -d)"
  cp "$src" "$tmp/modfield-agent.exe"
  cat > "$tmp/LEIA-ME.txt" <<TXT
ModField Agent $VERSION (Windows, $arch), versão portátil.

Não precisa instalar nem de administrador: extraia esta pasta em qualquer lugar
seu (por exemplo Documentos) e abra modfield-agent.exe. O ícone aparece na
bandeja; o agente só escuta em 127.0.0.1:47807.

Para iniciar com o Windows, prefira o instalador (ModField-Agent-...-setup.exe),
que registra a inicialização e o desinstalador só para o seu usuário.
TXT
  (cd "$tmp" && zip -q -9 "$DIST/ModField-Agent-${VERSION}-windows-${arch}-portable.zip" modfield-agent.exe LEIA-ME.txt)
  rm -rf "$tmp"
done
