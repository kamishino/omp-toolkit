# Remote DSH setup (second PC)

Connect DSH on this PC to the OMP gateway running on the primary PC through
the Cloudflare tunnel. No Cloudflare software is needed here: DSH talks
direct HTTPS to the tunnel hostname.

- Tunnel hostname: `https://<your-tunnel-host>`
- Gateway model: `google-antigravity/gemini-3.8-flash`
- Local model label in DSH: `Gemini 3.8 Flash (OMP)`

## 1. Collect the three secrets (from the primary PC)

| Secret | Where it lives on the primary |
|---|---|
| Access Client ID | `~/.omp/cf-access.json` → `clientId` |
| Access Client Secret | `~/.omp/cf-access.json` → `clientSecret` |
| DSH gateway token | `omp_gw_...` (shown once when issued; keep it with the Access file) |

Copy them over a channel you trust. They grant model access; treat the
Access secret like a password.

## 2. Set the gateway token env var

DSH resolves its gateway key from the `OMP_GATEWAY_TOKEN` environment
variable (launch environment wins over every other credential layer).

Windows (PowerShell, then sign out and back in, or restart DSH Desktop):

```powershell
setx OMP_GATEWAY_TOKEN "omp_gw_<paste-dsh-token>"
```

macOS / Linux (then start DSH from a new shell):

```sh
export OMP_GATEWAY_TOKEN="omp_gw_<paste-dsh-token>"
```

## 3. Write the DSH home patch

Create or replace the home-level patch file (NOT the desktop profile patch):

- Windows: `C:\Users\<you>\.dsh\cordis.patch.yml`
- macOS / Linux: `~/.dsh/cordis.patch.yml`

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
          CF-Access-Client-Id: <paste-access-client-id>
          CF-Access-Client-Secret: <paste-access-client-secret>
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

## 4. Restart DSH and verify

1. Quit DSH Desktop completely and start it again (env vars and the home
   patch are read at launch).
2. Open a new chat. The model selector should offer
   `google-antigravity/gemini-3.8-flash (OMP)` as the default.
3. Send: `Reply with exactly: PC2-OK`.

Headless check instead (uses the Desktop-bundled command, same composition):

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" --profile headless "Reply with exactly: PC2-OK"
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `403` / Access error page | Access headers missing or wrong | Re-check the Client ID and Secret in the patch |
| `401 Unauthorized` | Gateway token missing or wrong | Re-check `OMP_GATEWAY_TOKEN` (restart DSH after changing it) |
| Model not listed / default unchanged | Patch not loaded | File must be `$DSH_HOME/cordis.patch.yml` (home level), then restart DSH |
| Timeouts | Primary PC asleep or tunnel down | Wake the primary; on it run `gateway:ctl status --with-tunnel` |

## Revoking this PC

On the primary: `gateway:ctl clients-revoke dsh` immediately cuts every
machine sharing the token (reissue with `clients-add dsh` and update the
remaining PCs). For finer control, issue a per-machine token instead and
swap it into step 2. The Access service token can also be rolled from the
Zero Trust dashboard (Access → Service Tokens).
