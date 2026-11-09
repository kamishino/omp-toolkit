<#
.SYNOPSIS
    Exports OMP portable settings and provider logins to an encrypted snapshot archive.

.DESCRIPTION
    Extracts global portable preferences and locally stored provider logins from the selected
    profile, encrypts them using AES-256-GCM and an scrypt-derived key from your passphrase,
    and publishes a timestamped encrypted archive to the specified backup destination.

.PARAMETER DestinationDir
    Target directory for encrypted snapshots. Defaults to the OMP_BACKUP_DIR environment variable.

.PARAMETER Profile
    Source profile to export ('default' or 'omp-portable'). Defaults to 'default'.

.PARAMETER NoLatestCopy
    Disables updating 'omp-config-latest.enc' alongside the timestamped archive.

.EXAMPLE
    .\export-omp-config.ps1 -DestinationDir "D:\Backups\omp"
    .\export-omp-config.ps1 -Profile omp-portable
#>

[CmdletBinding()]
param(
    [string]$DestinationDir = $env:OMP_BACKUP_DIR,
    [ValidateSet("default", "omp-portable")]
    [string]$Profile = "default",
    [switch]$NoLatestCopy
)

$ErrorActionPreference = "Stop"

Write-Host "=== OMP Encrypted Portable Export ===" -ForegroundColor Cyan

# 1. Verify destination directory is provided
if (-not $DestinationDir) {
    Write-Error "No destination directory specified. Pass -DestinationDir <path> or set the OMP_BACKUP_DIR environment variable."
    exit 1
}

# 2. Verify bun is available
$bunCmd = Get-Command "bun" -ErrorAction SilentlyContinue
if (-not $bunCmd) {
    Write-Error "Prerequisite missing: 'bun' was not found on PATH. Bun is required for portable backup operations."
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

$runtimeCheck = $stdout | ConvertFrom-Json
if (-not $runtimeCheck.success) {
    Write-Error "Runtime compatibility check failed: $($runtimeCheck.error)"
    exit 1
}
$ompVersion = $runtimeCheck.ompVersion

# 5. Verify destination directory accessibility
$driveRoot = [System.IO.Path]::GetPathRoot($DestinationDir)
if ($driveRoot -and (-not (Test-Path $driveRoot))) {
    Write-Error "Destination drive '$driveRoot' is not mounted or accessible."
    exit 1
}

if (-not (Test-Path $DestinationDir)) {
    Write-Host "Creating destination directory: $DestinationDir" -ForegroundColor Gray
    New-Item -ItemType Directory -Path $DestinationDir -Force | Out-Null
}

$userProfile = $env:USERPROFILE
$ompRoot = Join-Path $userProfile ".omp"

$sourceAgentDir = if ($Profile -eq "default") {
    Join-Path $ompRoot "agent"
} else {
    Join-Path $ompRoot (Join-Path "profiles" (Join-Path $Profile "agent"))
}

Write-Host "Source Profile:   $Profile ($sourceAgentDir)" -ForegroundColor Gray
Write-Host "OMP Version:      $ompVersion" -ForegroundColor Gray
Write-Host "Destination:      $DestinationDir" -ForegroundColor Gray

# 6. Prompt for passphrase (twice)
function Read-PassphraseSecure ([string]$prompt) {
    if ([Console]::IsInputRedirected) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { return $null }
        $sec = New-Object System.Security.SecureString
        foreach ($ch in $line.ToCharArray()) {
            $sec.AppendChar($ch)
        }
        $sec.MakeReadOnly()
        return $sec
    } else {
        return Read-Host $prompt -AsSecureString
    }
}

$sec1 = Read-PassphraseSecure "Enter encryption passphrase"
$sec2 = Read-PassphraseSecure "Confirm encryption passphrase"

$bstr1 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec1)
$bstr2 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec2)
$pass1 = $null
$pass2 = $null

try {
    $pass1 = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr1)
    $pass2 = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr2)

    if ([string]::IsNullOrEmpty($pass1)) {
        Write-Error "Passphrase cannot be empty."
        exit 1
    }
    if ($pass1 -ne $pass2) {
        Write-Error "Passphrases do not match. Export aborted."
        exit 1
    }

    Write-Host "`nEncrypting and publishing snapshot..." -ForegroundColor Gray

    $jsonInput = @{ passphrase = $pass1 } | ConvertTo-Json -Compress

    $exportProcInfo = New-Object System.Diagnostics.ProcessStartInfo
    $exportProcInfo.FileName = "bun"
    $procArgs = "run `"$helperScript`" export --destination `"$DestinationDir`" --profile `"$Profile`""
    if ($NoLatestCopy) {
        $procArgs += " --no-latest-copy"
    }
    $exportProcInfo.Arguments = $procArgs
    $exportProcInfo.RedirectStandardInput = $true
    $exportProcInfo.RedirectStandardOutput = $true
    $exportProcInfo.RedirectStandardError = $true
    $exportProcInfo.UseShellExecute = $false

    $exportProc = [System.Diagnostics.Process]::Start($exportProcInfo)
    $exportProc.StandardInput.WriteLine($jsonInput)
    $exportProc.StandardInput.Close()

    $exportStdout = $exportProc.StandardOutput.ReadToEnd()
    $exportStderr = $exportProc.StandardError.ReadToEnd()
    $exportProc.WaitForExit()

    if ($exportProc.ExitCode -ne 0) {
        $errMsg = $exportStderr.Trim()
        if (-not $errMsg) { $errMsg = $exportStdout.Trim() }
        Write-Error "Export failed (exit code $($exportProc.ExitCode)): $errMsg"
        exit $exportProc.ExitCode
    }

    $result = $exportStdout | ConvertFrom-Json
    if (-not $result.success) {
        Write-Error "Export helper reported failure: $($result.error)"
        exit 1
    }

    Write-Host "`n=== Export Complete ===" -ForegroundColor Green
    Write-Host "Snapshot Created: $($result.snapshotPath)" -ForegroundColor Green
    if ($result.latestPath) {
        Write-Host "Latest Snapshot:  $($result.latestPath)" -ForegroundColor DarkCyan
    }
}
finally {
    if ($bstr1) { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr1) }
    if ($bstr2) { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr2) }
    $pass1 = $null
    $pass2 = $null
}
