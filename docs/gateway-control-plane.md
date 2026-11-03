# Gateway Control Plane

> **Status:** Accepted design, not yet implemented (2026-11-03).
> **Decision record:** [ADR-0010](adr/0010-gateway-control-plane-over-omp.md)
> **Evidence:** OMP source at commit
> [`f3410da`](https://github.com/can1357/oh-my-pi/commit/f3410da32f393d81e16a885e61979b2cb2549fcc),
> plus a live spike on `omp/18.16.0` (both recorded in the internal research
> note `docs/research/omp-multi-account-gateway.md`, gitignored by design).

## 1. Purpose

Give the operator one gateway through which every local agent harness uses all
enrolled Google Antigravity accounts, with surviving a single account's `429`
or quota exhaustion being the primary requirement — not literal per-request
round-robin.

OMP already provides the data plane: `omp auth-gateway serve` proxies OpenAI
Chat Completions and Anthropic Messages over a session-sticky, quota-aware
credential pool owned by `omp auth-broker serve`. This project builds the
control plane only: lifecycle, compatibility checks, visibility, and policy
writes around those processes. It must not reimplement credential selection,
wire translation, token refresh, or upstream calls.

## 2. Domain terms

Canonical definitions live in [`GLOSSARY.md`](../GLOSSARY.md). Terms introduced
or sharpened by this design: **Gateway client** (the scoped-token principal;
never call this an Account), **Account pin**, **Credential block** (temporary
cooling marker; distinct from a Managed exclusion), **Gateway host**,
**Control plane**, and **Data plane**.

## 3. Architecture

```
[Agent harnesses: Muse, OpenAI-format tools]
        |  OpenAI Chat Completions / Anthropic Messages + client bearer token
        v
[omp auth-gateway serve  127.0.0.1:4000]        <- data plane (OMP, untouched)
        |  OMP_AUTH_BROKER_URL + broker bearer
        v
[omp auth-broker serve   127.0.0.1:8765]        <- vault owner (OMP, untouched)
        |  agent.db: credentials, blocks, leases, sticky pins
        v
[Google Antigravity accounts]

[omp-toolkit gateway app]                        <- control plane (this project)
  - starts/stops/probes the two processes above
  - reads broker snapshot/usage/check, gateway health/models
  - writes client tokens, account policies, credential blocks
  - presents state in CLI + TerminUI + desktop widget
```

Placement follows repo layering: pure decision logic (view models, capability
and policy validation, earliest-reset calculation) in `packages/core`; all
process, HTTP, and filesystem I/O in a new `apps/*` gateway app. `packages/core`
gains no network or OMP execution code.

## 4. Settled decisions

| # | Decision |
|---|---|
| D1 | Extend OMP; build no inference proxy, translator, or upstream client. |
| D2 | Account selection is sticky with failover on quota/auth errors (OMP behavior). Literal per-request round-robin is out of scope. |
| D3 | v1 protocols: OpenAI Chat Completions and Anthropic Messages only. Responses protocol (Codex) is a later addition. |
| D4 | Standalone Bun app in this monorepo; runs without an OMP session; talks to OMP only through the broker/gateway APIs and `omp` CLI seams, behind an adapter so it can detach if OMP changes. |
| D5 | OMP `agent.db` is the sole credential source. Raw refresh tokens are never copied, stored, or printed by the toolkit. |
| D6 | v1 provider scope is `google-antigravity` OAuth accounts only. Provider-neutral types are kept for later phases. |
| D7 | Affinity unit is the Gateway client: one client token per harness or machine. Per-conversation pinning is out of scope. |
| D8 | Personal use, operator-owned accounts only. No client-fingerprint cloaking, no shared or pooled third-party access. Per-account drain/kill switches are required. |
| D9 | v1 binds loopback only. Cloudflare exposure from `docs/auth-gateway-cloudflare.md` is phase 2 and reuses the same clients file. |
| D10 | Compatibility is fail-closed: before start, verify `omp` version and broker/gateway capabilities (D13). Refuse to start with an actionable error. |
| D11 | v1 writes: gateway client add/revoke, `auth.accountPolicies` priority/reserve/drain, broker credential block/clear. Account login/logout stays in OMP. |
| D12 | Management surfaces are CLI, TerminUI, and the desktop widget. No web admin UI (roadmap `C18` stands). |
| D13 | Minimum verified OMP version is `18.16.0`. Raise only by re-running the acceptance suite; do not bundle an `omp` binary (ADR-0003 source-only stands). |
| D14 | Model names are OMP catalog ids passed through unchanged (`/v1/models` is the source). No alias layer in v1. |
| D15 | A cross-platform Bun daemon manager replaces the PowerShell-only gateway manager; the `.ps1` remains as a thin shim until parity is proven, then is retired. |

## 5. Required behavior

### 5.1 Compatibility gate (doctor)

Before any start, check all of: `omp` on PATH and version `>=` the D13 floor;
`auth-broker` and `auth-gateway` subcommands present; `serve`, `status`,
`check`, `token` actions present; broker and gateway token files readable
(values never printed); ports free or already owned by healthy OMP processes.
Any failure stops startup and names the fix. The check must also detect two
spike traps: a shell without `OMP_AUTH_BROKER_URL` where `omp auth-gateway
status` reports "No broker configured" while both health endpoints return
200 — health endpoints and process ownership win over status text; and a
running gateway whose effective argv lacks `--clients=<expected file>` or
the expected bind — binary capability is not deployment capability
(S1 found exactly this drift live).

### 5.2 Daemon lifecycle

`start`, `stop`, `restart`, `status`, `logs` for broker + gateway (+ optional
`cloudflared` in phase 2). Start order is broker, then gateway with broker URL
and clients file injected. Only processes recorded by the manager (pidfile +
command-line marker) are ever stopped. Ports, token paths, and clients path
match the existing layout (`127.0.0.1:8765`, `127.0.0.1:4000`,
`~/.omp/auth-*.token`, `~/.omp/gateway-clients.json`) so migration from the
PowerShell manager is a no-op for existing clients.

### 5.3 Visibility (read model)

Per Antigravity account, show: credential id, masked identity (never full
email in logs), check status (`ok`), usage windows and reset times where OMP
reports them, active credential blocks with scope and expiry, and policy
(priority, reserve, drain). Per gateway client, show: name, model allowlist,
account allowlist, and token fingerprint (digest prefix only). A pool summary
shows the earliest known reset across blocked accounts.

Known blindness, accepted in v1 and shown honestly in the UI: the gateway
does not attribute a served request to an account (no response header, no
log line, no broker surface — S1 searched all three). Pin *distribution* is
observable read-only from the `agent.db` sticky cache and usage reports
expose per-account `limits[]` windows, but a gateway client's own pin is
not identifiable. Views may show pool pin distribution; they must label
per-client pin and last-serving account as unknown rather than inferring
them.

### 5.4 Policy writes

- **Clients:** mint `omp_gw_…` tokens, store SHA-256 digest + model globs +
  optional account allowlist in the clients file (hot-reloaded by OMP);
  revoke by name. Plaintext is shown once at creation.
- **Priority / reserve / drain:** write `auth.accountPolicies` through the
  existing policy-store seam (drain = `reservePct: 100`). Every write records
  prior value so it is undoable, and is appended to History.
- **Blocks:** create/clear broker credential blocks
  (`POST|DELETE /v1/credential/:id/block`, `providerKey`, `blockScope`,
  `blockedUntilMs`). Operator blocks use the global `""` scope with a
  mandatory expiry (5 s–24 h): OMP's selection only consults global,
  protected, and strategy scopes, so a toolkit-owned custom scope would
  never take effect (corrected during S3 from source evidence). Permanent
  exclusion is a policy drain, not a block. Cooldown presentation keys on
  account + Antigravity backend counter + error class, matching OMP block
  scopes; per-exact-model cooling is not claimed.

### 5.5 Exhaust behavior

OMP's resolution ladder serves through a locally blocked account when no
unblocked sibling exists (live-verified), so local blocks alone never produce
a hard failure. The control plane therefore: (a) presents an **Exhausted**
pool state when every account is blocked or reserve-spent, with the earliest
reset; (b) must not queue or hold harness requests; (c) documents that the
wire quota error, surfaced by OMP retry layers, is the fail-fast signal.
S1 observed the controllable analog: a client whose restricted pool has no
available account receives a pre-stream `502 upstream_error` ("No API key
for provider…") with no `Retry-After`, and a model-denied client receives
`404`. The terminal shape of a real all-accounts quota exhaustion is still
unobserved and remains an acceptance item (§7), not an assumption.

### 5.6 Streaming

Header-commit timing measured inconsistently across spikes (9 ms vs
795 ms-to-first-frame), so buffer-to-first-token is unproven in either
direction. The control plane must not promise transparent pre-first-token
failover. S1 did verify that pre-first-frame failures (dispatch `502`,
validation `400`) return clean protocol-native JSON errors with correct
status on streaming requests. Mid-stream upstream failure framing remains
unforced and unknown. If acceptance testing shows the gateway fails a
stream opaquely mid-flight, the remedy is an upstream OMP issue or a scoped
design revision of this spec — not a toolkit-side stream rewriter in v1.

### 5.7 Tool-use model constraint (S4 finding)

OMP's Anthropic translation drops Gemini `thought_signature` data, and
AI-SDK clients drop OpenAI `extra_content` on replay, so Gemini 2.5 tool
round-trips fail upstream with `400` on both harness paths (research
§11). Recipes therefore default every client to
`google-antigravity/gemini-3.8-flash`, which round-trips tool calls on
both protocols, and `docs/gateway-clients.md` carries the per-protocol
model matrix. This is an upstream limitation to re-test on OMP upgrades,
not behavior the control plane can repair.

## 6. Delivery slices

| Slice | Contents | Gate |
|---|---|---|
| S0 | This spec + ADR-0010 + roadmap entries | Review |
| S1 | Spike #2: upstream-error streaming, exhaust `429` shape, attribution/pin observability search (gateway logs, broker usage-observed, sqlite cache read as last resort), compat matrix on 18.16.0 | Done 2026-11-03; findings in research §10, folded into §5.1/§5.3/§5.5/§5.6 |
| S2 | Read-only control plane: Bun daemon manager, fail-closed doctor, account/client/pool views (CLI) | Done 2026-11-03 (`apps/gateway`, `bun run gateway:ctl <doctor|start|stop|restart|status|accounts|clients|pool>`); A1–A4 verified live |
| S3 | Writes: clients, policies, blocks, drain; History audit; TUI + widget status | Done 2026-11-03; A5–A8 verified live. Write actions are CLI-only; TUI/widget status rides the existing `/gateway` command and desktop gateway probe unchanged |
| S4 | Harness acceptance: Muse + one OpenAI-format harness on loopback, recipes regenerated | Done 2026-11-03; A9 passes with the §5.7 model constraint, A10 recorded in research §11 and `docs/gateway-clients.md` |
| S5 (phase 2) | Cloudflare lifecycle under the Bun manager, multi-machine client packs | Separate review |

## 7. Acceptance criteria

- **A1** Doctor passes on a correctly configured deployment and fails closed
  with an actionable message when `omp` is missing, too old, or missing a
  subcommand (stubbed in tests), including when a running gateway's argv
  drifts from the expected bind/`--clients` (live-verified 2026-11-03: the
  reference machine's externally started gateway correctly FAILs until it is
  restarted under the daemon manager).
- **A2** Manager starts broker then gateway from cold, reports health, and
  stops only its own recorded processes. Re-running start is idempotent.
- **A3** Account view lists all 7 Antigravity accounts with check status,
  blocks, and reset times, with no token or full email in any output or log.
- **A4** Pool view computes the earliest reset correctly against synthetic
  block fixtures in `packages/core` unit tests.
- **A5** Creating a client, calling with its token, then revoking it yields
  200 then 401 without a gateway restart.
- **A6** Blocking all but one account (test scope, auto-expire ≤60 s) still
  serves both protocols; clearing restores the snapshot to zero test blocks.
- **A7** Setting drain on an account is visible in the view, written as
  `reservePct: 100`, undoable, and recorded in History.
- **A8** Emergency drain-all sets the Exhausted pool state and shows the
  earliest reset; the UI states that OMP may still attempt the wire.
- **A9** Muse completes a streamed tool-call turn through the gateway;
  an OpenAI-format harness completes streamed chat. Both use OMP model ids.
  Verified 2026-11-03 (Claude Code 2.0.55, OpenCode 1.18.9) on
  `gemini-3.8-flash` per §5.7; `gemini-2.5-flash` tool turns fail upstream
  and are explicitly out of the passing set until OMP fixes signature
  translation.
- **A10** S1 findings for streaming errors and exhaust `429` shape are
  recorded, and §5.5/§5.6 are updated to match observation before S4 ships.

## 8. Non-goals

Own inference proxy or translators; Codex Responses support; multi-provider
pooling; per-conversation affinity; model fallback on error (roadmap `C24`
stands); web admin UI (`C18` stands); cross-machine state sync (`C23` stands
— phase-2 remote clients consume inference only and hold no toolkit state);
account login flows; sub-agent or usage features unrelated to the gateway.

## 9. Risks

- **External binary drift:** OMP gateway/broker APIs are upstream-owned.
  Mitigated by D10/D13, the adapter seam (D4), and keeping all writes on
  documented-in-source wire shapes captured in the research doc.
- **Upstream surface churn:** Antigravity endpoints and quotas are Google's
  internal surface and have sunset on short notice before. The control plane
  degrades to visibility + doctor if the data plane breaks; it owns no
  credentials to lose.
- **Quota terms:** pooling accounts to multiply quota carries circumvention
  risk under Google API Terms §2c/§2d (see research §6). Constrained by D8.
- **Observability ceiling:** without request attribution, per-account serving
  metrics cannot be exact in v1. Accepted and labeled (§5.3); revisit if OMP
  exposes usage-observed attribution sufficient for it.
