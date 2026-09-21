$ErrorActionPreference = 'Stop'

$desktopDirectory = $PSScriptRoot
$sourceExe = Join-Path $desktopDirectory 'src-tauri\target\release\icebreaker-lottery-desktop.exe'
$appName = "$([char]0x4E0B)$([char]0x4E00)$([char]0x4F4D)"
$outputName = "$appName.exe"
$outputExe = Join-Path $desktopDirectory $outputName
$legacyExe = Join-Path $desktopDirectory "$appName Desktop V2.exe"

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
  if (Test-Path -LiteralPath $legacyExe -PathType Leaf) {
    Remove-Item -LiteralPath $legacyExe -Force
  }
  Write-Host "Desktop executable created: $outputExe"
} finally {
  Pop-Location
}
