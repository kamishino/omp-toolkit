<#
.SYNOPSIS
    Restores OMP portable settings and credentials from an encrypted snapshot into the 'omp-portable' profile.

.DESCRIPTION
    Decrypts an encrypted snapshot (.enc), displays a non-secret preview for user confirmation,
    captures an encrypted recovery snapshot of the local portable state first, and transactionally
    restores portable preferences and provider logins into the isolated 'omp-portable' profile.

.PARAMETER SnapshotPath
    Path to the encrypted snapshot (.enc). If omitted, searches for 'omp-config-latest.enc'
    in the directory specified by the OMP_BACKUP_DIR environment variable.

.EXAMPLE
    .\import-omp-config.ps1 -SnapshotPath "D:\Backups\omp\omp-config-20261109T033000Z-1a2b3c4d.enc"
    .\import-omp-config.ps1
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$SnapshotPath
)

$ErrorActionPreference = "Stop"

Write-Host "=== OMP Encrypted Portable Restore ===" -ForegroundColor Cyan

# 1. Reject legacy ZIP archives
if ($SnapshotPath -and $SnapshotPath.EndsWith(".zip", [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Error "Legacy unencrypted .zip archives are not supported. Please export a fresh encrypted .enc snapshot from the credential-owning machine."
    exit 1
}

# 2. Verify bun is available
$bunCmd = Get-Command "bun" -ErrorAction SilentlyContinue
if (-not $bunCmd) {
    Write-Error "Prerequisite missing: 'bun' was not found on PATH. Bun is required for portable restore operations."
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

# 5. Locate target snapshot file
if (-not $SnapshotPath) {
    if ($env:OMP_BACKUP_DIR) {
        $candidate = Join-Path $env:OMP_BACKUP_DIR "omp-config-latest.enc"
        if (Test-Path $candidate) {
            $SnapshotPath = $candidate
        }
    }
}

if (-not $SnapshotPath -or (-not (Test-Path $SnapshotPath))) {
    Write-Error "No snapshot archive found. Specify -SnapshotPath <path-to-snapshot.enc> or set the OMP_BACKUP_DIR environment variable."
    exit 1
}

Write-Host "Snapshot Selected: $SnapshotPath" -ForegroundColor Green
Write-Host "OMP Version:       $ompVersion" -ForegroundColor Gray

# 6. Prompt for passphrase
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

function Read-Confirmation ([string]$prompt) {
    if ([Console]::IsInputRedirected) {
        return [Console]::In.ReadLine()
    } else {
        return Read-Host $prompt
    }
}

$sec = Read-PassphraseSecure "Enter snapshot decryption passphrase"
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$passPlain = $null

try {
    $passPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ([string]::IsNullOrEmpty($passPlain)) {
        Write-Error "Passphrase cannot be empty."
        exit 1
    }

    Write-Host "`nInspecting snapshot contents..." -ForegroundColor Gray

    # Stage 1: Preview / Inspect
    $previewInput = @{ passphrase = $passPlain } | ConvertTo-Json -Compress

    $inspectProcInfo = New-Object System.Diagnostics.ProcessStartInfo
    $inspectProcInfo.FileName = "bun"
    $inspectProcInfo.Arguments = "run `"$helperScript`" import --preview --snapshot `"$SnapshotPath`""
    $inspectProcInfo.RedirectStandardInput = $true
    $inspectProcInfo.RedirectStandardOutput = $true
    $inspectProcInfo.RedirectStandardError = $true
    $inspectProcInfo.UseShellExecute = $false

    $inspectProc = [System.Diagnostics.Process]::Start($inspectProcInfo)
    $inspectProc.StandardInput.WriteLine($previewInput)
    $inspectProc.StandardInput.Close()

    $inspectStdout = $inspectProc.StandardOutput.ReadToEnd()
    $inspectStderr = $inspectProc.StandardError.ReadToEnd()
    $inspectProc.WaitForExit()

    if ($inspectProc.ExitCode -ne 0) {
        $errMsg = $inspectStderr.Trim()
        if (-not $errMsg) { $errMsg = $inspectStdout.Trim() }
        Write-Error "Snapshot inspection failed (exit code $($inspectProc.ExitCode)): $errMsg"
        exit $inspectProc.ExitCode
    }

    $inspectResult = $inspectStdout | ConvertFrom-Json
    if (-not $inspectResult.success) {
        Write-Error "Inspection helper reported failure: $($inspectResult.error)"
        exit 1
    }

    $summary = $inspectResult.summary

    Write-Host "`n=== Snapshot Inspection Summary ===" -ForegroundColor Cyan
    Write-Host "Snapshot Kind:      $($summary.kind)" -ForegroundColor $(if ($summary.kind -eq "recovery") { "Yellow" } else { "Green" })
    Write-Host "Created At:         $($summary.createdAt)"
    if ($summary.sourceHost) {
        Write-Host "Source Host:        $($summary.sourceHost)"
    }
    if ($summary.sourceProfile) {
        Write-Host "Source Profile:     $($summary.sourceProfile)"
    }
    Write-Host "Settings Count:     $($summary.settingCount) portable preferences"
    Write-Host "Credentials Count:  $($summary.credentialCount) provider logins"
    Write-Host "Fingerprint:        $($summary.sha256)" -ForegroundColor Gray
    Write-Host "Target Profile:     omp-portable (isolated direct mode)" -ForegroundColor DarkCyan

    $promptMsg = if ($summary.kind -eq "recovery") {
        "Proceed with rolling back the 'omp-portable' profile to this recovery baseline? (yes/no)"
    } else {
        "Proceed with replacing portable profile settings and credentials? (yes/no)"
    }

    $confirm = Read-Confirmation "`n$promptMsg"
    if ($confirm -notmatch '^(y|yes)$') {
        Write-Host "Restore cancelled by user. No changes were made." -ForegroundColor Yellow
        exit 0
    }

    Write-Host "`nApplying snapshot into 'omp-portable' profile..." -ForegroundColor Gray

    # Stage 2: Restore
    $restoreInput = @{
        passphrase = $passPlain
        confirmedSha256 = $summary.sha256
    } | ConvertTo-Json -Compress

    $restoreProcInfo = New-Object System.Diagnostics.ProcessStartInfo
    $restoreProcInfo.FileName = "bun"
    $restoreProcInfo.Arguments = "run `"$helperScript`" import --snapshot `"$SnapshotPath`""
    $restoreProcInfo.RedirectStandardInput = $true
    $restoreProcInfo.RedirectStandardOutput = $true
    $restoreProcInfo.RedirectStandardError = $true
    $restoreProcInfo.UseShellExecute = $false

    $restoreProc = [System.Diagnostics.Process]::Start($restoreProcInfo)
    $restoreProc.StandardInput.WriteLine($restoreInput)
    $restoreProc.StandardInput.Close()

    $restoreStdout = $restoreProc.StandardOutput.ReadToEnd()
    $restoreStderr = $restoreProc.StandardError.ReadToEnd()
    $restoreProc.WaitForExit()

    if ($restoreProc.ExitCode -ne 0) {
        $errMsg = $restoreStderr.Trim()
        if (-not $errMsg) { $errMsg = $restoreStdout.Trim() }
        Write-Error "Restore operation failed (exit code $($restoreProc.ExitCode)): $errMsg"
        exit $restoreProc.ExitCode
    }

    $result = $restoreStdout | ConvertFrom-Json
    if (-not $result.success) {
        Write-Error "Restore helper reported failure: $($result.error)"
        exit 1
    }

    Write-Host "`n=== Restore Succeeded ===" -ForegroundColor Green
    Write-Host "Restored locally; provider authentication not yet verified." -ForegroundColor Green
    if ($result.recoveryPath) {
        Write-Host "Recovery snapshot saved at: $($result.recoveryPath)" -ForegroundColor DarkCyan
    }
    Write-Host "Launch with: .\start-omp-direct.ps1" -ForegroundColor Cyan
}
finally {
    if ($bstr) { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    $passPlain = $null
}
