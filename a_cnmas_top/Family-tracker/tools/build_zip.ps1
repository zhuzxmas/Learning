$ErrorActionPreference = 'Stop'
$root = 'C:\Users\zzhu25\Local\00.Installer\test\spending-tracker'
$tmp  = Join-Path $env:TEMP 'st-zip-build'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null
Copy-Item (Join-Path $root 'public\*') -Destination $tmp -Recurse
$dest = Join-Path $root 'spending-tracker-public.zip'
if (Test-Path $dest) { Remove-Item $dest -Force }
Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $dest -Force
Remove-Item $tmp -Recurse -Force
Write-Output 'zip rebuilt (static, no functions)'
