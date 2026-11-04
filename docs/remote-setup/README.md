# Remote DSH setup (any PC: PC2, PC3, ...)

Connect DSH on this PC to the OMP gateway on the primary PC through the
Cloudflare tunnel. No Cloudflare software is needed here: DSH talks direct
HTTPS to the tunnel hostname.

- Tunnel hostname: `https://<your-tunnel-host>`
- Gateway model: `google-antigravity/gemini-3.8-flash`
- Local model label in DSH: `Gemini 3.8 Flash (OMP)`

## Fast path: paste the pack (5 minutes)

**On the primary**, generate one copy-paste block (secrets come from env,
so nothing is typed by hand):

```powershell
bun run gateway:ctl remote-pack dsh --base-url=https://<your-tunnel-host>
```

Send the output to the remote PC over a channel you trust. It prints
secrets: never commit it, never forward it further.

**On this PC**, the pack has three numbered blocks:

1. Paste the env block (PowerShell `setx`, or the `export` alternative),
   then sign out/in (Windows) or open a new shell.
2. Save the patch block as the home-level file — exact name
   `cordis.patch.yml` (NOT the desktop profile patch, NOT `corids`):
   - Windows: `C:\Users\<you>\.dsh\cordis.patch.yml`
   - macOS / Linux: `~/.dsh/cordis.patch.yml`
3. Quit DSH Desktop completely (tray icon too), relaunch, open a new chat,
   and send the verify prompt from the pack (`Reply with exactly: PC2-OK`).

**PC3 and beyond:** the same pack works on every machine. For per-machine
revocation, issue a dedicated token on the primary
(`gateway:ctl clients-add dsh-pc3`), then generate that PC's pack with
`--gateway-token=<the-new-token>`.

## Fetching models from here

List every served model id as JSON (for updating harness configs):

```powershell
$gwHeaders = @{
  'CF-Access-Client-Id'=$env:OMP_CF_CLIENT_ID;
  'CF-Access-Client-Secret'=$env:OMP_CF_CLIENT_SECRET;
  Authorization="Bearer $env:OMP_GATEWAY_TOKEN"
}
Invoke-RestMethod -Headers $gwHeaders https://<your-tunnel-host>/v1/models |
  ConvertTo-Json -Depth 5
```

Raw body instead: `(Invoke-WebRequest -Headers $gwHeaders
https://<your-tunnel-host>/v1/models).Content`. Re-fetch after an OMP
upgrade (new models) or a new provider credential (new prefixes);
otherwise ids are stable.

## Manual reference (without the pack)

Secrets (primary): Access Client ID + Secret from `~/.omp/cf-access.json`,
DSH gateway token `omp_gw_...` (shown once at `clients-add`).

Env (set once; the patch reads all three, so they are never pasted again):

```powershell
setx OMP_GATEWAY_TOKEN "omp_gw_<paste-dsh-token>"
setx OMP_CF_CLIENT_ID "<paste-access-client-id>"
setx OMP_CF_CLIENT_SECRET "<paste-access-client-secret>"
```

Patch (`$DSH_HOME/cordis.patch.yml`):

```yaml
# $DSH_HOME/cordis.patch.yml — remote OMP gateway via Cloudflare.
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      omp-gateway:
        displayName: OMP Gateway
        apiKeyEnv: OMP_GATEWAY_TOKEN
        api: openai-completions
        baseURL: https://<your-tunnel-host>/v1
        headers:
          CF-Access-Client-Id: !!js process.env.OMP_CF_CLIENT_ID
          CF-Access-Client-Secret: !!js process.env.OMP_CF_CLIENT_SECRET
        models:
          - id: google-antigravity/gemini-3.8-flash
            name: google-antigravity/gemini-3.8-flash (OMP)
            contextWindow: 1048576
            maxTokens: 65536
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: omp-gateway
    model: google-antigravity/gemini-3.8-flash
```

Why this shape: DSH's DeepSeek-native route sends `x-api-key`, which the
gateway rejects. The pi-ai hand-declared route speaks OpenAI chat
completions with a Bearer [REDACTED] carries the Access service token.

Headless check (Desktop-bundled command, same composition as the app):

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" --profile headless "Reply with exactly: PC2-OK"
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `403` / Access error page | Access headers missing or wrong | Re-check `OMP_CF_CLIENT_ID` / `OMP_CF_CLIENT_SECRET` (restart DSH after changing them) |
| `401 Unauthorized` | Gateway token missing or wrong | Re-check `OMP_GATEWAY_TOKEN` (restart DSH after changing it) |
| Model not listed / default unchanged | Patch not loaded | File must be `$DSH_HOME/cordis.patch.yml` (home level), then restart DSH |
| Patch silently ignored | Filename typo (`corids`, `.yaml` vs `.yml` mixups) | Exact name: `cordis.patch.yml` |
| Timeouts | Primary PC asleep or tunnel down | Wake the primary; on it run `gateway:ctl status --with-tunnel` |

## Revoking a PC

On the primary: `gateway:ctl clients-revoke dsh` immediately cuts every
machine sharing the token (reissue with `clients-add dsh` and update the
remaining PCs). Prefer per-machine tokens (`dsh-pc2`, `dsh-pc3`, ...) so
one revocation touches one PC. The Access service token can also be rolled
from the Zero Trust dashboard (Access → Service Tokens); every PC's env
must then be updated.
