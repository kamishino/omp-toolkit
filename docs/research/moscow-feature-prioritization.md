# OMP Toolkit Feature Prioritization (MoSCoW)

> **Date:** 2026-10-29  
> **Beneficiary:** Solo operator (two independent Windows workstations; four providers: Google Antigravity, OpenAI Codex, Muse Code, DeepSeek)  
> **Horizon:** Open backlog (no calendar horizon; existing 90-day phase calendar and Day-51 freeze preserved)  
> **Operator Capacity:** ~5 hours/week (~20 hours/month), strictly one feature or intervention at a time  
> **Evaluation Mode:** Evidence-backed desk audit and codebase verification across repository sources, 13 research reports, ADR invariants, and test surfaces  

---

## Method

### Register Sources
The candidate register was compiled from a complete audit across the following sources:
1. `docs/roadmap.md` — North-star metrics, Phase 0–1 known gaps, known issues, pending operator actions, Phase 2 ranked intervention menu (items 1–5), and roadmap exclusions.
2. `docs/research/*.md` (13 reports) — Empirical evaluations and proposals, including model pairing benchmarks (`model-pairing-eval-results.md`), reverse proxy audits (`billion-context-evaluation.md`), token saving strategies (`oh-my-pi-token-saving-strategy.md`), AST navigation studies (`graphify-token-savings.md`, `graphify-alternatives-comparison.md`), and execution prompts (`practical-implementation-blueprint.md`, `frontier-plan-gemini-execution-strategy.md`).
3. `HANDOFF.md` — State invariants, pending tasks, and prohibited workarounds.
4. Codebase inspection — Verified gaps, defects, extension points, and missing colocated test surfaces in `packages/core`, `packages/tui`, `apps/omp-extension`, `apps/provider-usage`, `apps/desktop`, and `scripts/`.

### Register Exclusions
The following categories were excluded from the developable candidate register prior to ranking:
- **Eval Benchmark Fixtures:** The `--compact` CLI boolean flag (`scripts/eval/eval-tasks.ts:31,74`) and the `omp:cooldowns` IPC channel query (`scripts/eval/eval-tasks.ts:39,85`) were created solely as synthetic benchmark evaluation tasks T2 and T3 for model role testing; they are not product feature requests.
- **Shipped & Stable Features:** Shipped components operating stably with zero open defect reports (provider usage monitor, weekly pacing display, timetable schedule evaluator, desktop tray widget, TerminUI monitor, Orca launcher, account warm-up/check, and `/template` commands) are classified as maintain-only and excluded from developable candidate ranking.
- **Operational Non-Development Actions:** Tasks requiring operator action without codebase modification (e.g., executing the Machine 2 install checklist, running the one-time `/gemini-auto-restore` command, starting the monitor process, accruing 14 days of session history) are categorized separately under Operational Prerequisites and do not consume development capacity.

### Scoring Rubric
- **Impact (1 to 5):**
  - `5`: Unblocks the mandatory reliability proof, fixes data corruption, or restores telemetry metric validity.
  - `4`: Measurably improves `errorEndedRate` or reduces `costProxy`.
  - `3`: Saves operator maintenance time on a weekly recurring basis.
  - `2`: Occasional operator convenience or minor ergonomics.
  - `1`: Purely cosmetic or visual polish.
- **Effort (S / M / L):**
  - `S` (Small): $< 2$ hours (midpoint: $1\text{ h}$).
  - `M` (Medium): $2\text{--}8$ hours (midpoint: $5\text{ h}$).
  - `L` (Large): $> 8$ hours (midpoint: $12\text{ h}$).
- **Evidence Strength:**
  - `Measured`: Verified with local quantitative benchmarks, unit tests, or empirical session runs.
  - `Asserted`: Backed by architectural analysis, vendor specs, or external literature without local run verification.
  - `Refuted`: Empirically tested and demonstrated to fail pre-registered criteria or produce negative ROI.
- **Invariant Risk:** Evaluated against core rules: `packages/core` zero-I/O purity, zero-idle-token rule (`docs/adr/0001-event-driven-health.md`), source-only distribution (`docs/adr/0003-public-release-scope.md`), and two-machine independence (`docs/roadmap.md:435-437`).

### Tier Rules
- **Must:** Without it, daily operation, the reliability proof, or north-star metric validity fails; or it resolves a defect corrupting recorded metrics.
- **Should:** High-impact intervention ($\text{Impact} \ge 3$) backed by `Measured` evidence, or an approved Phase 2 ranked menu item (Items 1–2).
- **Could:** Moderate or low impact ($\text{Impact} \le 2$), `Asserted` evidence only, cosmetic polish, or contingent upon an external trigger that has not yet fired.
- **Won't (This Backlog):** Empirically refuted, violates an architectural invariant or ADR, superseded by an adopted alternative, or serves external audiences rather than the solo operator.
- **Tie-Break Precedence:** `Measured` evidence precedes `Asserted`; defect fixes precede new features; smaller effort precedes larger.
- **Must-Tier Effort Cap:** Total midpoint development effort for Must items must not exceed $20\text{ hours}$ (4 weeks at operator capacity).

---

## Candidate register

| ID | Candidate Feature / Task | Source Citation | Type | Status | Benefit Claim | Evidence | Impact | Effort | Invariant Risk |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **C01** | Fix/validate `costProxy` token extraction | `apps/omp-extension/src/auto-heal.ts:32-67,254-256`, `docs/roadmap.md:125-130` | Defect Fix | Partial | Restores valid token extraction in `agent_run` records; resolves constant `tok=1200` output. | Measured | 5 | M (5 h) | Low (telemetry only) |
| **C02** | Lock Pair A model roles in user config | `docs/roadmap.md:313-316`, `docs/research/model-pairing-eval-results.md:1-160` | Config | Proposed | Locks `deepseek/deepseek-flash` for plan & default with `thinking_level: low`; slashes costs by up to 85% ($0.02 vs $0.15+). | Measured | 4 | S (1 h) | None (user config) |
| **C03** | Apply plan-to-executor handoff contract template | `docs/roadmap.md:317-319`, `templates/plan-exec-handoff/AGENTS.template.md:1-55` | Prompt | Proposed | Enforces zero-invention contract, inverted layout, and 2-strike verification; cuts plan hallucination loops. | Measured | 4 | S (1 h) | None (template apply) |
| **C04** | Audit probe wire pins vs upstream Antigravity client | `apps/omp-extension/src/probe-client.ts:10,17`, `docs/roadmap.md:131-134` | Audit | Partial | Prevents unexpected probe failures if Google deprecates `UA_VERSION = 2.24.0` or `gemini-3.8-flash-high`. | Asserted | 3 | S (1 h) | Low (probe constants) |
| **C05** | Add missing colocated tests for high-surface modules | `apps/omp-extension/src/commands.ts:1-530`, `scripts/reliability/*.ts` | Test | Gap | Adds test suites for 8 `/gemini-*` commands, `gemini_health` tool, and reliability reporting CLIs. | Measured | 3 | M (5 h) | Zero (colocated tests) |
| **C06** | Deduplicate desktop & CLI pacing sample stores | `apps/desktop/src/pacing-store.ts:1-88`, `apps/provider-usage/src/pacing-store.ts:1-88` | Refactor | Partial | Consolidates 88 LOC of identical atomic file write and parsing logic into a shared module. | Measured | 2 | S (1 h) | Medium (must keep `packages/core` pure) |
| **C07** | Re-evaluate model pairings on catalog shifts | `docs/roadmap.md:320-323`, `scripts/eval/eval-model-roles.ts:1-293` | Eval | Proposed | Re-runs 2x2 empirical evaluation (tasks T1–T5) if provider models or API pricing shift. | Measured | 3 | S (1 h) | None (offline test) |
| **C08** | Gemini wire-normalizer targeted fixes | `docs/roadmap.md:324-326`, `apps/omp-extension/src/gemini-normalizer.ts:1-165` | Defect Fix | Shipped / Proposed | Fixes trailing-turn API rejections (OMP #14790) and reflective monologue tool suppression (Forum #180934). | Measured | 3 | M (3 h) | Medium (request hook) |
| **C09** | Tighten context-economy instructions in AGENTS.md | `docs/roadmap.md:327-329`, `.omp/AGENTS.md` | Prompt | Proposed | Trims instruction tokens if Phase 1 baseline exposes provider-specific failure clusters. | Asserted | 2 | S (1 h) | Low (prompt edit) |
| **C10** | Programmatic two-strike escalation in extension | `templates/plan-exec-handoff/AGENTS.template.md`, `docs/research/frontier-plan-gemini-execution-strategy.md:§6` | Feature | Proposed | Automatically escalates `thinking_level` to `high` on strike 1 and aborts runaway loops on strike 2. | Asserted | 3 | M (5 h) | Medium (hook override) |
| **C11** | Multi-account weekly pacing calculations | `packages/core/src/pacing.ts:21-25`, `packages/core/src/dashboard/builder.ts:92-98` | Feature | Gap | Extends pacing ceiling calculation to sections with $>1$ account or non-`muse-code` providers. | Measured | 2 | M (3 h) | Low (pure domain) |
| **C12** | Cross-platform OS incident toast notifications | `apps/omp-extension/src/toast.ts:40-58`, `scripts/windows-toast.ps1` | Feature | Gap | Adds notification support for macOS (`osascript`) and Linux (`notify-send`). | Measured | 2 | S (2 h) | Low (subprocess) |
| **C13** | Desktop provider logo for `muse-code` | `apps/desktop/src/renderer/provider-logos.ts:6-10` | Feature | Gap | Adds SVG brand logo and mapping for `muse-code` in the desktop widget panel. | Measured | 1 | S (1 h) | Zero (renderer asset) |
| **C14** | External Graphify & Repomix developer skills | `docs/research/graphify-token-savings.md`, `docs/research/graphify-alternatives-comparison.md` | Tooling | Proposed | Provides AST graph retrieval (~80–95% query token cut) and whole-repo packing for external audits. | Measured | 2 | M (4 h) | Low (external skill only) |
| **C15** | Reverse proxy stream compression (`billion-context`) | `docs/research/billion-context-evaluation.md:1-197` | Arch | Refuted | External proxy attempting to compress context stream via hardcoded 50k token threshold. | Refuted | -2 | L (12 h) | High (cache break) |
| **C16** | Graphify inside `packages/core` & in-process repo map | `docs/research/graphify-alternatives-comparison.md:§2,§5` | Arch | Prohibited | Native Tree-sitter graph or Aider-style PageRank map inside `packages/core`. | Measured | 1 | L (12 h) | Extreme (`core` I/O breach) |
| **C17** | Public packaging, npm publishing & signed binaries | `docs/roadmap.md:447-448`, `docs/adr/0003-public-release-scope.md` | DevOps | Excluded | Packaging for external public distribution via npm or GitHub Releases. | Asserted | 1 | L (16 h) | High (release overhead) |
| **C18** | Standalone web dashboard server | `docs/roadmap.md:447`, `HANDOFF.md:161-166` | Feature | Excluded | Web-based HTTP dashboard server. | Asserted | 1 | L (20 h) | Medium (extra port/daemon) |
| **C19** | Provider SDK & generalized plugin interfaces | `docs/roadmap.md:447` | Arch | Excluded | Abstracted SDK for third-party providers. | Asserted | 1 | L (16 h) | High (premature abstraction) |
| **C20** | Additional usage providers (Copilot, Anthropic) | `packages/core/src/usage-providers.ts:18-52`, `docs/roadmap.md:5-9` | Feature | Excluded | Adding usage tracking adapters for providers outside the 4 in scope. | Asserted | 1 | M (8 h) | Low |
| **C21** | Cross-platform reliability proof parity | `docs/roadmap.md:448-450`, `docs/adr/0004-cross-platform-support.md` | Platform | Excluded | Extending the 30-day zero-manual-fix reliability proof requirement to macOS and Linux. | Asserted | 1 | L (20 h) | High (unsupported hardware) |
| **C22** | Periodic background idle route probing | `docs/adr/0001-event-driven-health.md:17-24`, `docs/adr/0006-manual-account-warmup.md` | Arch | Prohibited | Scheduled active route probing during idle agent sessions. | Measured | -1 | S (2 h) | Extreme (wastes token quota) |
| **C23** | Cross-machine state synchronization / distributed DB | `docs/roadmap.md:435-437`, `docs/runbook.md:35-39` | Arch | Prohibited | Synchronizing SQLite event history or policies across workstations over the network. | Asserted | -1 | L (16 h) | Extreme (breaks independence) |
| **C24** | Lower-model fallback or thinking-level reduction | `HANDOFF.md:180-184` | Arch | Prohibited | Workaround falling back to inferior models or reducing reasoning effort when errors occur. | Measured | -2 | S (2 h) | Extreme (degrades accuracy) |

---

## MoSCoW ranking

### 1. Must Have (M) — Critical for Metric Validity & Proof
*Items without which the reliability proof or north-star measurement mechanism fails.*

- **Fix and Validate `costProxy` Token Extraction (`C01`)**
  - *Rationale:* In `apps/omp-extension/src/auto-heal.ts:254-256`, token extraction evaluates `event` and `last`, but `parseLastAssistantMessage` strips `usage`, causing all recorded `agent_run` events to fall back to a fixed `tok=1200` (`docs/roadmap.md:125-130`). Until resolved, `costProxy` is invalid, compromising the Phase 1 baseline and the Day-80 exit gate ($\text{costProxy} \le +10\%$).
  - *Effort:* $\text{Medium}$ ($5\text{ h}$ midpoint).
  - *Must-Tier Effort Cap Check:* $5\text{ h} \le 20\text{ h}$ capacity cap. Satisfies arithmetic limit without demotions.

### 2. Should Have (S) — High-Leverage Operational & Quality Improvements
*High-impact items backed by measured empirical evidence, ranked Phase 2 menu items, or high-risk test coverage gaps.*

- **Lock Evaluated Model Roles in User Config (`C02`)**
  - *Rationale:* Ranked #1 in Phase 2 menu (`docs/roadmap.md:313-316`). Empirical 2x2 scorecard in `docs/research/model-pairing-eval-results.md` proves Pair A (`deepseek/deepseek-flash` for plan & default with `thinking_level: low`) achieves a 100% solve rate across tasks T1–T5 at $\$0.02$ cost (vs. $\$0.15+$ for frontier models). Effort: $1\text{ h}$.
- **Apply Plan-to-Executor Handoff Contract Template (`C03`)**
  - *Rationale:* Ranked #2 in Phase 2 menu (`docs/roadmap.md:317-319`). Deploys `templates/plan-exec-handoff/AGENTS.template.md` via `/template apply plan-exec-handoff`. Prevents executor initiative hallucination, which research documents as causing a drop from $36.97\%$ to $23.63\%$ on benchmark solve rates when unconstrained. Effort: $1\text{ h}$.
- **Audit Probe Wire Pins vs. Upstream Antigravity Client (`C04`)**
  - *Rationale:* `DEFAULT_MODEL_WIRE = "gemini-3.8-flash-high"` and `UA_VERSION = "2.24.0"` in `apps/omp-extension/src/probe-client.ts` are unverified against upstream OMP 18.12.5 release diffs (`docs/roadmap.md:131-134`). Auditing and updating these constants prevents sudden gateway deprecation errors. Effort: $1\text{ h}$.
- **Add Missing Colocated Tests for High-Surface Modules (`C05`)**
  - *Rationale:* `apps/omp-extension/src/commands.ts` exposes 530 LOC covering 8 `/gemini-*` slash commands and the `gemini_health` tool with zero colocated tests; `scripts/reliability/` has zero test suites for `execution-report.ts` and `reliability-report.ts`. Unit testing these mission-critical files prevents regressions during active refactoring. Effort: $5\text{ h}$.
- **Deduplicate Desktop & CLI Pacing Sample Stores (`C06`)**
  - *Rationale:* Near-identical implementations of `recordAndLoadPacingSamples` and `writeFileAtomic` in `apps/desktop/src/pacing-store.ts` and `apps/provider-usage/src/pacing-store.ts` create maintenance drift. Must be consolidated into a shared utility outside `packages/core` (preserving core zero-I/O purity). Effort: $1\text{ h}$.

### 3. Could Have (C) — Contingent Enhancements & Ergonomics
*Valuable improvements that are contingent on external triggers, cosmetic, or non-essential for a solo Windows operator.*

- **Re-Evaluate Model Pairings on Catalog Shifts (`C07`)**
  - *Rationale:* Ranked #3 in Phase 2 menu (`docs/roadmap.md:320-323`). Contingent on trigger: *upstream provider model changes, deprecations, or pricing restructuring*. No shift has occurred since the 2026-10-28 benchmark. Effort: $1\text{ h}$.
- **Gemini Wire-Normalizer Targeted Fixes (`C08`)**
  - *Rationale:* Ranked #4 in Phase 2 menu (`docs/roadmap.md:324-326`). Normalizer is already shipped in `apps/omp-extension/src/gemini-normalizer.ts`. Contingent on trigger: *an active wire failure reproduced by a failing test in the suite*. Roadmap mandates skipping this unless reproduced. Effort: $3\text{ h}$.
- **Tighten Context-Economy Instructions in AGENTS.md (`C09`)**
  - *Rationale:* Ranked #5 in Phase 2 menu (`docs/roadmap.md:327-329`). Contingent on trigger: *Phase 1 baseline data reveals error clusters or token bloat tied to specific prompt sections*. Lowest-ranked Phase 2 item. Effort: $1\text{ h}$.
- **Programmatic Two-Strike Escalation in Extension (`C10`)**
  - *Rationale:* Currently enforced contractually in `AGENTS.template.md`. Programmatic enforcement in `apps/omp-extension` intercepts tool errors to elevate `thinking_level` to `high` for one retry. Contingent on trigger: *Phase 1 telemetry reveals repeated retry-loop failures*. Effort: $5\text{ h}$.
- **Multi-Account Weekly Pacing Calculations (`C11`)**
  - *Rationale:* `packages/core/src/dashboard/builder.ts:93` suppresses weekly pacing when `section.reports.length !== 1`, and `packages/core/src/pacing.ts:22` filters exclusively for `muse-code`. Generalizing this provides budget pacing for other providers, but pacing is designated maintain-only for the current cycle. Effort: $3\text{ h}$.
- **Cross-Platform OS Incident Toast Notifications (`C12`)**
  - *Rationale:* `apps/omp-extension/src/toast.ts:44` hardcodes `powershell.exe` and `windows-toast.ps1`. Supporting macOS (`osascript`) and Linux (`notify-send`) is desirable for cross-platform users, but the solo operator operates exclusively on Windows. Effort: $2\text{ h}$.
- **Desktop Provider Logo for `muse-code` (`C13`)**
  - *Rationale:* `apps/desktop/src/renderer/provider-logos.ts` lacks an SVG asset and entry for `muse-code`. Purely cosmetic visual polish. Effort: $1\text{ h}$.
- **External Graphify & Repomix Developer Skills (`C14`)**
  - *Rationale:* Graphify provides Tree-sitter AST subgraph retrieval (~80–95% query token cut on 1M-LOC codebases), and Repomix provides 70% compression for one-shot audits (`docs/research/graphify-token-savings.md`). Recommended strictly as external CLI skills (`skill://graphify`), never as monorepo dependencies. Effort: $4\text{ h}$.

### 4. Won't Have (W / This Backlog) — Refuted, Prohibited, or Excluded
*Candidates explicitly rejected based on empirical measurement, architectural invariants, or roadmap boundaries.*

- **`billion-context` Reverse Proxy Adoption (`C15`):** **REJECTED.** Empirically tested on 2026-10-29 (`docs/research/billion-context-evaluation.md`). Compression never engaged due to a hardcoded 50k token threshold; payload expanded by $+8.3\%$ ($+11.1\text{ KiB}$) per turn from injected tool definitions; breaks upstream byte-stable prefix caching (93–94% hit rate); license attribution conflicts with clean source distribution.
- **Graphify in `packages/core` & In-Process Repo Map (`C16`):** **PROHIBITED.** Placing Tree-sitter parsing or file indexing into `packages/core` violates the foundational architectural invariant: pure domain logic with zero I/O, zero network, zero process calls (`.omp/AGENTS.md:3`). Furthermore, compiler LSP (`xd://lsp`) and `ast-grep outline` already provide deterministic symbol precision at $\sim 50\text{--}150$ tokens per query without indexing overhead (`docs/research/graphify-alternatives-comparison.md:§5`).
- **Public Packaging, npm Distribution & Signed Binaries (`C17`):** **EXCLUDED.** Explicitly deferred past Day 90 by `docs/roadmap.md:447-448` and `docs/adr/0003-public-release-scope.md`. The solo operator executes directly from git source checkouts; public release overhead wastes limited weekly capacity.
- **Standalone Web Dashboard Server (`C18`):** **EXCLUDED.** Explicitly excluded by the Roadmap Definition of Done (`docs/roadmap.md:447`). The desktop Electron tray widget and the TerminUI terminal monitor completely satisfy operator observability.
- **Provider SDK & Generalized Extension APIs (`C19`):** **EXCLUDED.** Purpose-built for OMP; creating generic provider SDK abstractions is dead-weight architecture for a fixed 4-provider deployment.
- **Additional Usage Providers (`C20`):** **EXCLUDED.** Scope is locked strictly to the 4 active providers (Google Antigravity, OpenAI Codex, Muse Code, DeepSeek). Adding Anthropic or Copilot yields zero value for this operator.
- **macOS / Linux Reliability Proof Parity (`C21`):** **EXCLUDED.** The 30-day zero-manual-fix reliability proof is strictly scoped to two Windows workstations (`docs/roadmap.md:5-9`). Non-Windows platforms remain maintain-only best-effort.
- **Periodic Background Idle Route Probing (`C22`):** **PROHIBITED.** Probing routes while no coding session is active wastes provider token quotas, violating `docs/adr/0001-event-driven-health.md` and `docs/runbook.md:257-264` (Zero Idle Tokens invariant).
- **Cross-Machine State Synchronization & Distributed DB (`C23`):** **PROHIBITED.** Violates the two-machine independence invariant (`docs/roadmap.md:435-437`). Workstations must maintain isolated state and independent SQLite history files without network coupling.
- **Lower-Model Fallback or Thinking Degradation on Error (`C24`):** **PROHIBITED.** Silently falling back to weaker models or reducing thinking levels during errors degrades implementation quality (`HANDOFF.md:180-184`). Route circuit breaking and auto-restore are the sole authorized remedies.

---

## Recommended development sequence

Development must proceed strictly one item at a time in the following priority order:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. [MUST] Fix & Validate costProxy Token Extraction (C01)               │
│    Done signal: execution:report prints distinct tok values across runs │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. [SHOULD] Lock Pair A Model Roles in User Config (C02)               │
│    Done signal: config.yml contains deepseek-flash; costProxy slashes  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. [SHOULD] Apply Handoff Contract Template (C03)                      │
│    Done signal: /template apply plan-exec-handoff; AGENTS.md aligned    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 4. [SHOULD] Audit Probe Wire Pins vs. Upstream (C04)                   │
│    Done signal: Documented version match in runbook; constants pinned  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 5. [SHOULD] Add Missing Colocated Tests (C05)                          │
│    Done signal: commands.test.ts and reliability tests pass in check   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 6. [SHOULD] Deduplicate Pacing Sample Stores (C06)                     │
│    Done signal: Single shared store helper; bun run check passes       │
└────────────────────────────────────────────────────────────────────────┘
```

1. **`[MUST]` Fix & Validate `costProxy` Token Extraction (`C01`)**
   - *Target:* `apps/omp-extension/src/auto-heal.ts:32-67,254-256`.
   - *Action:* Inspect raw `agent_end` event payload to extract actual token counts (`totalTokens`, or `inputTokens + outputTokens`) before falling back to `last` message details.
   - *Done Signal:* Running `bun run execution:report --days=14` outputs distinct `tok=<n>` values across sessions of varying length, resolving the constant `tok=1200` anomaly.
2. **`[SHOULD]` Lock Pair A Model Roles in User Config (`C02`)**
   - *Target:* `~/.omp/agent/config.yml`.
   - *Action:* Set `modelRoles: { plan: "deepseek/deepseek-flash", default: "deepseek/deepseek-flash" }` with executor `thinking_level: low`.
   - *Done Signal:* Executing test runs records `provider = deepseek` in `omp-toolkit-history.db` with low execution latency.
3. **`[SHOULD]` Apply Plan-to-Executor Handoff Contract Template (`C03`)**
   - *Target:* `~/.omp/agent/AGENTS.md`.
   - *Action:* Run `/template apply plan-exec-handoff` inside OMP.
   - *Done Signal:* `~/.omp/agent/AGENTS.md` matches `templates/plan-exec-handoff/AGENTS.template.md`, enforcing zero-invention planning and 2-strike verification.
4. **`[SHOULD]` Audit Probe Wire Pins vs. Upstream Antigravity Client (`C04`)**
   - *Target:* `apps/omp-extension/src/probe-client.ts:10,17`.
   - *Action:* Verify `DEFAULT_MODEL_WIRE = "gemini-3.8-flash-high"` and `UA_VERSION = "2.24.0"` against the upstream OMP Antigravity client release.
   - *Done Signal:* Audit record logged in `docs/runbook.md`, with updated pins committed if changed.
5. **`[SHOULD]` Add Missing Colocated Tests for High-Surface Modules (`C05`)**
   - *Target:* `apps/omp-extension/src/commands.test.ts`, `scripts/reliability/execution-report.test.ts`, `scripts/reliability/reliability-report.test.ts`.
   - *Action:* Implement deterministic unit tests covering command registration, error boundaries, argument parsing, and table formatting.
   - *Done Signal:* `bun run check` executes all new test suites with 100% pass rate.
6. **`[SHOULD]` Deduplicate Desktop & CLI Pacing Sample Stores (`C06`)**
   - *Target:* Shared adapter utility file (e.g., `packages/tui/src/pacing-store.ts` or `scripts/pacing-store.ts`).
   - *Action:* Extract common `writeFileAtomic` and `recordAndLoadPacingSamples` logic without violating `packages/core` purity.
   - *Done Signal:* Duplicate files in `apps/desktop/` and `apps/provider-usage/` removed; both import the single shared implementation; `bun run check` passes.

---

## Operational prerequisites (no development)

The following operational actions must be performed by the operator to satisfy phase exit gates. These require no code development:

1. **Install Machine 2 & Verify Diagnostics:**
   - Execute the 7-step checklist in `docs/runbook.md:44-78` on the second Windows machine.
   - Run `bun run doctor` to verify 6/6 PASS (`omp-version`, `installed-files`, `history-db`, `machine-id`, `lock-file`, `orca-terminal`).
   - Run `bun run reliability:report --days=1` to confirm distinct machine identity.
2. **Opt In `<account>` to Auto-Restore:**
   - Run `/gemini-auto-restore <account>` on Machine 1 to write `~/.omp/agent/gemini-health-auto-restore.json`.
   - Prevents manual lockout from breaking the 30-day zero-manual-fix reliability gate.
3. **Maintain Continuous Monitor Heartbeat:**
   - Keep `bun run monitor:orca` active in the background to prevent stale heartbeat alerts in `reliability:report`.
4. **Accrue Phase 1 Baseline Telemetry:**
   - Operate normally across both machines for $\ge 14$ consecutive days, accumulating $\ge 30$ pooled `agent_run` records.

---

## Sources

### Repository Files
- `docs/roadmap.md` — 90-day execution-quality roadmap, north-star metrics, Phase 2 menu, and exclusions.
- `docs/runbook.md` — Machine 2 rollout checklist, doctor diagnostics, and incident procedures.
- `docs/research/model-pairing-eval-results.md` — Empirical 2x2 model role scorecard across tasks T1–T5.
- `docs/research/billion-context-evaluation.md` — Empirical evaluation and rejection of `billion-context`.
- `docs/research/oh-my-pi-token-saving-strategy.md` — Six-pillar token architecture and prefix-caching invariants.
- `docs/research/graphify-token-savings.md` & `graphify-alternatives-comparison.md` — AST index retrieval economics vs. LSP.
- `docs/research/frontier-plan-gemini-execution-strategy.md` — Asymmetric planner-executor strategy and handoff contracts.
- `docs/research/practical-implementation-blueprint.md` — Gemini prompt optimizer, wire normalizer specs, and eval harness.
- `docs/adr/0001-event-driven-health.md` — Event-driven health probing and zero-idle-token architecture.
- `docs/adr/0002-opt-in-auto-restore.md` — Sidecar auto-restore opt-in mechanics.
- `docs/adr/0003-public-release-scope.md` — Source-only distribution policy.
- `docs/adr/0004-cross-platform-support.md` — Platform tier definitions (Windows primary, macOS/Linux best-effort).
- `docs/adr/0007-multi-provider-time-window-scheduling.md` — Time-window pricing policy architecture.
- `apps/omp-extension/src/auto-heal.ts` — Session telemetry recording and token extraction scraper.
- `apps/omp-extension/src/gemini-normalizer.ts` — Wire request interceptor for Gemini API.
- `apps/omp-extension/src/probe-client.ts` — Upstream Antigravity probe client and version pins.
- `apps/omp-extension/src/toast.ts` — Windows toast notification dispatcher.
- `apps/desktop/src/renderer/provider-logos.ts` — Desktop provider brand logo registry.
- `packages/core/src/pacing.ts` & `packages/core/src/dashboard/builder.ts` — Pacing calculation and single-account limits.
- `scripts/eval/eval-tasks.ts` — Benchmark evaluation tasks T1–T5 (identifying synthetic eval fixtures).

### External Specifications & Literature
- Google Generative AI REST API Reference: `streamGenerateContent` and `v1internal` protocol (`https://ai.google.dev/gemini-api/docs`).
- OMP Upstream Issue #14790: Trailing model turn `400 INVALID_ARGUMENT` API rejection.
- Google AI Developer Forum Issue #180934: Reflective monologue tool call suppression in reasoning models.
- Artificial Analysis Intelligence Index v4.3.2 methodology (`https://artificialanalysis.ai`).
- Apple Research: *The Illusion of Thinking: Investigating the Limits of Reasoning in Large Language Models* (arXiv:2410.05229).
- NoLiMa: *Needle on a Limitless Mountain — Measuring Long-Context Attention Decay* (arXiv:2502.05167).
