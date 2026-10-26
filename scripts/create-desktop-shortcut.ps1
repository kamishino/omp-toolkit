#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $repoRoot "omp-widget.cmd"
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  throw "Launcher not found: $launcher"
}

$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
if (-not $desktop) {
  throw "Could not resolve the current user's Desktop folder."
}

$shortcutPath = Join-Path $desktop "OMP Provider Usage.lnk"
if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description = "Open the OMP provider usage panel"
$shortcut.WindowStyle = 1

$electron = Join-Path $repoRoot "apps\desktop\node_modules\electron\dist\electron.exe"
if (-not (Test-Path -LiteralPath $electron -PathType Leaf)) {
  $electron = Join-Path $repoRoot "node_modules\electron\dist\electron.exe"
}
if (Test-Path -LiteralPath $electron -PathType Leaf) {
  $shortcut.IconLocation = "$electron,0"
}
$shortcut.Save()
Write-Host "Created desktop shortcut: $shortcutPath"
