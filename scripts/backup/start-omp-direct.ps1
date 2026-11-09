<#
.SYNOPSIS
    Launches OMP in direct mode using the restored 'omp-portable' profile.

.DESCRIPTION
    Launches OMP bound to the 'omp-portable' profile with broker and gateway environment
    overrides stripped from the child process. Retains the calling terminal, working directory,
    and user environment.

.PARAMETER RemainingArgs
    Arguments to pass directly to the child OMP process. Arguments altering profile
    or configuration roots are rejected to ensure direct mode isolation.

.EXAMPLE
    .\start-omp-direct.ps1
    .\start-omp-direct.ps1 config path
    .\start-omp-direct.ps1 auth-broker login google-antigravity
#>

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

# 1. Reject forbidden arguments that breach profile isolation
foreach ($arg in $RemainingArgs) {
    if ($arg -eq "--profile" -or $arg.StartsWith("--profile=") -or $arg -eq "--config" -or $arg.StartsWith("--config=")) {
        Write-Error "Argument '$arg' is not permitted with direct launch. Direct launcher forces '--profile omp-portable'."
        exit 1
    }
}

# 2. Verify bun is available
$bunCmd = Get-Command "bun" -ErrorAction SilentlyContinue
if (-not $bunCmd) {
    Write-Error "Prerequisite missing: 'bun' was not found on PATH."
    exit 1
}

# 3. Resolve helper script path
$helperCandidates = @(
    (Join-Path $PSScriptRoot "omp-backup.js"),
    (Join-Path (Resolve-Path "$PSScriptRoot\..\..\apps\backup\dist" -ErrorAction SilentlyContinue) "index.js"),
    (Join-Path (Resolve-Path "$PSScriptRoot\..\..\apps\backup\src" -ErrorAction SilentlyContinue) "index.ts")
)
$helperScript = $helperCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $helperScript) {
    Write-Error "Backup helper script was not found. Please run 'bun run build' or install the toolkit."
    exit 1
}

# 4. Verify OMP runtime compatibility via check-runtime
$procInfo = New-Object System.Diagnostics.ProcessStartInfo
$procInfo.FileName = "bun"
$procInfo.Arguments = "run `"$helperScript`" check-runtime"
$procInfo.RedirectStandardOutput = $true
$procInfo.RedirectStandardError = $true
$procInfo.UseShellExecute = $false

$proc = [System.Diagnostics.Process]::Start($procInfo)
$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()

if ($proc.ExitCode -ne 0) {
    $errMsg = $stderr.Trim()
    if (-not $errMsg) { $errMsg = $stdout.Trim() }
    Write-Error "Runtime compatibility check failed: $errMsg"
    exit $proc.ExitCode
}

# 5. Launch direct OMP process via helper
$launchArgs = @("run", $helperScript, "launch")
if ($RemainingArgs -and $RemainingArgs.Count -gt 0) {
    $launchArgs += "--"
    $launchArgs += $RemainingArgs
}

& bun $launchArgs
exit $LASTEXITCODE
