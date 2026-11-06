# OMP Toolkit Roadmap (MoSCoW)

> **Beneficiary:** Solo operator (primary Windows workstation; four providers: Google Antigravity, OpenAI Codex, Muse Code, DeepSeek)  
> **Horizon:** Continuous open backlog (MoSCoW prioritized; strictly one feature or intervention at a time)  
> **Operator Capacity:** ~5 hours/week (~20 hours/month)  
> **Evidence Foundation:** Completed-item evidence is recorded inline in this file and in the ADRs.  
> **Last updated:** 2026-11-06  

---

## North Star & Operating Principles

All roadmap development is evaluated against these non-negotiable operational principles:

1. **Measurably Better Execution Quality:**
   - North-star metric: `errorEndedRate = agent_run(status="error") / agent_run(all)`. Target: $\ge 25\%$ reduction compared to initial baseline.
   - Cost containment: `costProxy` (mean tokens per non-error run) not degraded by $> 10\%$ relative to baseline.
   - Measurement gate: $\ge 30$ `agent_run` samples present in every evaluation window.
2. **Unwaivable Route Reliability Gate:**
   - Continuous zero-manual-fix autonomous operation: route circuit breaker automatically isolates hung accounts and auto-restores them on recovery streaks.
   - Incidents resolved automatically within 15 minutes without manual intervention.
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
| `R01` | Operational Must-Haves (Autonomous Safeguards) | commits `d5b45d1`, `52d676a`, `c630336`, `3269972` | Autonomous Quota Cooldown in Gateway (`evaluateQuotaCooldowns` & `autoCooldownSweep`) dynamically cooling $\ge 99\%$ depleted accounts until `resetsAt` while strictly enforcing the Surviving Account Invariant, proactive Desktop OS Notifications (`evaluateQuotaAlerts`) with 15-minute debouncing, and 1-click remote pairing command `gateway:ctl remote-pair <platform> [name]` |
| `G04` | Remote Client Doctor (`gateway:ctl doctor --remote`) | `packages/core/src/gateway/doctor.ts`, `apps/gateway/src/doctor.ts` | Unit-verified (`control.test.ts`, `doctor.test.ts`): diagnoses base URL, CF Access headers, public tunnel reachability, and gateway bearer auth in 1 command with actionable fix hints |

---

## Must Have

Critical prerequisites and metric-integrity fixes without which daily operation or north-star measurement fails.

### Operational Prerequisites (Zero Development)

Minimal operator configuration before feature deployment:

1. **Auto-Restore Opt-In:** Run `/gemini-auto-restore <account>` on your workstation to initialize `gemini-health-auto-restore.json`, allowing the circuit breaker to manage and restore exclusions automatically.
2. **Normal Usage:** Operate OMP normally; the extension automatically isolates stalls and logs telemetry in the background.

### Development Musts

No open development Musts. A new item is promoted to Must only when daily operation or metric validity is broken.

---

## Should Have

High-leverage execution quality and reliability improvements backed by measured empirical benchmarks or regression prevention.
No open Shoulds. G04 completed 2026-11-06; see Completed.
---

## Could Have

Contingent enhancements, minor ergonomics, and external developer tooling. These are deferred until specific triggers fire or core Shoulds are complete.

| ID | Feature / Task | Target / Location | Contingent Trigger / Condition | Effort |
| :--- | :--- | :--- | :--- | :---: |
| **`C09`** | **Tighten Context-Economy Instructions** | `.omp/AGENTS.md` | Trigger: baseline telemetry reveals error clusters or token bloat tied to specific prompt sections. | S ($1\text{ h}$) |
| **`C14`** | **External Graphify & Repomix Skills** | `skill://graphify` | Tooling: optional external CLI skills for 1M-LOC AST graph retrieval; never bundled as internal repo dependencies. | M ($4\text{ h}$) |
| **`C25`** | **Desktop Panel Keyboard Navigation Shortcuts** | `apps/desktop/src/renderer/renderer.ts` | Ergonomics: `Ctrl+1..4` to cycle active status metric filter chips (`All`, `Healthy`, `≥80%`, `Issues`) and `Ctrl+E` to expand/collapse all provider cards. | S ($1\text{ h}$) |

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

Operational safeguards (`R01`), Desktop UX (`U01`, `U02`), and Gateway Onboarding (`G02`, `G03`) have all landed and passed live verification gates. Next recommended priority is `G04` (Remote Client Doctor) when secondary PC remote access needs automated diagnostic validation.

Other work is pulled from `## Could Have` only when its named trigger fires.

---

## Operating Cadence

No scheduled rituals. The circuit breaker runs in-process inside OMP; no background monitor daemon is required.

- **On demand:** run `bun run reliability:report --days=7` or `bun run execution:report --days=7` when investigating route health or execution quality.
- **Optional backup:** copy `omp-toolkit-history.db` to `~/.omp/agent/backups/history-<YYYY-MM-DD>.db` before major changes.
- **Incident response:** run `bun run doctor`, read the monitor `INCIDENT` banner, and let the circuit breaker and recovery timer handle restoration — never edit routing policies by hand.
