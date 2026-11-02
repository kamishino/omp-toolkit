<#
.SYNOPSIS
    OMP Auth Gateway & Broker Service Manager with Cloudflare Tunnel & Access Integration.
.DESCRIPTION
    Manages the lifecycle of omp auth-broker and omp auth-gateway daemons on Windows,
    integrates with Cloudflare Argo Tunnel, and provides health checks, diagnostic
    testing, and client configuration recipes.
.EXAMPLE
    .\omp-gateway.ps1 start
    .\omp-gateway.ps1 status
    .\omp-gateway.ps1 test
    .\omp-gateway.ps1 client-config
    .\omp-gateway.ps1 stop
#>

[CmdletBinding()]
param (
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'test', 'token', 'client-config', 'client-add', 'client-list', 'client-revoke', 'client-pack', 'logs')]
    [string]$Action = 'status',

    [Parameter()]
    [int]$BrokerPort = 8765,

    [Parameter()]
    [int]$GatewayPort = 4000,

    [Parameter()]
    [string]$Domain = $(if ($env:OMP_GATEWAY_DOMAIN) { $env:OMP_GATEWAY_DOMAIN } else { 'gateway.example.com' }),

    [Parameter()]
    [string]$CfClientId = '',

    [Parameter()]
    [string]$CfClientSecret = '',
    [Parameter(Position = 1)]
    [string]$ClientName = '',

    [Parameter()]
    [string]$Models = 'google-antigravity/*,deepseek/*'
)

$ErrorActionPreference = 'Stop'

# --- Paths & Directories ---
$HomeDir      = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
$OmpDir       = Join-Path $HomeDir ".omp"
$RunDir       = Join-Path $OmpDir "run"
$LogDir       = Join-Path $OmpDir "logs"

$BrokerPidFile   = Join-Path $RunDir "auth-broker.pid"
$GatewayPidFile  = Join-Path $RunDir "auth-gateway.pid"
$BrokerLogFile   = Join-Path $LogDir "auth-broker.log"
$BrokerErrFile   = Join-Path $LogDir "auth-broker.err.log"
$GatewayLogFile  = Join-Path $LogDir "auth-gateway.log"
$GatewayErrFile  = Join-Path $LogDir "auth-gateway.err.log"

$BrokerTokenFile  = Join-Path $OmpDir "auth-broker.token"
$GatewayTokenFile = Join-Path $OmpDir "auth-gateway.token"
$CfAccessFile     = Join-Path $OmpDir "cf-access.json"
$ClientsFile     = Join-Path $OmpDir "gateway-clients.json"

# --- Binaries ---
$OmpBin = Join-Path $HomeDir "AppData\Local\omp\omp.exe"
if (-not (Test-Path $OmpBin)) {
    $found = Get-Command omp -ErrorAction SilentlyContinue
    if ($found) { $OmpBin = $found.Source }
}
if (-not $OmpBin -or -not (Test-Path $OmpBin)) {
    Write-Error "omp.exe not found at $OmpBin or in system PATH."
    exit 1
}

$CloudflaredBin = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $CloudflaredBin)) {
    $found = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($found) { $CloudflaredBin = $found.Source }
}

# Ensure runtime directories exist
if (-not (Test-Path $RunDir)) { New-Item -ItemType Directory -Path $RunDir -Force | Out-Null }
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

# --- Helper Functions ---

function Get-CfAccessCredentials {
    $cid = $CfClientId
    $sec = $CfClientSecret

    if (-not $cid -and $env:CF_ACCESS_CLIENT_ID) { $cid = $env:CF_ACCESS_CLIENT_ID }
    if (-not $sec -and $env:CF_ACCESS_CLIENT_SECRET) { $sec = $env:CF_ACCESS_CLIENT_SECRET }

    if ((-not $cid -or -not $sec) -and (Test-Path $CfAccessFile)) {
        try {
            $raw = Get-Content $CfAccessFile -Raw | ConvertFrom-Json
            if (-not $cid -and $raw.clientId) { $cid = $raw.clientId }
            if (-not $sec -and $raw.clientSecret) { $sec = $raw.clientSecret }
        } catch { }
    }
    return @{ ClientId = $cid; ClientSecret = $sec }
}

function Test-PortListening([int]$Port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        return ($null -ne $conn -and $conn.Count -gt 0)
    } catch {
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $async = $tcp.BeginConnect("127.0.0.1", $Port, $null, $null)
            $wait = $async.AsyncWaitHandle.WaitOne(300, $false)
            if ($wait -and $tcp.Connected) {
                $tcp.EndConnect($async)
                $tcp.Close()
                return $true
            }
            $tcp.Close()
        } catch { }
        return $false
    }
}

function Wait-HttpEndpoint([string]$Url, [int]$TimeoutSeconds = 15) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 2 -ErrorAction Stop
            if ($resp) { return $true }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

function Get-RunningPid([string]$PidFile) {
    if (Test-Path $PidFile) {
        $id = (Get-Content $PidFile -Raw).Trim()
        if ($id -match '^\d+$') {
            $intId = [int]$id
            $p = Get-Process -Id $intId -ErrorAction SilentlyContinue
            if ($p -and -not $p.HasExited) { return $intId }
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }
    return $null
}

# --- Actions ---

switch ($Action) {
    'start' {
        Write-Host "======================================================" -ForegroundColor Cyan
        Write-Host " [OMP Gateway] Starting Services...                   " -ForegroundColor Cyan
        Write-Host "======================================================" -ForegroundColor Cyan

        # 1. Check Broker
        $brokerRunningPid = Get-RunningPid $BrokerPidFile
        if ($brokerRunningPid) {
            Write-Host " [OK] Auth Broker is already running (PID: $brokerRunningPid)" -ForegroundColor Green
        } else {
            if (Test-PortListening $BrokerPort) {
                Write-Host " [WARN] Port $BrokerPort is already in use by an unmanaged process." -ForegroundColor Yellow
            } else {
                Write-Host " [*] Launching Auth Broker on 127.0.0.1:$BrokerPort..." -ForegroundColor Cyan
                $brokerProc = Start-Process -FilePath $OmpBin `
                    -ArgumentList "auth-broker serve --bind=127.0.0.1:$BrokerPort" `
                    -RedirectStandardOutput $BrokerLogFile `
                    -RedirectStandardError $BrokerErrFile `
                    -WindowStyle Hidden -PassThru

                Set-Content -Path $BrokerPidFile -Value $brokerProc.Id -Force
                Write-Host " [*] Auth Broker process started with PID $($brokerProc.Id). Awaiting liveness..." -ForegroundColor DarkGray

                $healthy = Wait-HttpEndpoint "http://127.0.0.1:$BrokerPort/v1/healthz" 15
                if (-not $healthy) {
                    Write-Error "Auth Broker failed to respond on http://127.0.0.1:$BrokerPort/v1/healthz within 15 seconds.`nCheck $BrokerLogFile."
                    exit 1
                }
                Write-Host " [OK] Auth Broker is healthy on http://127.0.0.1:$BrokerPort" -ForegroundColor Green
            }
        }

        # 2. Resolve Broker Token
        if (-not (Test-Path $BrokerTokenFile)) {
            Write-Host " [*] Minting Auth Broker token..." -ForegroundColor Cyan
            & $OmpBin auth-broker token | Out-Null
        }
        $brokerToken = if (Test-Path $BrokerTokenFile) { (Get-Content $BrokerTokenFile -Raw).Trim() } else { "" }

        # 3. Check Gateway
        $gatewayRunningPid = Get-RunningPid $GatewayPidFile
        if ($gatewayRunningPid) {
            Write-Host " [OK] Auth Gateway is already running (PID: $gatewayRunningPid)" -ForegroundColor Green
        } else {
            if (Test-PortListening $GatewayPort) {
                Write-Host " [WARN] Port $GatewayPort is already in use by an unmanaged process." -ForegroundColor Yellow
            } else {
                Write-Host " [*] Launching Auth Gateway on 127.0.0.1:$GatewayPort (with --trust-proxy-headers)..." -ForegroundColor Cyan

                $env:OMP_AUTH_BROKER_URL   = "http://127.0.0.1:$BrokerPort"
                $env:OMP_AUTH_BROKER_TOKEN = $brokerToken

                if (-not (Test-Path $ClientsFile)) {
                    "{}" | Set-Content -Path $ClientsFile -Force
                }
                $gwArgs = "auth-gateway serve --bind=127.0.0.1:$GatewayPort --trust-proxy-headers --clients=`"$ClientsFile`""
                $gwProc = Start-Process -FilePath $OmpBin `
                    -ArgumentList $gwArgs `
                    -RedirectStandardOutput $GatewayLogFile `
                    -RedirectStandardError $GatewayErrFile `
                    -WindowStyle Hidden -PassThru

                Set-Content -Path $GatewayPidFile -Value $gwProc.Id -Force
                Write-Host " [*] Auth Gateway process started with PID $($gwProc.Id). Awaiting liveness..." -ForegroundColor DarkGray

                $healthy = Wait-HttpEndpoint "http://127.0.0.1:$GatewayPort/healthz" 15
                if (-not $healthy) {
                    Write-Error "Auth Gateway failed to respond on http://127.0.0.1:$GatewayPort/healthz within 15 seconds.`nCheck $GatewayLogFile."
                    exit 1
                }
                Write-Host " [OK] Auth Gateway is healthy on http://127.0.0.1:$GatewayPort" -ForegroundColor Green
            }
        }

        # 4. Gateway Token
        $gwToken = if (Test-Path $GatewayTokenFile) { (Get-Content $GatewayTokenFile -Raw).Trim() } else { "" }
        if (-not $gwToken) {
            $gwToken = (& $OmpBin auth-gateway token).Trim()
        }

        Write-Host ""
        Write-Host "======================================================" -ForegroundColor Green
        Write-Host " [OMP Gateway] All Services Running Successfully!     " -ForegroundColor Green
        Write-Host "======================================================" -ForegroundColor Green
        Write-Host "  Local Broker : http://127.0.0.1:$BrokerPort"
        Write-Host "  Local Gateway: http://127.0.0.1:$GatewayPort"
        Write-Host "  Public Domain: https://$Domain"
        Write-Host "  Bearer Token : $gwToken"
        Write-Host "======================================================" -ForegroundColor Green
    }

    'stop' {
        Write-Host " [*] Stopping OMP Gateway & Broker..." -ForegroundColor Cyan

        $gwPid = Get-RunningPid $GatewayPidFile
        if ($gwPid) {
            Write-Host " [*] Terminating Auth Gateway (PID: $gwPid)..." -ForegroundColor DarkGray
            Stop-Process -Id $gwPid -Force -ErrorAction SilentlyContinue
            Remove-Item $GatewayPidFile -Force -ErrorAction SilentlyContinue
        }

        $brPid = Get-RunningPid $BrokerPidFile
        if ($brPid) {
            Write-Host " [*] Terminating Auth Broker (PID: $brPid)..." -ForegroundColor DarkGray
            Stop-Process -Id $brPid -Force -ErrorAction SilentlyContinue
            Remove-Item $BrokerPidFile -Force -ErrorAction SilentlyContinue
        }

        Write-Host " [OK] All OMP Gateway services stopped." -ForegroundColor Green
    }

    'restart' {
        & $PSCommandPath stop
        Start-Sleep -Seconds 1
        & $PSCommandPath start
    }

    'status' {
        Write-Host "======================================================" -ForegroundColor Cyan
        Write-Host " [OMP Gateway] System Status & Health Diagnostics      " -ForegroundColor Cyan
        Write-Host "======================================================" -ForegroundColor Cyan

        # 1. Broker Local Status
        $brPid = Get-RunningPid $BrokerPidFile
        $brListen = Test-PortListening $BrokerPort
        Write-Host " 1. Auth Broker (127.0.0.1:$BrokerPort):" -ForegroundColor White
        Write-Host "    - PID: $(if ($brPid) { $brPid } else { 'Not tracked' }) | Port Listening: $brListen"
        try {
            $brHealth = Invoke-RestMethod "http://127.0.0.1:$BrokerPort/v1/healthz" -TimeoutSec 2 -ErrorAction Stop
            Write-Host "    - Healthz: OK (version $($brHealth.version), ready=$($brHealth.ready))" -ForegroundColor Green
        } catch {
            Write-Host "    - Healthz: UNREACHABLE ($($_.Exception.Message))" -ForegroundColor Red
        }

        # 2. Gateway Local Status
        $gwPid = Get-RunningPid $GatewayPidFile
        $gwListen = Test-PortListening $GatewayPort
        Write-Host "`n 2. Auth Gateway (127.0.0.1:$GatewayPort):" -ForegroundColor White
        Write-Host "    - PID: $(if ($gwPid) { $gwPid } else { 'Not tracked' }) | Port Listening: $gwListen"
        try {
            $gwHealth = Invoke-RestMethod "http://127.0.0.1:$GatewayPort/healthz" -TimeoutSec 2 -ErrorAction Stop
            Write-Host "    - Healthz: OK (version $($gwHealth.version), ready=$($gwHealth.ready))" -ForegroundColor Green
        } catch {
            Write-Host "    - Healthz: UNREACHABLE ($($_.Exception.Message))" -ForegroundColor Red
        }

        # 3. Model Catalog
        $gwToken = if (Test-Path $GatewayTokenFile) { (Get-Content $GatewayTokenFile -Raw).Trim() } else { "" }
        if ($gwToken) {
            try {
                $headers = @{ "Authorization" = "Bearer $gwToken" }
                $modelsResp = Invoke-RestMethod "http://127.0.0.1:$GatewayPort/v1/models" -Headers $headers -TimeoutSec 3 -ErrorAction Stop
                $count = if ($modelsResp.data) { $modelsResp.data.Count } else { 0 }
                Write-Host "    - Stored Models: $count models available via local gateway" -ForegroundColor Green
            } catch {
                Write-Host "    - Model Catalog query failed: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }

        # 4. Cloudflared Tunnel Status
        Write-Host "`n 3. Cloudflare Argo Tunnel (cloudflared.exe):" -ForegroundColor White
        $cfProc = Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue
        if ($cfProc) {
            Write-Host "    - Tunnel Process: RUNNING (PID: $($cfProc.Id -join ', '))" -ForegroundColor Green
        } else {
            Write-Host "    - Tunnel Process: NOT RUNNING" -ForegroundColor Red
        }

        # 5. Public Endpoint & Cloudflare Access (Two-Tier Check)
        Write-Host "`n 4. Public Ingress (https://$Domain):" -ForegroundColor White
        try {
            $null = Invoke-WebRequest -Uri "https://$Domain/healthz" -TimeoutSec 3 -ErrorAction Stop
            Write-Host "    - Gate 1 (Perimeter Security): Open / Reachable" -ForegroundColor Yellow
        } catch {
            $status = $_.Exception.Response.StatusCode.value__
            if ($status -eq 403 -or $status -eq 302) {
                Write-Host "    - Gate 1 (Perimeter Security): PROTECTED (Cloudflare Access blocks unauthenticated requests with HTTP $status)" -ForegroundColor Green
            } else {
                Write-Host "    - Gate 1 Probe: Returned HTTP $status ($($_.Exception.Message))" -ForegroundColor Yellow
            }
        }

        $cfCreds = Get-CfAccessCredentials
        if ($cfCreds.ClientId -and $cfCreds.ClientSecret) {
            try {
                $cfHeaders = @{
                    "CF-Access-Client-Id"     = $cfCreds.ClientId
                    "CF-Access-Client-Secret" = $cfCreds.ClientSecret
                }
                $pubHealth = Invoke-RestMethod -Uri "https://$Domain/healthz" -Headers $cfHeaders -TimeoutSec 4 -ErrorAction Stop
                Write-Host "    - Gate 1 (With Service Token): SUCCESS (Admitted by Cloudflare Access, healthz ready=$($pubHealth.ready))" -ForegroundColor Green
            } catch {
                Write-Host "    - Gate 1 (With Service Token): FAILED ($($_.Exception.Message))" -ForegroundColor Red
            }
        } else {
            Write-Host "    - Service Token: Not configured in cf-access.json. Run '.\omp-gateway.ps1 client-config' for setup instructions." -ForegroundColor DarkGray
        }

        Write-Host "======================================================" -ForegroundColor Cyan
    }

    'test' {
        Write-Host "======================================================" -ForegroundColor Cyan
        Write-Host " [OMP Gateway] Running Live Inference Tests           " -ForegroundColor Cyan
        Write-Host "======================================================" -ForegroundColor Cyan

        $gwToken = if (Test-Path $GatewayTokenFile) { (Get-Content $GatewayTokenFile -Raw).Trim() } else { "" }
        if (-not $gwToken) {
            Write-Error "Gateway token not found at $GatewayTokenFile. Ensure gateway has run once."
            exit 1
        }

        # Test 1: Local Loopback Inference
        Write-Host "`n[Test 1] Local Gateway Chat Completion (127.0.0.1:$GatewayPort)..." -ForegroundColor White
        $testPayload = @{
            model = "google-antigravity/gemini-3.8-flash"
            messages = @(
                @{ role = "user"; content = "Respond in 5 words or fewer: OMP Local Gateway status." }
            )
            max_tokens = 20
        } | ConvertTo-Json -Compress

        try {
            $localResp = Invoke-RestMethod -Uri "http://127.0.0.1:$GatewayPort/v1/chat/completions" `
                -Method Post `
                -Headers @{ "Authorization" = "Bearer $gwToken"; "Content-Type" = "application/json" } `
                -Body $testPayload `
                -TimeoutSec 15 -ErrorAction Stop

            $reply = $localResp.choices[0].message.content
            Write-Host " [PASS] Local Response: $reply" -ForegroundColor Green
        } catch {
            Write-Host " [FAIL] Local Test Failed: $($_.Exception.Message)" -ForegroundColor Red
            if ($_.Exception.Response) {
                $stream = $_.Exception.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                Write-Host " Response Body: $($reader.ReadToEnd())" -ForegroundColor Red
            }
        }

        # Test 2: Public WAN Inference with Cloudflare Access
        Write-Host "`n[Test 2] Public Cloudflare Ingress (https://$Domain)..." -ForegroundColor White
        $cfCreds = Get-CfAccessCredentials
        if (-not $cfCreds.ClientId -or -not $cfCreds.ClientSecret) {
            Write-Host " [SKIP] Public test skipped: Cloudflare Access Client ID and Secret not configured." -ForegroundColor Yellow
            Write-Host "        Populate ~/.omp/cf-access.json with 'clientId' and 'clientSecret' to test public WAN route." -ForegroundColor DarkGray
        } else {
            try {
                $pubHeaders = @{
                    "CF-Access-Client-Id"     = $cfCreds.ClientId
                    "CF-Access-Client-Secret" = $cfCreds.ClientSecret
                    "Authorization"           = "Bearer $gwToken"
                    "Content-Type"            = "application/json"
                }

                $pubResp = Invoke-RestMethod -Uri "https://$Domain/v1/chat/completions" `
                    -Method Post `
                    -Headers $pubHeaders `
                    -Body $testPayload `
                    -TimeoutSec 20 -ErrorAction Stop

                $pubReply = $pubResp.choices[0].message.content
                Write-Host " [PASS] Public WAN Response: $pubReply" -ForegroundColor Green
            } catch {
                Write-Host " [FAIL] Public WAN Test Failed: $($_.Exception.Message)" -ForegroundColor Red
                if ($_.Exception.Response) {
                    $stream = $_.Exception.Response.GetResponseStream()
                    $reader = New-Object System.IO.StreamReader($stream)
                    Write-Host " Response Body: $($reader.ReadToEnd())" -ForegroundColor Red
                }
            }
        }
        Write-Host "`n======================================================" -ForegroundColor Cyan
    }

    'token' {
        if (Test-Path $GatewayTokenFile) {
            (Get-Content $GatewayTokenFile -Raw).Trim()
        } else {
            (& $OmpBin auth-gateway token).Trim()
        }
    }

    'client-config' {
        $gwToken = if (Test-Path $GatewayTokenFile) { (Get-Content $GatewayTokenFile -Raw).Trim() } else { "<YOUR_OMP_GATEWAY_TOKEN>" }
        $cfCreds = Get-CfAccessCredentials
        $cid = if ($cfCreds.ClientId) { $cfCreds.ClientId } else { "<YOUR_CF_ACCESS_CLIENT_ID>" }
        $sec = if ($cfCreds.ClientSecret) { $cfCreds.ClientSecret } else { "<YOUR_CF_ACCESS_CLIENT_SECRET>" }

        Write-Host "======================================================" -ForegroundColor Cyan
        Write-Host " [OMP Gateway] Client Configuration Quick Recipes     " -ForegroundColor Cyan
        Write-Host "======================================================" -ForegroundColor Cyan

        Write-Host "`n--- 1. cURL (Bash / Terminal) ---" -ForegroundColor Yellow
@"
curl -X POST https://$Domain/v1/chat/completions \
  -H "CF-Access-Client-Id: $cid" \
  -H "CF-Access-Client-Secret: $sec" \
  -H "Authorization: Bearer $gwToken" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google-antigravity/gemini-3.8-flash",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
"@

        Write-Host "`n--- 2. Python (OpenAI SDK) ---" -ForegroundColor Yellow
@"
from openai import OpenAI

client = OpenAI(
    base_url="https://$Domain/v1",
    api_key="$gwToken",
    default_headers={
        "CF-Access-Client-Id": "$cid",
        "CF-Access-Client-Secret": "$sec",
    },
)

response = client.chat.completions.create(
    model="google-antigravity/gemini-3.8-flash",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True,
)
for chunk in response:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
"@

        Write-Host "`n--- 3. Python (Anthropic SDK) ---" -ForegroundColor Yellow
@"
import anthropic

client = anthropic.Anthropic(
    base_url="https://$Domain",
    api_key="$gwToken",
    default_headers={
        "CF-Access-Client-Id": "$cid",
        "CF-Access-Client-Secret": "$sec",
    },
)

message = client.messages.create(
    model="google-antigravity/gemini-3.8-flash",
    max_tokens=1000,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)
"@

        Write-Host "`n--- 4. VS Code Extensions (Continue / Cline config.json) ---" -ForegroundColor Yellow
@"
{
  "models": [
    {
      "title": "Gemini 3.8 Flash (OMP Gateway)",
      "provider": "openai",
      "model": "google-antigravity/gemini-3.8-flash",
      "apiBase": "https://$Domain/v1",
      "apiKey": "$gwToken",
      "requestOptions": {
        "extraHeaders": {
          "CF-Access-Client-Id": "$cid",
          "CF-Access-Client-Secret": "$sec"
        }
      }
    }
  ]
}
"@
        Write-Host "`n======================================================" -ForegroundColor Cyan
    }

    'client-add' {
        if (-not $ClientName -and $args.Count -gt 0) { $ClientName = $args[0] }
        if (-not $ClientName) {
            Write-Error "Client name is required. Usage: .\omp-gateway.ps1 client-add <client-name> [-Models <models>]"
            exit 1
        }

        $bytes = New-Object byte[] 24
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $hex = [System.BitConverter]::ToString($bytes).Replace("-", "").ToLower()
        $clientToken = "omp_gw_$hex"

        $hasher = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes = $hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($clientToken))
        $hashHex = [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLower()

        $clients = @{}
        if (Test-Path $ClientsFile) {
            try {
                $raw = Get-Content $ClientsFile -Raw | ConvertFrom-Json
                foreach ($prop in $raw.PSObject.Properties) {
                    $clients[$prop.Name] = $prop.Value
                }
            } catch { }
        }

        $modelList = $Models.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
        $clients[$ClientName] = @{
            tokenSha256 = $hashHex
            models      = @($modelList)
        }

        $clients | ConvertTo-Json -Depth 5 | Set-Content -Path $ClientsFile -Force
        Write-Host " [OK] Client '$ClientName' added to $ClientsFile" -ForegroundColor Green
        Write-Host "      Token SHA-256 : $hashHex" -ForegroundColor DarkGray
        Write-Host "      Client Token  : $clientToken" -ForegroundColor Yellow
        Write-Host "      (Token will not be displayed again. Transmit securely to client PC.)" -ForegroundColor DarkGray

        & $PSCommandPath client-pack -ClientName $ClientName
    }

    'client-list' {
        Write-Host "======================================================" -ForegroundColor Cyan
        Write-Host " [OMP Gateway] Registered Client Tokens                " -ForegroundColor Cyan
        Write-Host "======================================================" -ForegroundColor Cyan
        if (-not (Test-Path $ClientsFile)) {
            Write-Host " No scoped clients configured ($ClientsFile not found)." -ForegroundColor DarkGray
        } else {
            try {
                $raw = Get-Content $ClientsFile -Raw | ConvertFrom-Json
                $count = 0
                foreach ($prop in $raw.PSObject.Properties) {
                    $count++
                    $cName = $prop.Name
                    $cSha = $prop.Value.tokenSha256
                    $cModels = if ($prop.Value.models) { ($prop.Value.models -join ", ") } else { "all" }
                    Write-Host " [$count] Client: $cName" -ForegroundColor Yellow
                    Write-Host "     SHA-256: $cSha" -ForegroundColor DarkGray
                    Write-Host "     Models : $cModels" -ForegroundColor White
                }
                if ($count -eq 0) {
                    Write-Host " No clients registered." -ForegroundColor DarkGray
                }
            } catch {
                Write-Host " Error reading ${ClientsFile}: $($_.Exception.Message)" -ForegroundColor Red
            }
        }
        Write-Host "======================================================" -ForegroundColor Cyan
    }

    'client-revoke' {
        if (-not $ClientName -and $args.Count -gt 0) { $ClientName = $args[0] }
        if (-not $ClientName) {
            Write-Error "Client name is required. Usage: .\omp-gateway.ps1 client-revoke <client-name>"
            exit 1
        }
        if (-not (Test-Path $ClientsFile)) {
            Write-Host " Clients file not found at $ClientsFile." -ForegroundColor Yellow
            return
        }
        try {
            $raw = Get-Content $ClientsFile -Raw | ConvertFrom-Json
            $clients = @{}
            $found = $false
            foreach ($prop in $raw.PSObject.Properties) {
                if ($prop.Name -eq $ClientName) {
                    $found = $true
                } else {
                    $clients[$prop.Name] = $prop.Value
                }
            }
            if ($found) {
                $clients | ConvertTo-Json -Depth 5 | Set-Content -Path $ClientsFile -Force
                Write-Host " [OK] Client '$ClientName' revoked from $ClientsFile." -ForegroundColor Green
            } else {
                Write-Host " [WARN] Client '$ClientName' was not found in $ClientsFile." -ForegroundColor Yellow
            }
        } catch {
            Write-Host " Error modifying ${ClientsFile}: $($_.Exception.Message)" -ForegroundColor Red
        }
    }

    'client-pack' {
        if (-not $ClientName -and $args.Count -gt 0) { $ClientName = $args[0] }
        $cName = if ($ClientName) { $ClientName } else { "client-pc" }
        $gwToken = if (Test-Path $GatewayTokenFile) { (Get-Content $GatewayTokenFile -Raw).Trim() } else { "<CLIENT_BEARER_TOKEN>" }
        $cfCreds = Get-CfAccessCredentials
        $cid = if ($cfCreds.ClientId) { $cfCreds.ClientId } else { "<CF_ACCESS_CLIENT_ID>" }
        $sec = if ($cfCreds.ClientSecret) { $cfCreds.ClientSecret } else { "<CF_ACCESS_CLIENT_SECRET>" }

        Write-Host "======================================================" -ForegroundColor Cyan
        Write-Host " [OMP Gateway] Client Setup Pack: $cName              " -ForegroundColor Cyan
        Write-Host "======================================================" -ForegroundColor Cyan
        Write-Host "`n--- 1. Linux/macOS Environment Script (setup-omp-env.sh) ---" -ForegroundColor Yellow
@"
export OPENAI_BASE_URL="https://$Domain/v1"
export OPENAI_API_KEY="$gwToken"
export CF_ACCESS_CLIENT_ID="$cid"
export CF_ACCESS_CLIENT_SECRET="$sec"
"@
        Write-Host "`n--- 2. Windows PowerShell Script (setup-omp-env.ps1) ---" -ForegroundColor Yellow
@"
`$env:OPENAI_BASE_URL = "https://$Domain/v1"
`$env:OPENAI_API_KEY = "$gwToken"
`$env:CF_ACCESS_CLIENT_ID = "$cid"
`$env:CF_ACCESS_CLIENT_SECRET = "$sec"
"@
        Write-Host "`n--- 3. VS Code Continue (~/.continue/config.json) ---" -ForegroundColor Yellow
@"
{
  "models": [
    {
      "title": "Google Gemini 3.8 Flash (OMP Gateway)",
      "provider": "openai",
      "model": "google-antigravity/gemini-3.8-flash",
      "apiBase": "https://$Domain/v1",
      "apiKey": "$gwToken",
      "requestOptions": {
        "headers": {
          "CF-Access-Client-Id": "$cid",
          "CF-Access-Client-Secret": "$sec"
        }
      }
    }
  ]
}
"@
        Write-Host "`n--- 4. cURL Test Command ---" -ForegroundColor Yellow
@"
curl -X POST https://$Domain/v1/chat/completions \
  -H "CF-Access-Client-Id: $cid" \
  -H "CF-Access-Client-Secret: $sec" \
  -H "Authorization: Bearer $gwToken" \
  -H "Content-Type: application/json" \
  -d '{"model": "google-antigravity/gemini-3.8-flash", "messages": [{"role": "user", "content": "Ping"}], "stream": false}'
"@
        Write-Host "`n======================================================" -ForegroundColor Cyan
    }

    'logs' {
        Write-Host "--- Tail of Auth Broker Log ($BrokerLogFile) ---" -ForegroundColor Cyan
        if (Test-Path $BrokerLogFile) { Get-Content $BrokerLogFile -Tail 20 }
        if (Test-Path $BrokerErrFile -and (Get-Item $BrokerErrFile).Length -gt 0) {
            Write-Host "`n--- Tail of Auth Broker Errors ($BrokerErrFile) ---" -ForegroundColor Yellow
            Get-Content $BrokerErrFile -Tail 20
        }
        Write-Host "`n--- Tail of Auth Gateway Log ($GatewayLogFile) ---" -ForegroundColor Cyan
        if (Test-Path $GatewayLogFile) { Get-Content $GatewayLogFile -Tail 20 }
        if (Test-Path $GatewayErrFile -and (Get-Item $GatewayErrFile).Length -gt 0) {
            Write-Host "`n--- Tail of Auth Gateway Errors ($GatewayErrFile) ---" -ForegroundColor Yellow
            Get-Content $GatewayErrFile -Tail 20
        }
    }
}
