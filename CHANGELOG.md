# Changelog

## Unreleased

- Redesign the desktop panel around status-first Usage, Gateway, and Settings views: truthful All / High usage / Needs attention filters, always-visible provider summaries, explicit quota labels, preserved Settings drafts with acknowledged saves, inline Stop/Restart confirmation, and provider-access guidance moved out of the account list.
- Add a desktop-panel notice explaining OMP's built-in Google Antigravity pause, comparing the running OMP build (version plus SHA-256) against the recorded 18.18.6 checkpoint, and listing the reviewed manual `google-gemini-cli` login and model-selection steps; it never signs in, sends a model request, or changes configuration.
- Pause Gemini health by default: with `GEMINI_HEALTH_ENABLED` unset or not `1`, startup checks, idle recovery, stall auto-heal, `/gemini-*` commands, the `gemini_health` tool, CLI probes, and desktop warm-up/check perform no account discovery, probing, or policy mutation, and report the pause instead; resume explicitly with `GEMINI_HEALTH_ENABLED=1`.
- Fix route detection to prove a completed model response: the probe now frames SSE events across arbitrary chunks, rejects in-band auth/quota/transient errors, and requires non-empty model text plus a successful terminal `finishReason` before reporting `OK`.
- Record route health per provider/account/project/model with per-observation timestamps, ordered evidence merge, and a schema-2 snapshot that also carries streaks and a complete-sweep watermark; legacy snapshots and the `gemini-health-streaks.json` sidecar are no longer trusted.
- Require a confirmed retryable failure and a fresh, non-excluded healthy alternative on the same probe model before excluding an account, and never edit pre-existing user policies.
- Report `STALE` route health per row instead of inheriting the snapshot timestamp, and stop attaching Gemini health to other providers or models that share an email.
- Serialize incident, history, and opt-in sidecar mutations under `omp-toolkit.lock`, and stop stealing locks whose recorded local process is still alive.
- Remove the obsolete `resolveStreakPath` resolver and streak sidecar documentation.
- Add account ordering per provider section: `weekly-reset` (default, soonest weekly reset first) and `weekly-usage`, selectable in Desktop Settings and via `--sort` / `OMP_ACCOUNT_SORT`.
- Hide provider sections with no local OMP credential on this machine, so secondary PCs no longer show cached usage from accounts they are not signed in to; API-key providers such as DeepSeek stay visible.
- Add collapsible provider cards with accordion toggle, header status preview badges (account count, worst route, peak quota %), and `localStorage` layout persistence.
- Add interactive status metric filter chips (`All`, `Healthy`, `≥80%`, `Issues`) in the desktop panel header with one-click filtering and clean zero-match card hiding.
- Add account row micro-actions: click-to-copy email with inline checkmark feedback, and click-to-probe degraded route badges (`HANG`, `ERR`, `AUTH`, `MODEL`) triggering instant unhang checks with in-flight spinner.
- Add Desktop Gateway interactive controls (1-click Start, Stop, Restart, Doctor) and an expandable Gateway Drawer with endpoint copying and quick harness recipe selector (Claude Code, OpenCode, Cline, Cursor, Aider, curl).
- Add unified 1-step `gateway:ctl connect <platform> [name]` command provisioning client tokens and generating ready-to-run setup snippets in one command.
- Upgrade in-OMP `/gateway` slash command to rich Markdown status cards and tables with full command parity (connect, drain, undrain, block, unblock, policy).
- Fix `gateway:ctl --help` and `-h` flag handling to exit code 0, and provide actionable repair suggestions on doctor check failures.
- Add Autonomous Quota Cooldown in Gateway (`evaluateQuotaCooldowns` and `autoCooldownSweep`), dynamically applying cooldown blocks to accounts reaching $\ge 99\%$ quota until their reset timestamp while preserving the Surviving Account Invariant.
- Add proactive Desktop OS Notifications (`evaluateQuotaAlerts`) alerting the operator on $\ge 90\%$ quota warning thresholds and quota rollover resets with 15-minute debouncing.
- Add 1-click remote pairing command `gateway:ctl remote-pair <platform> [name]` (and `/gateway remote-pair`) outputting self-contained PowerShell and Bash setup one-liners for secondary PCs.
- Add Remote Client Doctor in Gateway (`gateway:ctl doctor --remote` and `/gateway doctor --remote`), diagnosing remote base URL, Cloudflare Access headers, public tunnel reachability, and gateway bearer auth in 1 command with actionable repair hints.
- Add Nerd Font Downloader and Installer (`bun run font:install [family]` and `/font-install [family]`), downloading patched release archives from GitHub, installing font variants into the non-elevated user font store, broadcasting live font table updates on Windows without reboot, and atomically configuring Windows Terminal default font face.
- Publish research report on Unified Gateways and round-robin Gemini load balancers on GitHub (`docs/research/gemini-unified-gateways-round-robin.md`), analyzing open-source archetypes (CLIProxyAPI, LiteLLM, One-API, OMP), comparison matrices, and the prompt cache invalidation penalty.
- Add OMP Thin-Client platform recipe (`gateway:ctl recipe omp` and `connect omp`), generating ready-to-paste `models.yml` configurations for secondary workstations to consume the primary PC1 gateway without local OAuth authorization.
- Add automatic Cloudflare credentials fallback (`~/.omp/cf-access.json`) and `--with-tunnel` support to Windows headless autostart (`gateway:ctl autostart-install --with-tunnel`).
- Publish architectural strategy and research on Always-On Gateway operations and Thin-Client topology (`docs/research/always-on-gateway-architecture-pc1.md`).
- Add Gemini-3.8-Flash Agent Harness prompt templates (`gemini-tdd`, `gemini-diagnose`, `gemini-speed`), incorporating Inverted Context Layout, Anti-Suppression Procedural Stance, Pre-Tool Chatter Redirection, and Paired Negative Bounding, switchable live via `/template apply <name>`.
- Publish architectural research on Agent Skills vs. `AGENTS.md` and progressive disclosure in modern agent harnesses (`docs/research/agent-skills-vs-agents-md-analysis.md`), detailing Context Load vs. Cognitive Load, positional attention decay, and KV prompt cache stability.
- Streamline OMP prompt templates (`templates/gemini-tdd`, `templates/gemini-diagnose`) to adopt 3-tier progressive disclosure, eliminating procedural duplication by delegating to specialized agent skills (`skill://tdd`, `skill://diagnosing-bugs`) via pushy context pointers.

## 0.5.0 — Auth Gateway, prompt templates, pacing, and public-readiness cleanup (2026-11-03)

- Add the Auth Gateway for secondary PCs: daemon manager, scoped client tokens with SHA-256 hashing and revocation, Cloudflare Tunnel templates, gateway doctor probe, `/gateway` slash command, desktop status indicator, and client onboarding bundles.
- Add prompt templates: `/template save|apply|list|show|delete` for named global `AGENTS.md` + `RULES.md` bundles, with checkout resolution, atomic backups, and a plan-to-executor handoff template.
- Add weekly quota pacing with daily pacing, ceiling and headroom markers in the TUI and desktop panel, multi-account pacing, and a shared pacing store.
- Add reliability operations: opt-in auto-restore with a conditional idle recovery timer (ADR-0009), incident lifecycle with OS toasts, two-strike escalation, agent-run telemetry with `execution:report`, an exclusive health lock, and strict policy reads.
- Add `bun run doctor` diagnostics and the probe wire-pin audit.
- Surface Settings in the desktop footer and on `Ctrl+,`, and add typed IPC contracts, tray status/settings entries, dynamic panel height, gateway status, launch-failure persistence, and a stale-`dist` guard.
- Deepen core seams with `DashboardEngine`, shared `UsageDataSource`, `ScheduleRegistry`, `AntigravityHealthManager`, `DesktopRuntime`, and `MonitorRunner`; segregate core types by domain, wire, and presentation.
- Vendor Lobe provider logos, add the Muse Code mark, and explain accounts, routes, and limit cells in the desktop panel.
- Sort accounts by weekly usage and mark weekly pacing ceilings.
- Rewrite the README for operator-first reading, restrict the glossary to domain vocabulary, and record ADR-0009 for the conditional idle recovery sweep.
- Fix template backup retention so installer backups are never pruned.
- Isolate extension tests from host paths and real OMP state so CI runs without an installed `omp` binary.
- Harden health locks against TOCTOU theft, keep SQLite connections readonly, and make restore eligibility case-insensitive.
- Strip trailing user turns and empty parts from Gemini wire requests and expand chatter filtering.
- Resolve the installed gateway script path, pass DeepSeek thresholds into desktop compilation, and fix CSP style blocking.
- Remove unused modules and exports, internal research notes, the folder blueprint, and the refactor log; scrub the personal account fixture; fix the Biome barrel-order gate.
- Pin `typescript`, `@biomejs/biome`, `@types/bun`, and `@types/node` to resolved versions.

## 0.4.0 — Desktop configuration settings, script modularization, and UX polish (2026-10-26)

- Add in-panel Desktop User Configuration Settings view toggled via header gear icon.
- Add atomic persistence for settings in Electron's `userData/settings.json`.
- Support live runtime reloading for polling intervals (30–3600s), DeepSeek balance alert thresholds, theme preferences (`system`, `light`, `dark`), and "start at login" autostart.
- Re-architect and modularize `scripts/` into cohesive feature subfolders: `build/`, `desktop/`, `eval/`, `install/`, `monitor/`, `reliability/`, and `tokens/`.
- Add cross-platform desktop shortcut generation CLI and module (`scripts/desktop/create-desktop-shortcut.ts`, `.ps1`).
- Polish desktop webview styling: segmented controls for theme switching, custom toggle switch, tactile button active states, and enhanced error state with in-line retry.
- Add interactive keybinding hints in TUI monitor (`r` refresh, `q` quit, `Tab` schedule).

## 0.3.0 — Desktop widget refresh, terminal launchers, and scrolling (2026-10-22)

- Add cross-platform terminal launchers (`omp-widget.cmd`, `omp-widget.sh`) and
  Windows desktop shortcut creator (`scripts/desktop/create-desktop-shortcut.ps1`).
- Fix desktop panel container height so provider content scrolls properly
  instead of clipping off-screen.
- Replace theSVG provider marks with Dashboard-Icons (Gemini, OpenAI,
  DeepSeek).
- Add self-hosted variable font pairing: Inter Variable for UI hierarchy and
  JetBrains Mono Variable for numeric and route tabular density.
- Expand desktop panel to 700×720 CSS Grid with roomier card padding, 24 px
  logos, and 30 px action buttons.
- Add rounded-square app-mark chip tray icon with bottom-right status badge
  dot.
- Add minimize-to-tray affordance with dynamic tray-menu label (`Minimize to tray`
  / `Show panel`).
- Add `desktop`, `desktop:preview`, and `desktop:once` NPM scripts; keep
  `bun run widget` as a compatibility alias.
- Fix desktop Electron entry point path to resolve `dist/main.cjs`.

## 0.2.0 — Cross-platform desktop widget (2026-10-21)

- Add Electron desktop widget host (`bun run widget`) with a notification-area /
  menu-bar icon and compact always-on-top panel.
- Add OKLCH desktop light and dark color tokens, spacing, typography, and an
  automated APCA (|Lc| >= 60) contrast gate (`scripts/tokens/check-tokens.ts`).
- Add pure shared dashboard model in `@omp-toolkit/core` with versioned schema-2
  JSON payload in `apps/provider-usage`.
- Refactor `@omp-toolkit/tui` to consume the shared core dashboard model without
  output drift.
- Add vector Material Design Icons (`@mdi/js`) for panel actions and provider
  brand logos from theSVG (Google, OpenAI, DeepSeek).
- Use maintained dependencies (`colorjs.io/fn`, `which`, `shell-quote`, `plist`,
  `@mdi/js`) with partial-import paths.
- Reorganize documentation into lowercase files, record ADR-0005, and add a
  Windows/macOS/Linux CI matrix.
- Add `THIRD_PARTY_NOTICES.md` covering all third-party dependencies and brand
  trademarks.

## 0.1.0 — Initial public release (2026-10-21)

- Add `@omp-toolkit/core` domain package for provider usage grouping, column
  selection, route ordering, healthy streaks, and policy membership.
- Add `@omp-toolkit/tui` package with design-token-backed ANSI theme and the
  OMP Provider Usage frame.
- Add `apps/provider-usage` CLI showing all authenticated OMP providers with
  per-account Gemini route status.
- Add `apps/omp-extension` event-driven Gemini health adapter with temporary
  account circuit breakers, healthy-streak auto-restore, guarded explicit
  re-enable, and health snapshot persistence.
- Add provider-usage monitor, DeepSeek balance, Gemini route health, reliability
  history, and Orca Floating Workspace launcher.
- Publish under the MIT license with a Windows-first support boundary.
- Add Bun workspace tooling, tests, build/install scripts, and docs.
