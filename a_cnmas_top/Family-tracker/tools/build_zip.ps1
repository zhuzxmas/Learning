$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Repo-relative paths (this script lives in Family-tracker\tools).
$familyRoot = Split-Path -Parent $PSScriptRoot
$public     = Join-Path $familyRoot 'public'
$dest       = Join-Path $familyRoot 'spending-tracker-public.zip'

if (Test-Path $dest) { Remove-Item $dest -Force }

# Cloudflare expects standard ZIP paths. Build entries explicitly with '/'
# rather than relying on Compress-Archive, which uses backslashes on Windows.
$zip = [IO.Compression.ZipFile]::Open($dest, [IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $public -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($public.Length + 1).Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $_.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}

Write-Output "zip rebuilt (static, no functions): $dest"
