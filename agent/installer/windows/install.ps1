# ModField agent installer for Windows, without administrator:
#   irm https://modfield.app/downloads/latest/install.ps1 | iex
#
# Downloads the agent with Invoke-WebRequest (which does not tag the file as
# coming from the internet), so neither the browser download block nor the
# SmartScreen "Windows protected your PC" warning appears. Verifies the SHA-256,
# installs to %LOCALAPPDATA%\Programs\ModField for the current user only, sets it
# to start at login (HKCU Run) and launches it now.
$ErrorActionPreference = 'Stop'

$base = if ($env:MODFIELD_BASE) { $env:MODFIELD_BASE } else { 'https://modfield.app/downloads' }
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
$file = "modfield-agent_windows_$arch.exe"
$dir  = Join-Path $env:LOCALAPPDATA 'Programs\ModField'
$exe  = Join-Path $dir 'modfield-agent.exe'
$tmp  = Join-Path $env:TEMP $file

Write-Host "Downloading $file..."
Invoke-WebRequest -Uri "$base/latest/$file" -OutFile $tmp -UseBasicParsing

# Verify the SHA-256 against the published checksums.txt. Parse each "<hash>  <file>"
# line into tokens and match the file name exactly, so trailing CR or extra spaces
# never break the lookup.
$sums = (Invoke-WebRequest -Uri "$base/latest/checksums.txt" -UseBasicParsing).Content
$want = $null
foreach ($ln in ($sums -split '\r?\n')) {
  $t = $ln.Trim() -split '\s+'
  if ($t.Length -ge 2 -and $t[$t.Length - 1] -ieq $file) { $want = $t[0].ToLower(); break }
}
if (-not $want) { throw "No checksum for $file in checksums.txt" }
$got = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLower()
if ($got -ne $want) { throw "SHA-256 mismatch for $file (expected $want, got $got)" }

# Stop a running copy, install, clean up.
Get-Process modfield-agent -ErrorAction SilentlyContinue | Stop-Process -Force
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item $tmp $exe -Force
Remove-Item $tmp -Force

# Start at login (per-user, no admin), then launch now.
New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' `
  -Name 'ModFieldAgent' -Value "`"$exe`"" -PropertyType String -Force | Out-Null
Start-Process $exe

Write-Host "ModField agent installed in $dir and started. It also starts at login."
Write-Host "To remove it: close the agent, delete `"$dir`" and the ModFieldAgent value under"
Write-Host "HKCU\Software\Microsoft\Windows\CurrentVersion\Run."
