$ErrorActionPreference = 'Stop'

$desktopDirectory = $PSScriptRoot
$repositoryDirectory = Split-Path $desktopDirectory -Parent
$releaseDirectory = Join-Path $desktopDirectory 'release'
$stagingDirectory = Join-Path $desktopDirectory 'dist\release-staging'
$avatarArchive = Join-Path $desktopDirectory 'dist\default-avatars.zip'
$avatarFolderName = "$([char]0x5934)$([char]0x50CF)"
$appName = "$([char]0x4E0B)$([char]0x4E00)$([char]0x4F4D)"
$desktopVersion = (Get-Content -Raw -Encoding UTF8 (Join-Path $desktopDirectory 'package.json') | ConvertFrom-Json).version
$webVersion = '1.0.1'
$desktopAsset = Join-Path $releaseDirectory "icebreaker-lottery-desktop-v$desktopVersion-windows-x64.zip"
$webAsset = Join-Path $releaseDirectory "icebreaker-lottery-web-v$webVersion.zip"

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & git -C $repositoryDirectory @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git failed with exit code $LASTEXITCODE"
  }
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [System.IO.File]::OpenRead($Path)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

Push-Location $desktopDirectory
try {
  & npm run build:exe
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop build failed with exit code $LASTEXITCODE"
  }

  New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
  if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
  }
  New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null

  $sourceExe = Join-Path $desktopDirectory "$appName.exe"
  if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
    throw "Desktop executable not found: $sourceExe"
  }
  Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $stagingDirectory "$appName.exe")

  if (Test-Path -LiteralPath $avatarArchive) {
    Remove-Item -LiteralPath $avatarArchive -Force
  }
  Invoke-Git archive --format=zip --output=$avatarArchive HEAD -- "shared/defaults/$avatarFolderName"
  $avatarExtraction = Join-Path $desktopDirectory 'dist\default-avatars'
  if (Test-Path -LiteralPath $avatarExtraction) {
    Remove-Item -LiteralPath $avatarExtraction -Recurse -Force
  }
  Expand-Archive -LiteralPath $avatarArchive -DestinationPath $avatarExtraction
  Copy-Item -LiteralPath (Join-Path $avatarExtraction "shared\defaults\$avatarFolderName") -Destination (Join-Path $stagingDirectory $avatarFolderName) -Recurse

  if (Test-Path -LiteralPath $desktopAsset) {
    Remove-Item -LiteralPath $desktopAsset -Force
  }
  Compress-Archive -Path (Join-Path $stagingDirectory '*') -DestinationPath $desktopAsset -CompressionLevel Optimal

  if (Test-Path -LiteralPath $webAsset) {
    Remove-Item -LiteralPath $webAsset -Force
  }
  Invoke-Git archive --format=zip --output=$webAsset "v$webVersion" -- web shared

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $desktopZip = [System.IO.Compression.ZipFile]::OpenRead($desktopAsset)
  try {
    $entryNames = @($desktopZip.Entries | ForEach-Object FullName)
    if ($entryNames -notcontains "$appName.exe") {
      throw "Desktop package is missing $appName.exe"
    }
    if ($entryNames -notcontains "$avatarFolderName/avatars.js") {
      throw "Desktop package is missing $avatarFolderName/avatars.js"
    }
    $unexpectedRoots = @($entryNames | ForEach-Object { ($_ -split '/')[0] } | Sort-Object -Unique | Where-Object { $_ -notin @("$appName.exe", $avatarFolderName) })
    if ($unexpectedRoots.Count -gt 0) {
      throw "Desktop package contains unexpected top-level entries: $($unexpectedRoots -join ', ')"
    }
  } finally {
    $desktopZip.Dispose()
  }

  @($webAsset, $desktopAsset) | ForEach-Object {
    [PSCustomObject]@{
      Path = $_
      Hash = Get-Sha256 -Path $_
    }
  }
} finally {
  Pop-Location
}
