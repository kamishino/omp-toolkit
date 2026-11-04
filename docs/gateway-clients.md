# Gateway Clients (Loopback)

How agent harnesses use the OMP gateway on this machine. Design:
[Gateway Control Plane](gateway-control-plane.md) / [ADR-0010](adr/0010-gateway-control-plane-over-omp.md).
Generate any snippet with `bun run gateway:ctl recipe [platform]` (placeholder
token; substitute a scoped client token from `gateway:ctl clients-add <name>`,
shown once at creation).

## The universal rule

Every harness below reduces to three settings:

| Setting | Value |
|---|---|
| Base URL | `http://127.0.0.1:4000` for Anthropic, `http://127.0.0.1:4000/v1` for OpenAI protocols |
| API key | A scoped client token (`omp_gw_…`) or the master gateway token |
| Model id | Any id from `GET /v1/models`, passed through unchanged (e.g. `google-antigravity/gemini-3.8-flash`) |

One token per harness or machine: the token is also the account-pin unit, so
each harness sticks to one account and rotates only on quota/auth failure.

## Which model is correct (verified 2026-11-03/04)

Tool calling is model-sensitive. Gemini 2.5 backends enforce
`thought_signature` round-tripping that Anthropic translation and AI-SDK
clients drop, failing turn 2 with `400`; Codex (Responses) additionally
breaks Gemini tool continuation ("Requests ending with a model turn").
Verified tool-safe defaults, already baked into the recipes:

| Harness path | Verified tool model | Also fine |
|---|---|---|
| Anthropic: Muse | `google-antigravity/gemini-3.8-flash` | `google-antigravity/claude-sonnet-4-6` |
| OpenAI Chat: OpenCode, Cline, pi | `google-antigravity/gemini-3.8-flash` | 2.5 only with raw SDK replay preserving `extra_content` |
| Responses: Codex | `google-antigravity/claude-sonnet-4-6` | Gemini backends: text only |

Text-only turns work on every model. When in doubt, take the recipe default.

## Compatibility matrix

Status key: **Verified** = run end-to-end on this machine (tool turn, exit 0).
**Documented** = config shape taken from the tool's own docs; not run here.

| Harness | Protocol | Where the config lives | Generate | Status |
|---|---|---|---|---|
| Muse | Anthropic Messages | env vars (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, model slots) | `recipe claude-code` | Verified (2 turns, Bash) |
| Muse | OpenAI Responses | `~/.codex/config.toml` `[model_providers.*]`, `wire_api = "responses"` | `recipe codex` | Verified on Claude backend; Gemini tool turns fail upstream |
| OpenCode | OpenAI Chat (AI SDK) | `opencode.json` `@ai-sdk/openai-compatible` | `recipe opencode` | Verified (bash tool) |
| pi / Pi-family | OpenAI Chat | `~/.pi/agent/models.json`, `api: "openai-completions"` | `recipe pi` | Verified (bash tool) |
| Cline (CLI + VS Code) | OpenAI Compatible | `cline auth openai -b … -k … -m …` / extension settings | `recipe cline` | Verified CLI (tool run) |
| Aider | OpenAI Chat (LiteLLM) | `~/.aider.conf.yml`, model prefixed `openai/<id>` | `recipe aider` | Documented |
| Goose | OpenAI provider, custom host | `goose configure`, `OPENAI_HOST` + `OPENAI_BASE_PATH` | `recipe goose` | Documented |
| Crush | `openai-compat` provider | `crush.json` | `recipe crush` | Documented |
| Qwen Code | OpenAI Compatible | env `OPENAI_BASE_URL/API_KEY/MODEL` | `recipe qwen-code` | Documented |
| Hermes Agent | Custom endpoint (OpenAI Chat) | `~/.hermes/config.yaml` `model.provider: "custom"` | `recipe hermes` | Documented |
| DeepSeek Harness (`dsh`) | OpenAI Chat (pi-ai `openai-completions` route) | `$DSH_HOME/cordis.patch.yml` home patch + `OMP_GATEWAY_TOKEN` env | `recipe dsh` | Verified live (headless `GATEWAY-OK`); DeepSeek-native route unusable (`x-api-key` 401s) |
| Roo Code / Kilo Code | OpenAI Compatible (same settings family as Cline) | extension settings: base URL + key + model id | same values as Cline | Documented |
| Continue | OpenAI provider | `config.yaml` models entry with `apiBase` | `recipe vscode-continue` | Documented |
| Cursor | OpenAI API key + base URL override | Settings -> Models; add the model id manually | universal rule above | Documented; some Cursor cloud features bypass custom endpoints |
| Zed | `openai_compatible` language model | `settings.json` | universal rule above | Documented |
| Any SDK agent (OpenAI / Anthropic / Vercel AI / LangGraph) | either | `baseURL` client option | `recipe python-openai` / `python-anthropic` | Verified at protocol level |
| OMP / Oh My Pi itself | native | already uses the broker; nothing to do | — | Native |

### Tools that cannot use this gateway

- **Gemini CLI / Antigravity CLI in Google OAuth mode** talk to Google
  directly with their own auth; there is no custom base-URL seam for the
  pooled accounts. (API-key modes that accept a custom Generative Language
  endpoint still don't speak Chat Completions, so they don't fit either.)
- **Closed cloud agents without BYOK/custom endpoints** (e.g. hosted-only
  modes of Copilot, Amp, or Droid): if the tool offers no base-URL setting,
  no gateway can interpose. Check for "OpenAI Compatible", "Custom
  endpoint", or "BYOK" in its settings — that field is the whole test.

## Daily-driver setup

- Gateways are managed by the Bun control plane:
  `bun run gateway:ctl doctor|start|stop|status|accounts|pool` (inside OMP,
  `/gateway <action>` delegates to the same ctl).
- Start at sign-in (Windows, no elevation):
  `bun run gateway:ctl autostart-install` writes a hidden Startup-folder
  launcher; `autostart-status` / `autostart-remove` inspect and undo it.
  Re-run install after moving the checkout.
- Local ready-made packs with live tokens belong outside the repo (for
  example `~/.omp/client-packs/`). Never commit them.

## Scoped tokens

```powershell
bun run gateway:ctl clients-add claude-code --models=google-antigravity/*
bun run gateway:ctl clients-revoke claude-code
```

Scoped tokens only work when the gateway runs with `--clients` pointing at
the clients file. Gateways started by `gateway:ctl start` do;
`gateway:ctl doctor` FAILs a running gateway whose argv does not.

For remote (Cloudflare) deployments, see
[OMP Auth Gateway + Cloudflare](auth-gateway-cloudflare.md).
