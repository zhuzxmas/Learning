$ErrorActionPreference = 'Stop'

# Repo-relative paths (this script lives in Family-tracker\tools).
$familyRoot = Split-Path -Parent $PSScriptRoot
$public     = Join-Path $familyRoot 'public'
$dest       = Join-Path $familyRoot 'spending-tracker-public.zip'

$tmp = Join-Path $env:TEMP 'st-zip-build'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null

# Copy the static site (public/*) flat into the archive root.
Copy-Item (Join-Path $public '*') -Destination $tmp -Recurse

if (Test-Path $dest) { Remove-Item $dest -Force }
Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $dest -Force
Remove-Item $tmp -Recurse -Force

Write-Output "zip rebuilt (static, no functions): $dest"
