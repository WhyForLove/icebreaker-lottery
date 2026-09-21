$ErrorActionPreference = 'Stop'

$desktopDirectory = $PSScriptRoot
$sourceExe = Join-Path $desktopDirectory 'src-tauri\target\release\icebreaker-lottery-desktop.exe'
$appName = "$([char]0x4E0B)$([char]0x4E00)$([char]0x4F4D)"
$outputName = "$appName.exe"
$outputExe = Join-Path $desktopDirectory $outputName

Push-Location $desktopDirectory
try {
  & npm run tauri -- build --no-bundle
  if ($LASTEXITCODE -ne 0) {
    throw "Tauri build failed with exit code $LASTEXITCODE"
  }
  if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
    throw "Build output not found: $sourceExe"
  }
  Copy-Item -LiteralPath $sourceExe -Destination $outputExe -Force
  Write-Host "Desktop executable created: $outputExe"
} finally {
  Pop-Location
}
