# Project Folder Structure Blueprint

**Document Version:** 1.1.0  
**Last Updated:** 2026-10-26  
**Repository:** `omp-toolkit` (`https://github.com/kamishino/omp-toolkit`)  
**Maintainer:** OMP Toolkit Contributors

This document serves as the definitive architecture and folder structure guide for the `omp-toolkit` monorepo. It establishes file placement rules, architectural layer boundaries, naming conventions, build pipelines, and extension patterns to guarantee long-term code organization consistency.

---

## Initial Auto-Detection Phase

The codebase is a modern, high-performance TypeScript monorepo powered by **Bun**:

- **Runtime & Package Manager:** `bun@1.4.3` (`packageManager: bun@1.4.3`, `engines: bun >= 1.4.3`).
- **Language & Compiler:** TypeScript 5.x (`tsconfig.json` target ES2022, bundler module resolution, `verbatimModuleSyntax: true`).
- **Linter & Formatter:** Biome (`@biomejs/biome`, `biome.json`).
- **Monorepo Workspaces:** Bun workspaces defined in root `package.json`:
  - `packages/*` (`packages/core`, `packages/tui`).
  - `apps/*` (`apps/provider-usage`, `apps/omp-extension`, `apps/desktop`).
- **Desktop Subsystem:** Electron (`apps/desktop` with native tray, main/preload/renderer process isolation, and `@fontsource-variable/jetbrains-mono`).
- **Terminal UI Engine:** `terminui` (Ratatui-inspired pure-functional double-buffered cell diffing).
- **Design Tokens:** Design Tokens Community Group (DTCG) specification (`design/tokens.json`) with APCA contrast validation.

---

## 1. Structural Overview

The repository enforces strict architectural seams between pure domain calculation, terminal presentation, and host adapters:

```
┌─────────────────────────────────────────────────────────────┐
│                    Host Adapters & Apps                     │
│  apps/provider-usage   apps/omp-extension   apps/desktop    │
└──────────────┬──────────────────────┬──────────────┬────────┘
               │                      │              │
               ▼                      │              ▼
┌─────────────────────────────┐       │     ┌─────────────────┐
│     Presentation Layer      │       │     │  Design Tokens  │
│        packages/tui         │       │     │ design/tokens   │
└──────────────┬──────────────┘       │     └────────┬────────┘
               │                      │              │
               ▼                      ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Pure Domain Logic                       │
│                       packages/core                         │
└─────────────────────────────────────────────────────────────┘
```

### Layer Boundary Rules

1. **`packages/core` (Pure Domain):**
   - **Zero I/O:** Zero filesystem access, zero network calls, zero child processes, zero ANSI escapes.
   - **Pure Computations:** Usage calculations, balance formatting, time-window scheduling policies, health streak state transitions, dashboard grouping.
   - **Dependencies:** Self-contained. May not import from `packages/tui`, `apps/*`, or root scripts.

2. **`packages/tui` (Presentation Layer):**
   - **Zero Terminal I/O:** Pure presentation that draws into `terminui` frame buffers or produces test-backend strings.
   - **Token Binding:** All colors and thresholds MUST bind strictly to `design/tokens.json`. Zero raw hex values (`#fff`) or hard-coded RGB literals.
   - **Dependencies:** Imports only `@omp-toolkit/core`, `terminui`, and `design/tokens.json`.

3. **`apps/provider-usage` (CLI Adapter):**
   - **Responsibility:** CLI flag parsing (`--watch`, `--json`, `--health`, `--schedule`), reading `omp usage` and health snapshots, driving the interactive `terminui` watch loop with keybindings (`q`, `r`, `s`, `Tab`).

4. **`apps/omp-extension` (OMP Runtime Extension):**
   - **Responsibility:** OMP plugin hooks, Gemini wire protocol normalization (`before_provider_request`), account circuit breaker, and route health probe scheduling.
   - **Distribution:** Bundled into a single deployable file at `apps/omp-extension/dist/index.js` copied to `~/.omp/agent/extensions/`.

5. **`apps/desktop` (Electron Desktop Widget):**
   - **Responsibility:** Cross-platform system tray icon, compact floating window, IPC bridge, autostart login item management.

### Directory Depth Standard (The "Colocated Shallow" Rule)

The repository adopts a **"Colocated Shallow (Depth <= 2)"** design philosophy, balancing AI-agent navigability and human mental bandwidth against directory clutter:

- **Flat by Default:** Package and application `src/` directories are flat by default. Files belonging to the same broad layer reside side-by-side.
- **Maximum Depth of 2:** Nesting inside any package or app is strictly capped at 2 levels (e.g. `packages/core/src/schedule/` or `apps/desktop/src/renderer/`). Deep nested paths (`domain/subdomain/feature/component/`) are forbidden.
- **Cognitive & Tooling Optimization:** Shallow directories minimize relative path imports (`../../`), eliminate "directory surfing" tool-call waste for coding agents, and ensure full grep/glob transparency.

---

## 2. Directory Visualization

```text
omp-toolkit/
├── .editorconfig                          # Editor formatting rules
├── .env.example                           # Sample environment configuration
├── .gitattributes                         # Git line-ending attributes
├── .gitignore                             # Ignored build artifacts and local cache
├── biome.json                             # Biome formatter and linter configuration
├── bun.lock                               # Bun lockfile
├── CHANGELOG.md                           # Project release history
├── CODE_OF_CONDUCT.md                     # Contributor code of conduct
├── CONTRIBUTING.md                        # Development and contribution guidelines
├── GLOSSARY.md                            # Ubiquitous domain language dictionary
├── install.ps1                            # Windows PowerShell one-line installer
├── install.sh                             # POSIX Bash one-line installer
├── LICENSE                                # MIT license
├── omp-widget.cmd                         # Windows launcher for desktop tray widget
├── omp-widget.sh                          # POSIX launcher for desktop tray widget
├── package.json                           # Root workspace manifest & orchestrator scripts
├── Project_Folders_Structure_Blueprint.md # This architecture blueprint
├── README.md                              # Main repository documentation & quickstart
├── SECURITY.md                            # Vulnerability reporting protocol
├── THIRD_PARTY_NOTICES.md                 # Open-source third-party software notices
├── tsconfig.json                          # Base TypeScript compiler configuration
│
├── .github/                               # GitHub automation & community templates
│   ├── CODEOWNERS                         # Pull request reviewers and module owners
│   ├── PULL_REQUEST_TEMPLATE.md           # Pull request submission checklist
│   ├── ISSUE_TEMPLATE/                    # Bug report and feature request forms
│   │   ├── bug_report.yml
│   │   ├── feature_request.yml
│   │   └── config.yml
│   └── workflows/
│       └── check.yml                      # CI matrix (Windows, Ubuntu, macOS)
│
├── apps/                                  # Application packages & host adapters
│   ├── desktop/                           # Electron tray widget host
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── main.ts                    # Streamlined Electron lifecycle orchestrator
│   │       ├── actions.ts                 # Terminal monitor and Orca process launchers
│   │       ├── data.ts                    # Monitor process spawn and snapshot consumer
│   │       ├── data.test.ts               # Monitor payload parsing unit tests
│   │       ├── interval.ts                # Auto-refresh timer loop
│   │       ├── interval.test.ts           # Interval parser unit tests
│   │       ├── ipc.ts                     # Main-side IPC registration and channel types
│   │       ├── logger.ts                  # Timestamped error logging utility
│   │       ├── logger.test.ts             # Error logger unit tests
│   │       ├── login-item.ts              # Unified autostart manager (Windows, macOS, Linux)
│   │       ├── login-item.test.ts         # Login item manager unit tests
│   │       ├── once.ts                    # Headless one-shot diagnostic execution
│   │       ├── open.ts                    # Deep terminal launcher (platform quoting, shell spawning)
│   │       ├── open.test.ts               # Terminal launcher unit tests
│   │       ├── panel.ts                   # DesktopPanel lifecycle coordinator (geometry, bounds, tray, visibility)
│   │       ├── panel-position.ts          # Tray-relative window coordinate calculation
│   │       ├── panel-position.test.ts     # Panel position geometry unit tests
│   │       ├── paths.ts                   # Application data and cache directory paths
│   │       ├── paths.test.ts              # Path resolution unit tests
│   │       ├── preload.ts                 # Context-isolated secure IPC bridge
│   │       ├── state.ts                   # Pure panel state machine computation
│   │       ├── state.test.ts              # Panel state computation unit tests
│   │       ├── tray.ts                    # DesktopTray coordinator (Tray instance, context menu, theme updates)
│   │       ├── tray-path.ts               # Dynamic platform tray icon asset resolver
│   │       ├── tray-path.test.ts          # Tray icon resolver unit tests
│   │       ├── warmup.ts                  # Account warmup execution and error formatting
│   │       ├── warmup.test.ts             # Account warmup unit tests
│   │       ├── warmup-handler.ts          # Warm-up confirmation dialog & eligibility coordinator
│   │       └── renderer/                  # Webview presentation layer
│   │           ├── index.html             # Shell HTML document
│   │           ├── renderer.ts            # Reactive state subscription and panel layout
│   │           ├── card.ts                # Pure functional card and row DOM builders
│   │           ├── card.test.ts           # Card DOM builder unit tests
│   │           ├── styles.css             # OKLCH design-token styles
│   │           ├── tokens.ts              # TypeScript token accessors
│   │           ├── provider-logos.ts      # Provider SVG logo component mapper
│   │           ├── provider-logos.test.ts # Provider logo unit tests
│   │           └── assets/providers/      # Bundled SVG logos (DeepSeek, OpenAI, etc.)
│   │
│   ├── omp-extension/                     # OMP runtime extension hook
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts                   # Extension entry point wiring normalizer, auto-heal, and commands
│   │       ├── auto-heal.ts               # AutoHealCoordinator lifecycle hooks and retry triggers
│   │       ├── circuit-breaker.ts         # Autonomous account circuit breaker and health streak tracker
│   │       ├── circuit-breaker.test.ts    # Circuit breaker and policy healing unit tests
│   │       ├── cli.ts                     # Standalone terminal watch loop and warm-up CLI runner
│   │       ├── commands.ts                # OMP CLI commands and tool registrations
│   │       ├── gemini-normalizer.ts       # SSE and tool-call wire protocol normalizer
│   │       ├── gemini-normalizer.test.ts  # Normalizer regression unit tests
│   │       ├── history.ts                 # 30-day reliability history writer and process exit cleanup
│   │       ├── history.test.ts            # Reliability history unit tests
│   │       ├── history-store.ts           # ReliabilityHistoryStore SQLite database and analytical queries
│   │       ├── history-store.test.ts      # History store unit tests
│   │       ├── policy-store.ts            # RoutingPolicyStore OMP policy persistence and temporary exclusions
│   │       ├── policy-store.test.ts       # Routing policy store unit tests
│   │       ├── probe-client.ts            # AntigravityProbeClient OAuth token cache and SSE streaming HTTP client
│   │       ├── probe-client.test.ts       # Antigravity probe client unit tests
│   │       ├── warmup.ts                  # Background route verification logic
│   │       ├── warmup.test.ts             # Warmup orchestrator unit tests
│   │       ├── widget.ts                  # TUI widget status formatting, line builder, and publishing
│   │       ├── widget.test.ts             # Widget presentation unit tests
│   │       └── omp-types.d.ts             # OMP plugin API type declarations
│   │
│   └── provider-usage/                    # CLI usage aggregator & interactive monitor
│       ├── package.json
│       └── src/
│           ├── index.ts                   # CLI entry, flag dispatch, and terminui watch loop
│           ├── config.ts                  # MonitorCliConfig parser, environment fallbacks, and validation
│           ├── config.test.ts             # Monitor config unit tests
│           ├── usage.ts                   # `omp usage` CLI reader and parser
│           ├── interactive-monitor.ts     # InteractiveMonitor terminal lifecycle, raw mode, and polling loop
│           ├── interactive-monitor.test.ts # Interactive monitor unit tests
│           ├── json.ts                    # JSON serialization adapter
│           ├── json.test.ts               # JSON schema unit tests
│           ├── heartbeat.ts               # Monitor heartbeat state writer
│           ├── heartbeat.test.ts          # Heartbeat unit tests
│           ├── terminal.ts                # TTY mode and alternate screen detection
│           └── terminal.test.ts           # TTY detection unit tests
│
├── packages/                              # Reusable internal domain & UI libraries
│   ├── core/                              # Pure business logic & domain rules
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts                   # Re-exports all core domain modules
│   │       ├── types.ts                   # Canonical TypeScript domain interfaces
│   │       ├── dashboard.ts               # Backwards-compatibility re-export bridge to dashboard/
│   │       ├── dashboard.test.ts          # Comprehensive dashboard model unit tests
│   │       ├── deepseek.ts                # DeepSeek balance payload parser & limits
│   │       ├── environment.ts             # Centralized agent environment and path resolver
│   │       ├── environment.test.ts        # Environment path resolution unit tests
│   │       ├── format.ts                  # Currency formatting, percentages, and reset times
│   │       ├── format.test.ts             # Formatting unit tests
│   │       ├── health.ts                  # Route health status transitions and predicates
│   │       ├── history.ts                 # Health history data structures
│   │       ├── settings.ts                # Balance alert thresholds and defaults
│   │       ├── usage.ts                   # Usage report row and column normalization
│   │       ├── usage-providers.ts         # Extensible UsageProviderRegistry adapter engine
│   │       ├── usage-providers.test.ts    # Usage provider registry unit tests
│   │       ├── warmup.ts                  # Warmup candidate filtering logic
│   │       ├── warmup.test.ts             # Warmup filtering unit tests
│   │       ├── dashboard/                 # Decomposed dashboard model builder
│   │       │   ├── index.ts               # Dashboard module export barrel
│   │       │   ├── types.ts               # Schema-2 dashboard interfaces, options, and thresholds
│   │       │   ├── mappers.ts             # Usage level, route, and low-balance mappers
│   │       │   ├── summary.ts             # Summary metrics calculation and text generation
│   │       │   ├── validator.ts           # Deep runtime schema-2 isDashboard validator
│   │       │   └── builder.ts             # Pure buildDashboard and assembleDashboard view-model builders
│   │       └── schedule/                  # Multi-provider peak/off-peak scheduling
│   │           ├── index.ts               # Schedule module export barrel
│   │           ├── types.ts               # TimeWindow, Policy, and Evaluation interfaces
│   │           ├── zoned-time.ts          # ZonedTime interface, timezone parsing, and duration formatting
│   │           ├── window.ts              # Pure evaluateWindow time-window evaluation
│   │           ├── timetable.ts           # Timetable generation, local interval formatting, and buildScheduleTable
│   │           ├── deepseek-policy.ts     # Authoritative DeepSeek UTC schedule definition
│   │           ├── registry.ts            # Extensible TimeWindowPolicy registry
│   │           ├── evaluator.ts           # ScheduleEvaluator domain class and compatibility re-exports
│   │           └── evaluator.test.ts      # Schedule boundary & timezone TDD unit tests
│   │
│   └── tui/                               # Terminal presentation & TerminUI components
│       ├── package.json
│       └── src/
│           ├── index.ts                   # TUI package entry point and terminui re-exports
│           ├── theme.ts                   # Tokens.json mapping to ANSI and terminui styles
│           ├── backend.ts                 # Double-buffered ANSI stdout backend for terminui
│           ├── provider-usage-view.ts     # Provider usage dashboard frame and string renderers
│           ├── schedule-view.ts           # 7-day pricing timetable frame and string renderers
│           └── index.test.ts              # In-memory terminui TestBackend unit tests
│
├── design/                                # Design token Single Source of Truth (SSOT)
│   └── tokens.json                        # DTCG format tokens: colors, spacing, radii, thresholds
│
├── docs/                                  # Project documentation & architectural records
│   ├── README.md                          # Documentation index
│   ├── architecture.md                    # System architecture, layers, and non-goals
│   ├── design.md                          # Visual standards, APCA contrast rules, and layout
│   ├── roadmap.md                         # Long-term feature roadmap
│   ├── runbook.md                         # Operational triage and troubleshooting runbook
│   ├── adr/                               # Architectural Decision Records (ADRs)
│   │   ├── README.md                      # ADR table of contents
│   │   ├── 0001-event-driven-health.md    # Event-driven route health probing
│   │   ├── 0002-opt-in-auto-restore.md    # Manual exclusion auto-restore policy
│   │   ├── 0003-public-release-scope.md   # Initial release boundary
│   │   ├── 0004-cross-platform-support.md # Windows, macOS, Linux support boundary
│   │   ├── 0005-cross-platform-desktop-widget.md # Electron tray widget architecture
│   │   ├── 0006-manual-account-warmup.md  # Account warmup and unhang checks
│   │   ├── 0007-multi-provider-time-window-scheduling.md # Time-of-day pricing policies
│   │   └── 0008-terminui-terminal-refactor.md # Double-buffered TUI refactoring
│   └── research/                          # Empirical research papers & benchmarks
│       ├── practical-implementation-blueprint.md
│       ├── gemini-family-prompt-and-wire.md
│       ├── prompt-engineering-agent-skills.md
│       ├── agent-harness-model-selection-prompting.md
│       ├── model-selection-planning-vs-execution.md
│       ├── model-intelligence-planning-vs-execution.md
│       └── omp-brain-score.md
│
└── scripts/                               # Monorepo build, verification, and tooling scripts
    ├── build.ts                           # Unified workspace bundler for extensions, CLI, and desktop
    ├── build-tray-icons.ts                # Rasterizes SVG tray icons for OS trays
    ├── check-tokens.ts                    # Audits APCA contrast (|Lc| >= 60) for design tokens
    ├── color.ts                           # OKLCH and APCA color calculation utilities
    ├── color.test.ts                      # Color math unit tests
    ├── create-desktop-shortcut.ts         # Unified cross-platform desktop shortcut generator (Windows, macOS, Linux)
    ├── create-desktop-shortcut.test.ts    # Desktop shortcut generator unit tests
    ├── create-desktop-shortcut.ps1        # Windows PowerShell shortcut generator
    ├── eval-model-roles.ts                # 2x2 empirical model role evaluation runner and CLI
    ├── eval-model-roles.test.ts           # Model evaluation harness unit tests
    ├── eval-metrics.ts                    # Evaluation metric calculators, pair configs, and scorecards
    ├── eval-tasks.ts                      # Benchmark task definitions and prompt templates
    ├── install.ts                         # Installs bundled extension into ~/.omp/agent/
    ├── monitor.ts                         # Unified monitor runner, CLI argument parser, and script path resolver
    ├── monitor.test.ts                    # Monitor launcher and argument parsing unit tests
    ├── orca-monitor.ts                    # Launches Orca Floating Workspace monitor tab
    ├── orca-monitor.test.ts               # Orca launcher unit tests
    ├── reliability-report.ts              # Generates 30-day reliability history markdown report
    └── widget.ts                          # Cross-platform desktop widget launcher helper
```

---

## 3. Key Directory Analysis

| Directory             | Layer        | Purpose                                               | Allowed Imports                                                | Forbidden Imports                                                    |
| :-------------------- | :----------- | :---------------------------------------------------- | :------------------------------------------------------------- | :------------------------------------------------------------------- |
| `packages/core`       | Domain       | Pure mathematical and structural business logic       | `@omp-toolkit/core` internals                                  | Filesystem, `child_process`, network, ANSI, `packages/tui`, `apps/*` |
| `packages/tui`        | Presentation | TerminUI frame buffer rendering and string formatting | `@omp-toolkit/core`, `terminui`, `design/tokens.json`          | `apps/*`, process lifecycle, direct terminal writing                 |
| `apps/provider-usage` | Adapter      | CLI executable and interactive watch loop             | `@omp-toolkit/core`, `@omp-toolkit/tui`, Node standard library | `apps/desktop`, `apps/omp-extension`                                 |
| `apps/omp-extension`  | Adapter      | OMP runtime hooks, circuit breaker, wire normalizer   | `@omp-toolkit/core`, `@omp-toolkit/tui`, Node standard library | `apps/desktop`, `apps/provider-usage`                                |
| `apps/desktop`        | Adapter      | Cross-platform Electron tray widget and web panel     | `@omp-toolkit/core`, `design/tokens.json`, Electron            | `packages/tui`, `apps/omp-extension`                                 |
| `design/`             | Design SSOT  | Design tokens defining colors, typography, thresholds | None (pure JSON)                                               | Any code                                                             |
| `docs/adr/`           | Governance   | Immutable historical Architectural Decision Records   | None (pure Markdown)                                           | Any code                                                             |
| `scripts/`            | Tooling      | Orchestration, bundling, token checks, evaluation     | Workspace packages, Node, Bun                                  | Production app runtimes                                              |

---

## 4. File Placement Patterns

To maintain codebase clean architecture, enforce these file placement rules:

1. **Domain Models & Calculations (`packages/core/src/`):**
   - New model entities, pricing schedules, or parsing rules MUST be created under `packages/core/src/`.
   - Must have an accompanying `<name>.test.ts` in the same directory.
   - Must be re-exported in `packages/core/src/index.ts`.

2. **Terminal Widgets & Presentation (`packages/tui/src/`):**
   - Any code that generates visual terminal layouts, frames, or styled strings belongs in `packages/tui/src/`.
   - Colors MUST reference `TERMINUI_STYLES` or `ANSI` in `packages/tui/src/theme.ts`.

3. **CLI Arguments & Input Handling (`apps/provider-usage/src/`):**
   - Command-line flags, process signal handlers (`SIGINT`), and interactive keypress listeners belong in `apps/provider-usage/src/index.ts` or `terminal.ts`.

4. **OMP Hooks & Normalizers (`apps/omp-extension/src/`):**
   - Any runtime interception of OMP events (`before_provider_request`, `tool_call`) belongs in `apps/omp-extension/src/`.

5. **Electron Main, Preload, and Webview (`apps/desktop/src/`):**
   - Main process OS integrations belong in `apps/desktop/src/*.ts`.
   - Renderer DOM components belong in `apps/desktop/src/renderer/*.ts`.
   - Cross-boundary communication MUST pass through `apps/desktop/src/preload.ts` via typed IPC channels defined in `ipc.ts`.

6. **Architectural Decisions (`docs/adr/`):**
   - Hard-to-reverse architectural choices MUST be documented in `docs/adr/NNNN-<slug>.md` and registered in `docs/adr/README.md`.

---

## 5. Naming and Organization Conventions

- **Files and Folders:** Strictly `kebab-case.ts` (e.g. `provider-usage-view.ts`, `deepseek-policy.ts`).
- **Test Files:** Co-located `<feature>.test.ts` right next to the file under test.
- **TypeScript Types & Interfaces:** PascalCase (e.g. `TimeWindowPolicy`, `DashboardProvider`).
- **Constants:** UPPER_SNAKE_CASE (e.g. `DEEPSEEK_POLICY`, `USAGE_THRESHOLDS`).
- **Functions:** camelCase with active imperative verbs (e.g. `evaluateWindow`, `renderProviderUsage`).
- **Commit Messages:** Conventional Commits (`type(scope): subject`, <=72 characters):
  - Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.
  - Valid scopes: `core`, `tui`, `provider-usage`, `omp-extension`, `desktop`, `scripts`, `docs`, `adr`.

### Subfolder Creation Threshold

To prevent premature directory proliferation, a subfolder may be introduced ONLY when all of the following conditions are met:
1. **Cohesive Subsystem:** A set of >= 3 closely coupled files forms an isolated domain module (e.g. types, policy, evaluator, and unit tests).
2. **Parent Density:** The parent directory contains >= 8 files.
3. **Dedicated Barrel:** The subfolder MUST export a clean public interface via an `index.ts` barrel file.

Grouping 1–2 arbitrary files into a standalone subdirectory is strictly forbidden. Both `packages/core/src/schedule/` and `packages/core/src/dashboard/` follow this rule while respecting the Colocated Shallow (Depth <= 2) ceiling.

### Scripts Prefix Grouping Convention

The `scripts/` directory remains strictly flat (Depth 1) to ensure single-hop discovery and keep `package.json` script paths clean and resilient. Scripts are organized via functional prefixes:
- `build.ts` / `build-tray-icons.ts`: Compilation and packaging pipelines.
- `check-*.ts`: Token validation and contrast audits.
- `eval-*.ts`: Model evaluation and benchmarking harnesses.
- `monitor.ts` / `orca-monitor.ts`: Live monitor launchers.

---

## 6. Navigation and Development Workflow

### Key Entry Points

- **CLI Monitor:** `apps/provider-usage/src/index.ts`
- **OMP Extension:** `apps/omp-extension/src/index.ts`
- **Desktop Main:** `apps/desktop/src/main.ts`
- **Desktop Renderer:** `apps/desktop/src/renderer/renderer.ts`
- **Domain API:** `packages/core/src/index.ts`
- **TUI API:** `packages/tui/src/index.ts`

### Essential Development Commands

| Command                       | Purpose                                                                                              |
| :---------------------------- | :--------------------------------------------------------------------------------------------------- |
| `bun run check`               | **Standard Check Gate:** Runs Biome check, TypeScript check, unit tests, and token validation.       |
| `bun test`                    | Executes all 219+ unit tests across the monorepo.                                                    |
| `bun run format`              | Auto-formats all codebase files with Biome.                                                          |
| `bun run build`               | Unified workspace bundler: compiles `omp-extension`, `provider-usage`, and `desktop` in one command. |
| `bun run build:desktop`       | Packages `apps/desktop` Electron bundles and assets only.                                            |
| `bun run install:omp`         | Builds non-desktop targets and installs the extension into `~/.omp/agent/`.                          |
| `bun run monitor`             | Runs the terminal provider usage monitor in development.                                             |
| `bun scripts/check-tokens.ts` | Validates APCA contrast compliance for all design tokens.                                            |

---

## 7. Build and Output Organization

The unified build pipeline compiles TypeScript packages into optimized, standalone bundles:

```text
scripts/build.ts
  ├── apps/provider-usage/src/index.ts  ──►  apps/provider-usage/dist/index.js (CLI bundle)
  ├── apps/omp-extension/src/index.ts   ──►  apps/omp-extension/dist/index.js  (OMP plugin bundle)
  └── apps/desktop/                     ──►  apps/desktop/dist/ (Electron executable package)
```

- **Unified Orchestrator:** `scripts/build.ts` serves as the single build entry point for all workspace packages. Supports `--desktop` for desktop-only builds and `--no-desktop` / `--targets` for extension and CLI only.
- **Output Directories (`dist/`):** All generated bundles are compiled into `apps/*/dist/` and ignored by `.gitignore`.
- **Packaging:** Bun's built-in bundler (`Bun.build`) is used for single-file CLI/extension outputs with externalized Node built-ins.

---

## 8. Technology-Specific Organization

- **Bun Monorepo Workspaces:** Root `package.json` specifies `"workspaces": ["apps/*", "packages/*"]`. Internal packages reference each other via `"workspace:*"`.
- **Biome Configuration (`biome.json`):** Single root configuration enforcing 2-space indentation, 100-character line width, double quotes, and sorted imports/exports across all packages.
- **Electron Process Isolation:** `apps/desktop` adheres to Electron security best practices: `contextIsolation: true`, `nodeIntegration: false`, communication solely through `contextBridge` in `preload.ts`.

---

## 9. Extension and Evolution Patterns

### How to Add a New Model Provider

1. Define provider types in `packages/core/src/types.ts`.
2. Add balance parsing logic in `packages/core/src/<provider>.ts` with unit tests.
3. If the provider uses time-of-day pricing, define its `TimeWindowPolicy` in `packages/core/src/schedule/<provider>-policy.ts` and register it in `packages/core/src/schedule/registry.ts`.
4. Add SVG logo asset to `apps/desktop/src/renderer/assets/providers/<provider>.svg` and register in `apps/desktop/src/renderer/provider-logos.ts`.
5. Update `packages/core/src/dashboard.ts` to include the provider section.

### How to Add a New TUI Component

1. Define the component drawer in `packages/tui/src/<feature>-view.ts` accepting a `terminui` `Frame` and `Rect`.
2. Bind all styling to `TERMINUI_STYLES` in `packages/tui/src/theme.ts`.
3. Provide a static string wrapper using `createTestBackend` for non-TTY/test execution.
4. Export the drawer and string renderer in `packages/tui/src/index.ts`.
5. Write unit tests in `packages/tui/src/index.test.ts`.

---

## 10. Structure Templates

### New Domain Module (`packages/core/src/<module>.ts`)

```typescript
/**
 * Module description.
 */

export interface ExampleConfig {
  readonly id: string;
  readonly enabled: boolean;
}

export function computeExample(value: number, config: ExampleConfig): number {
  if (!config.enabled) return value;
  return value * 2;
}
```

### New TUI Component (`packages/tui/src/<feature>-view.ts`)

```typescript
import {
  type Frame,
  type Rect,
  blockBordered,
  createParagraph,
  createTitle,
  frameRenderWidget,
  renderParagraph,
} from "terminui";
import { TERMINUI_STYLES } from "./theme";

export function drawExampleView(frame: Frame, area: Rect, titleText: string): void {
  const p = createParagraph("Content goes here", {
    block: blockBordered({
      titles: [createTitle(titleText)],
      borderStyle: TERMINUI_STYLES.border,
    }),
    style: TERMINUI_STYLES.accent,
  });
  frameRenderWidget(frame, renderParagraph(p), area);
}
```

### New Architectural Decision Record (`docs/adr/NNNN-<slug>.md`)

```markdown
# ADR-NNNN: Short title in imperative mood

- Status: Proposed | Accepted | Deprecated | Superseded
- Date: YYYY-MM-DD

## Context

Describe the architectural context, problem statement, and forces at play.

## Decision

State the decision clearly and authoritatively.

## Consequences

Detail positive and negative trade-offs resulting from this decision.
```

---

## 11. Structure Enforcement

Codebase organization is continuously enforced via automated gates:

1. **Biome Check:** `biome check .` validates code formatting, import order, and lint rules across all 100+ project files.
2. **TypeScript Compilation:** Root `tsc --noEmit` and `tsc -p apps/desktop/tsconfig.json --noEmit` enforce zero type regressions and strict module imports.
3. **Contrast Gate:** `bun scripts/check-tokens.ts` enforces WCAG/APCA contrast (|Lc| >= 60) for all text and threshold tokens.
4. **Continuous Integration (`.github/workflows/check.yml`):** Automatically executes `bun run check` on every pull request across `windows-latest`, `ubuntu-latest`, and `macos-latest`.
