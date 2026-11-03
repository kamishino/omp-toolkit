# Gateway Clients (Loopback)

How local agent harnesses use the OMP gateway on this machine. Design:
[Gateway Control Plane](gateway-control-plane.md) / [ADR-0010](adr/0010-gateway-control-plane-over-omp.md).
Generate every snippet below with `bun run gateway:ctl recipe [platform]`
(output uses a placeholder token; substitute a scoped client token from
`gateway:ctl clients-add <name>`, shown once at creation).

## Model guidance (verified 2026-11-03)

Tool calling through the gateway is model-sensitive. Gemini 2.5 models
enforce `thought_signature` round-tripping: the OpenAI wire carries it in
`extra_content.google.thought_signature`, but the Anthropic translation
drops it, and AI-SDK clients drop `extra_content` on replay. Result:
`400 Function call is missing a thought_signature` on the second turn.

| Client path | Tool-safe models | Avoid for tools |
|---|---|---|
| Anthropic (`/v1/messages`, Muse) | `google-antigravity/gemini-3.8-flash`, `google-antigravity/claude-sonnet-4-6` | `google-antigravity/gemini-2.5-flash` (400 on tool round-trip) |
| OpenAI (`/v1/chat/completions`, OpenCode) | `google-antigravity/gemini-3.8-flash`; raw-SDK replay with `extra_content` preserved also passes on 2.5 | `google-antigravity/gemini-2.5-flash` via AI-SDK-style clients |

Text-only turns work on every model and protocol. All recipes therefore
default to `google-antigravity/gemini-3.8-flash`.

## Muse

```powershell
bun run gateway:ctl recipe claude-code
```

Sets `ANTHROPIC_BASE_URL=http://127.0.0.1:4000`, `ANTHROPIC_AUTH_TOKEN`,
and pins all default model slots to the gateway model. Verified: Muse
Code 2.0.55, streamed Bash tool turn, exit 0 in 2 turns (spec A9).

## OpenCode

```powershell
bun run gateway:ctl recipe opencode
```

Save the output as `opencode.json` in the project directory. Verified:
OpenCode 1.18.9, bash tool executed via `google-antigravity/gemini-3.8-flash`,
exit 0 (spec A9). The same run on `gemini-2.5-flash` fails with the
`thought_signature` 400 above.

## SDKs and curl

`recipe curl`, `recipe python-openai`, `recipe python-anthropic`, and
`recipe vscode-continue` print loopback snippets against
`http://127.0.0.1:4000`. For remote (Cloudflare) deployments, see
[OMP Auth Gateway + Cloudflare](auth-gateway-cloudflare.md).

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

Issue one token per harness or machine; it is also the account-pin unit:

```powershell
bun run gateway:ctl clients-add claude-code-laptop --models=google-antigravity/*
bun run gateway:ctl clients-revoke claude-code-laptop
```

Note: scoped tokens only work when the gateway runs with `--clients`
pointing at the clients file. Gateways started by `gateway:ctl start` do;
`gateway:ctl doctor` FAILs a running gateway whose argv does not.
