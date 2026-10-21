$RepoUrl = "https://github.com/kamishino/omp-toolkit.git"
$InstallDir = if ($env:OMP_TOOLKIT_HOME) { $env:OMP_TOOLKIT_HOME } else { Join-Path $HOME ".omp\omp-toolkit" }
$AgentDir = if ($env:PI_CODING_AGENT_DIR) { $env:PI_CODING_AGENT_DIR } else { Join-Path $HOME ".omp\agent" }
$MinBun = [version]"1.4.3"

function Fail([string]$Message) {
  throw "OMP Toolkit installer: $Message"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "git is required: https://git-scm.com/downloads"
}
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Fail "bun is required: https://bun.sh/docs/installation"
}

$BunVersion = (& bun --version).Trim().Split("-")[0]
$Parsed = [version]"0.0.0"
if (-not [version]::TryParse($BunVersion, [ref]$Parsed) -or $Parsed -lt $MinBun) {
  Fail "bun $MinBun or newer is required (found $BunVersion). Run: bun upgrade"
}

if (Test-Path (Join-Path $InstallDir ".git")) {
  Write-Host "Updating $InstallDir"
  git -C $InstallDir fetch --depth 1 origin main
  if ($LASTEXITCODE -ne 0) { Fail "git fetch failed" }
  git -C $InstallDir reset --hard FETCH_HEAD
  if ($LASTEXITCODE -ne 0) { Fail "git reset failed" }
} elseif (Test-Path $InstallDir) {
  Fail "$InstallDir exists and is not a git checkout. Move it or set OMP_TOOLKIT_HOME."
} else {
  Write-Host "Cloning into $InstallDir"
  $Parent = Split-Path -Parent $InstallDir
  if ($Parent) { New-Item -ItemType Directory -Force -Path $Parent | Out-Null }
  git clone --depth 1 $RepoUrl $InstallDir
  if ($LASTEXITCODE -ne 0) { Fail "git clone failed" }
}

Push-Location $InstallDir
try {
  & bun install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { Fail "bun install failed" }
  & bun run install:omp
  if ($LASTEXITCODE -ne 0) { Fail "bun run install:omp failed" }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "OMP Toolkit installed."
Write-Host "Health CLI: bun `"$AgentDir\scripts\omp-provider-usage.js`" --health"
Write-Host "OMP command: /gemini-health"
Write-Host "Orca tab: cd `"$InstallDir`"; bun run monitor:orca"
