$ErrorActionPreference = 'Stop'

$desktopDirectory = $PSScriptRoot
$sourceExe = Join-Path $desktopDirectory 'src-tauri\target\release\icebreaker-lottery-desktop.exe'
$appName = "$([char]0x4E0B)$([char]0x4E00)$([char]0x4F4D)"
$outputName = "$appName.exe"
$outputExe = Join-Path $desktopDirectory $outputName
$avatarFolderName = "$([char]0x5934)$([char]0x50CF)"
$sourceAvatarDirectory = Join-Path (Split-Path $desktopDirectory -Parent) "shared\defaults\$avatarFolderName"
$outputAvatarDirectory = Join-Path $desktopDirectory $avatarFolderName

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
  if (-not (Test-Path -LiteralPath $outputAvatarDirectory)) {
    if (-not (Test-Path -LiteralPath $sourceAvatarDirectory -PathType Container)) {
      throw "Default avatar directory not found: $sourceAvatarDirectory"
    }
    Copy-Item -LiteralPath $sourceAvatarDirectory -Destination $outputAvatarDirectory -Recurse
    Write-Host "Local avatar directory initialized: $outputAvatarDirectory"
  }
  Write-Host "Desktop executable created: $outputExe"
} finally {
  Pop-Location
}
