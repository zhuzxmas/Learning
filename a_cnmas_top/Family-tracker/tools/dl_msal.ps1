$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path 'spending-tracker/public/vendor' | Out-Null
$out = 'spending-tracker/public/vendor/msal-browser.min.js'
$urls = @(
  'https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.28.1/lib/msal-browser.min.js',
  'https://unpkg.com/@azure/msal-browser@3.28.1/lib/msal-browser.min.js',
  'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.4/lib/msal-browser.min.js'
)
foreach ($url in $urls) {
  try {
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
    Write-Output ('OK ' + $url + ' -> ' + (Get-Item $out).Length + ' bytes')
    break
  } catch {
    Write-Output ('FAIL ' + $url + ' : ' + $_.Exception.Message)
  }
}
