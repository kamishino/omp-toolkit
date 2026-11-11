# OMP Toolkit Roadmap (MoSCoW)

> **Beneficiary:** Solo operator (primary Windows workstation; four providers: Google Antigravity, OpenAI Codex, Muse Code, DeepSeek)  
> **Horizon:** Continuous open backlog (MoSCoW prioritized; strictly one feature or intervention at a time)  
> **Operator Capacity:** ~5 hours/week (~20 hours/month)  
> **Evidence Foundation:** Completed-item evidence is recorded inline in this file and in the ADRs.  
> **Last updated:** 2026-11-11

---

## North Star & Operating Principles

All roadmap development is evaluated against these non-negotiable operational principles:

1. **Measurably Better Execution Quality:**
   - North-star metric: `errorEndedRate = agent_run(status="error") / agent_run(all)`. Target: $\ge 25\%$ reduction compared to initial baseline.
   - Cost containment: `costProxy` (mean tokens per non-error run) not degraded by $> 10\%$ relative to baseline.
   - Measurement gate: $\ge 30$ `agent_run` samples present in every evaluation window.
2. **Unwaivable Route Reliability Gate (enabled-mode objective, not default behavior):**
   - Objective when Gemini health is explicitly opted in before startup (`GEMINI_HEALTH_ENABLED=1`): route circuit breaker automatically isolates hung accounts and auto-restores them on recovery streaks; incidents resolved automatically within 15 minutes without manual intervention.
   - Default state: Gemini health checks and recovery are paused. Gateway process availability and provider access are separate from this paused recovery path and are diagnosed via gateway lifecycle/auth checks plus explicit operator actions.
3. **Core Architectural Invariants:**
   - **Zero Idle Tokens (ADR-0001, amended by ADR-0009):** Monitoring performs passive file reads only. Route probing runs on hook events, manual checks, or the conditional recovery sweep, which only runs while restorable exclusions exist and the agent is idle.
   - **Local-First Simplicity:** Operates entirely on local SQLite state (`omp-toolkit-history.db`); zero cross-machine sync, zero cloud dependencies.
   - **Source-Only Distribution (ADR-0003):** Runs directly from source checkout with Bun; zero public npm publishing or binary distribution overhead.
   - **Pure Domain Boundary:** `packages/core` contains no network, OMP, or arbitrary filesystem I/O; path resolution only (`environment.ts`, `templates.ts`), and no ANSI escapes.

---

## Completed

| ID | Item | Evidence | Verified done-signal |
| :--- | :--- | :--- | :--- |
| `C01` | Fix & Validate `costProxy` Token Extraction | commit `b23598b`, deployed via Step 0 | `extractRunTokens` sums real per-message usage (unit-verified); tests isolated from `~/.omp/agent/omp-toolkit-history.db`; live distinct `tok=` values appear after first post-deploy runs (historical rows remain `tok=1200`) |
| `C04` | Audit Probe Wire Pins vs. Upstream Client | commit `59925ca` | `docs/runbook.md` `## Probe wire pins audit` documents `gemini-3.8-flash-high`, `UA_VERSION = "2.24.0"`, and `PI_AI_ANTIGRAVITY_VERSION` override |
| `C05` | Add Missing Colocated Tests for Core Surfaces | commits `e1c55e8`, `13e3cc0` | `commands.test.ts` (8 commands + `gemini_health` tool), `execution-report.test.ts`, `reliability-report.test.ts` pass in `bun run check` |
| `C06` | Deduplicate Desktop & CLI Pacing Stores | `packages/core/src/pacing.ts`, `apps/provider-usage/src/pacing-store.ts` | Single shared store helper extracted; desktop re-exports from provider-usage; `packages/core` purity preserved; `bun run check` and `build:desktop` pass |
| `C07` | Re-Evaluate Model Pairings | `scripts/eval/eval-model-roles.ts` | 2x2 model pairing evaluator and scorecard calculation verified via `--dry-run --report`; Pair A cost leadership confirmed |
| `C08` | Targeted Wire-Normalizer Fixes | `apps/omp-extension/src/gemini-normalizer.ts` | Expanded pre-tool conversational chatter stripping; stripped chatter from model parts with function calls; empty text parts filtered out |
| `C11` | Multi-Account Weekly Pacing | `packages/core/src/dashboard/builder.ts`, `pacing.ts` | Removed single-account gate; multi-account sections calculate pacing ceiling markers per row across providers |
| `C12` | Cross-Platform OS Incident Toast | `apps/omp-extension/src/toast.ts` | Added platform-aware dispatch: `osascript` on macOS, `notify-send` on Linux, PowerShell on Windows |
| `C13` | Desktop Provider Logo for `muse-code` | `apps/desktop/src/renderer/provider-logos.ts` | Created `muse-code.svg` asset and mapped in `PROVIDER_LOGOS`; unit tests verified |
| `D03` | Detached-Launch Error Visibility | commit `8826202` | Launcher records failures to `desktop-widget-error.log` + one-shot marker; Electron surfaces it on next start; `launch-failure.test.ts` (record/consume/corrupt) passes |
| `D02` | Dist-Freshness Guard on Launch | commit `05cbe10` | Electron main refuses silent stale `dist` on any entry point; verified live: stale launch logs, `build:desktop` clears; `freshness.test.ts` passes |
| `G01` | Gateway Control Plane over OMP ([spec](gateway-control-plane.md), [ADR-0010](adr/0010-gateway-control-plane-over-omp.md)) | `apps/gateway`, `packages/core/src/gateway/control.ts`, [client guide](gateway-clients.md) | S1-S4 live-verified 2026-11-03: fail-closed doctor caught argv drift; alt-port cold lifecycle; client 200→revoke 401; block/drain/undrain/restore; Muse + OpenCode tool turns on `gemini-3.8-flash` (Gemini 2.5 tool turns blocked upstream, research §11) |
| `G02` | Gateway Phase 2: Cloudflare Remote Access under Bun Manager | commits `b82aee3`, `197712a`, `2de6fe7`, `361674e` | S5 live-verified 2026-11-04: `REMOTE-OK` through Cloudflare Access + tunnel + gateway; DSH and curl remote recipes; documented in `docs/remote-setup/README.md` |
| `U01` | Account Reset Sorting & Ghost Provider Auto-Hide | commits `def3f8f`, `56f4a7d`, `ca8d3c3`, `7e1c062`, `d2b7c58` | `AccountSortOrder` (`weekly-reset` default, `weekly-usage`), CLI `--sort` & `OMP_ACCOUNT_SORT`, desktop settings dropdown, and ghost OAuth cache pruning via `omp usage accounts` |
| `U02` | Desktop Panel UX/UI Redesign | commits `417b1fe`, `0cf15e0`, `aed11ef` | Collapsible provider cards with localStorage persistence and header preview badges, interactive status metric filter chips (`All`, `Healthy`, `≥80%`, `Issues`) with clean zero-match card hiding, and account micro-actions (click-to-copy email, click-to-probe non-OK route) |
| `G03` | Gateway UX & 1-Step Onboarding | commits `52d676a`, `c630336`, `3269972` | Desktop Gateway Strip with 1-click Start/Stop/Restart/Doctor controls, expandable Gateway Drawer with 1-click endpoint copy and quick harness recipe selector, unified 1-step `gateway:ctl connect <platform> [name]` command, in-OMP `/gateway` markdown parity, and CLI `--help` fix |
| `R01` | Operational Must-Haves (Autonomous Safeguards) — **partial** | commits `d5b45d1`, `52d676a`, `c630336`, `3269972` | Quota decision helper (`evaluateQuotaCooldowns`) exists; production automatic-sweep wiring (`autoCooldownSweep`) was not found, so the helper is not an active service. Desktop OS notifications (`evaluateQuotaAlerts`, 15-minute debouncing) and `gateway:ctl remote-pair <platform> [name]` remain dated historical evidence from 2026-11-06, not newly verified runtime behavior |
| `G04` | Remote Client Doctor (`gateway:ctl doctor --remote`) | `packages/core/src/gateway/doctor.ts`, `apps/gateway/src/doctor.ts` | Unit-verified (`control.test.ts`, `doctor.test.ts`): diagnoses base URL, CF Access headers, public tunnel reachability, and gateway bearer auth in 1 command with actionable fix hints |

---

## Must Have

Critical prerequisites and metric-integrity fixes without which daily operation or north-star measurement fails.

### Operational Prerequisites (Zero Development)

No Gemini probe/recovery opt-in is required for this increment. Leave existing credentials and historical state untouched. Gemini health stays paused by default; only a literal `GEMINI_HEALTH_ENABLED=1` set before process startup opts in, and this roadmap does not recommend enabling it.

### Development Musts

- **`G05`: Truthful gateway and pool assessment** — first and only active development candidate. Reuse `buildAccountViews()` / `buildPoolView()`, existing gateway view rendering, and `fetchGatewayPanelView()`; no second status collector or probe service.
  - Distinguish unblocked counts, operator-drained state, reported credential-check failure/unknown, and quota evidence. Eligibility is route-specific; an unblocked count alone does not establish it. Missing policy evidence is not permission; missing quota is neither zero nor unlimited quota.
  - Preserve readable snapshot/account information when a supporting read fails and identify incomplete observations. Distinguish a failed authoritative snapshot from a successful empty snapshot. Do not invent a freshness TTL where the source supplies no timestamp.
  - Distinguish desktop process liveness from authenticated catalogue access. Catalogue success does not prove tool-turn/stream compatibility. No live inference or resumed Gemini checks.
  - Observable outcomes: three drained accounts are not presented as three usable accounts; a missing credential check stays unknown rather than success; a failed usage read retains known account identities plus an explicit usage warning; a successful empty snapshot is labeled empty, not an exhausted live pool; `/healthz` 200 with `/v1/models` 401 shows alive-but-access-failed, not serving-ready success.
  - Source anchors: `packages/core/src/gateway/account-views.ts:buildPoolView`, `apps/gateway/src/views.ts:getAccountsOutput/renderPoolText`, `apps/desktop/src/gateway-status.ts:fetchGatewayPanelView`.

---

## Should Have

Sequenced after `G05`, strictly one feature or intervention at a time: `G06` then `G07`.

- **`G06`: Explainable manual account and client actions** (depends on `G05`). Preserve operator-triggered writes, bounded block durations, audit records, credential secrecy, and managed-process ownership safeguards.
  - Make target, scope and observed outcome clear for existing block/drain/unblock/revoke operations. Local blocks are soft upstream selection controls, not guaranteed no-serve protection. Distinguish an empty/no-op result from restricting a populated pool.
  - Observable outcomes: draining an empty snapshot does not claim populated-pool exhaustion; an unknown account fails without changing another account; action failures cannot show success; revocation identifies the named client and expected impact without printing its stored token. No plaintext credentials in logs/audits.
  - Reuse existing write modules and action surfaces; no new rotation API, database schema, serving-account attribution, or unverified token-reload guarantee.
  - Source anchors: `apps/gateway/src/block-writes.ts`, `apps/gateway/src/client-writes.ts`, `apps/gateway/src/policy-writes.ts`, `apps/gateway/src/daemon-manager.ts` (existing safeguards).

- **`G07`: Correct secondary-PC setup and persistent diagnostic results** (follows `G06`). Correct concrete output/feedback gaps; do not rebuild shipped `connect`, `remote-pair`, recipes, or `doctor --remote`.
  - Reuse the platform-specific recipe generator. An OMP thin client receives OMP configuration, not Anthropic-only variables. Missing required remote settings or failed client creation must not produce a successful-looking live setup payload or silently rotate another client's credentials.
  - Keep upstream credentials on the primary host and downstream tokens scoped per machine/client. Describe compatibility observations as dated evidence; never promise transparent tool-stream replay.
  - Observable outcomes: OMP selection produces the existing two-file YAML recipe and applicable Access headers; missing remote settings produce an actionable result before a ready-to-run payload; failed doctor checks remain inspectable instead of disappearing with a toast; catalogue access is not described as an inference test.
  - Source anchors: `apps/gateway/src/commands/remote-commands.ts:runRemotePairCommand`, `packages/core/src/gateway/recipes/platforms/omp.ts`, `apps/desktop/src/renderer/gateway-view.ts`.

## Could Have

Contingent enhancements, minor ergonomics, and external developer tooling. These are deferred until specific triggers fire or core Shoulds are complete.

| ID | Feature / Task | Target / Location | Contingent Trigger / Condition | Effort |
| :--- | :--- | :--- | :--- | :---: |
| **`C09`** | **Tighten Context-Economy Instructions** | `.omp/AGENTS.md` | Trigger: baseline telemetry reveals error clusters or token bloat tied to specific prompt sections. | S ($1\text{ h}$) |
| **`C14`** | **External Graphify & Repomix Skills** | `skill://graphify` | Tooling: optional external CLI skills for 1M-LOC AST graph retrieval; never bundled as internal repo dependencies. | M ($4\text{ h}$) |
| **`C25`** | **Desktop Panel Keyboard Navigation Shortcuts** | `apps/desktop/src/renderer/renderer.ts` | Ergonomics: `Ctrl+1..4` to cycle active status metric filter chips (`All`, `Healthy`, `≥80%`, `Issues`) and `Ctrl+E` to expand/collapse all provider cards. | S ($1\text{ h}$) |
| **`G08`** | **Management coverage for the other existing providers (Codex, Muse Code, DeepSeek)** | Provider/account concepts; per-provider identity/credential paths | Trigger: only after `G05`–`G07` meet their outcomes and supported account identity/credential paths are established for each candidate. OMP keeps credential ownership; a changed config literal alone is not delivery. | — |

---

## Won't Have (This Backlog)

Explicitly rejected based on empirical refutation, architectural invariants, or roadmap boundaries:

- **`C02`: Lock Pair A Model Roles in User Config — DECLINED BY OPERATOR.**
  Current `~/.omp/agent/config.yml` presets (plan/default `google-antigravity/gemini-3.8-flash:high`) are kept; Pair A was declined by the operator.
- **`C03`: Apply Handoff Contract Template — DECLINED BY OPERATOR.**
  Global `~/.omp/agent/AGENTS.md` rules are kept; `templates/plan-exec-handoff/` remains available via `/template apply plan-exec-handoff` on demand.
- **`C15`: Reverse Proxy Stream Compression (`billion-context`) — REJECTED.**
  Empirically refuted on 2026-10-29. Produced 0% token savings on agent tasks; hardcoded 50k threshold stayed idle; expanded request payloads by $+8.3\%$ ($+11.1\text{ KiB}$) per turn; breaks byte-stable prefix caching (93–94% hit rate); license attribution conflicts with clean distribution.
- **`C16`: Graphify Inside `packages/core` & In-Process Repo Map — PROHIBITED.**
  Placing Tree-sitter parsing or file indexing into `packages/core` violates pure zero-I/O domain boundaries. Compiler LSP (`xd://lsp`) and `ast-grep outline` already provide deterministic symbol precision at $\sim 50\text{--}150$ tokens per query without persistent indexing overhead.
- **`C17`: Public Packaging, npm Publishing & Signed Binaries — EXCLUDED.**
  Source-only distribution policy (ADR-0003). The solo operator executes directly from git checkouts; public release infrastructure wastes weekly capacity.
- **`C18`: Standalone Web Dashboard Server — EXCLUDED.**
  The desktop Electron tray widget and TerminUI terminal monitor completely satisfy operator observability without maintaining a separate HTTP server process. Gateway management (`G01`, ADR-0010) stays CLI/TerminUI/widget; the `omp auth-gateway` HTTP process is OMP's data plane, not a toolkit dashboard.
- **`C19`: Provider SDK & Generalized Extension Interfaces — EXCLUDED.**
  Purpose-built for OMP; creating generic provider SDK abstractions is dead-weight complexity for a fixed 4-provider deployment.
- **`C20`: Additional Usage Providers (Copilot, Anthropic) — EXCLUDED.**
  Scope is strictly locked to the 4 active providers (Google Antigravity, OpenAI Codex, Muse Code, DeepSeek).
- **`C21`: Cross-Platform Reliability Proof Parity — EXCLUDED.**
  Reliability scope is the primary Windows workstation (ADR-0004). macOS and Linux remain maintain-only best-effort.
- **`C22`: Periodic Background Idle Route Probing — PROHIBITED.**
  Probing routes while no session is active wastes provider token quotas, violating the zero-idle-token invariant (ADR-0001).
- **`C23`: Cross-Machine State Synchronization & Distributed DB — PROHIBITED.**
  State is local-first: each workstation keeps an isolated local SQLite database; no network synchronization is built or needed. Remote gateway clients (`G01` phase 2) consume inference only and hold no toolkit state, so this prohibition stands.
- **`C24`: Lower-Model Fallback or Thinking Degradation on Error — PROHIBITED.**
  Silently falling back to weaker models or reducing thinking levels during errors degrades code quality. Route circuit breaking and auto-restore are the sole authorized remedies.

---

## Recommended Execution Sequence

`G05` (Must) is the single active development candidate. On its acceptance outcomes, proceed `G06` → `G07` (Shoulds), strictly one feature or intervention at a time. `G08` stays conditional until `G05`–`G07` outcomes hold and each candidate provider's supported identity/credential paths are established. `G04` is complete and is not future work.

Autonomous account restriction is a separate gated proposal only after trustworthy observations, upstream last-resort/enforcement behavior, and recovery semantics are established; the survivor heuristic does not prove hard protection. This sequence adds no HA, new dashboard, second proxy/vault, model degradation, or periodic inference checks.

---

## Operating Cadence

No scheduled rituals. No background monitor daemon is required.

- **On demand:** run `bun run reliability:report --days=7` or `bun run execution:report --days=7` when investigating route health or execution quality.
- **Optional backup:** copy `omp-toolkit-history.db` to `~/.omp/agent/backups/history-<YYYY-MM-DD>.db` before major changes.
- **Incident response:** run `bun run doctor` for gateway lifecycle/auth diagnosis and use explicit manual actions; these are distinct from paused Gemini route recovery. The circuit breaker and recovery timer act only in the explicitly opted-in enabled mode — never edit routing policies by hand.
