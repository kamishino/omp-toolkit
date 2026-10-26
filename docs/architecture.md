# Architecture

## Layers

| Layer                   | Package               | Responsibility                                                                                  |
| ----------------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| Domain                  | `packages/core`       | Pure usage grouping, column selection, route ordering, streak transitions, dashboard model      |
| Presentation (terminal) | `packages/tui`        | ANSI design tokens, semantic thresholds, bars, percentages, provider usage frame                |
| Presentation (desktop)  | `apps/desktop`        | Electron host, tray/menu, OS login item, terminal/Orca launch; renderer consumes dashboard JSON |
| Adapters                | `apps/omp-extension`  | OMP hooks, commands, tool, account probing, state/config persistence                            |
| Adapter                 | `apps/provider-usage` | CLI flags, `omp usage` read, snapshot read, watch loop, schema-2 JSON payload                   |
| Design                  | `design/tokens.json`  | Color and threshold SSOT for TUI ANSI and desktop OKLCH                                         |

`core` has no filesystem, process, network, or OMP imports. `tui` imports only
`core` and JSON tokens. The apps own I/O and runtime boundaries.

```mermaid
flowchart TD
    subgraph Design["🎨 Design SSOT"]
        Tokens["design/tokens.json<br/><code>Colors, OKLCH, ANSI & Thresholds</code>"]
    end

    subgraph Domain["🧠 Domain Layer (Pure Logic)"]
        Core["packages/core<br/><code>Usage grouping, dashboard model, streak evaluator</code>"]
    end

    subgraph Presentation["🖥️ Presentation Layer"]
        TUI["packages/tui<br/><code>Terminal ANSI frames, widgets, bars</code>"]
        Desktop["apps/desktop<br/><code>Electron host, tray/menu, webview panel</code>"]
    end

    subgraph Adapters["🔌 Adapters & Runtimes (I/O Boundaries)"]
        Extension["apps/omp-extension<br/><code>OMP hooks, health probing, circuit breaker</code>"]
        UsageCLI["apps/provider-usage<br/><code>CLI flags, watch loop, schema-2 JSON</code>"]
    end

    Tokens -->|"color & threshold tokens"| TUI
    Tokens -->|"color & threshold tokens"| Desktop
    Core -->|"domain models & algorithms"| TUI
    Core -->|"domain models & algorithms"| Extension
    Core -->|"domain models & algorithms"| UsageCLI
    UsageCLI -->|"versioned dashboard JSON"| Desktop
    TUI -->|"rendered ANSI frames"| UsageCLI

    classDef designBox fill:#FFF3BF,stroke:#E67700,stroke-width:2px,color:#000
    classDef domainBox fill:#D3F9D8,stroke:#2B8A3E,stroke-width:2px,color:#000
    classDef presBox fill:#D0EBFF,stroke:#1864AB,stroke-width:2px,color:#000
    classDef adapterBox fill:#FFE3E3,stroke:#C92A2A,stroke-width:2px,color:#000

    class Tokens designBox
    class Core domainBox
    class TUI,Desktop presBox
    class Extension,UsageCLI adapterBox
```

## Why the extension is one bundled app

OMP discovers extension modules from `~/.omp/agent/extensions/*.ts|js`. A
single-file bundle is the stable deployment unit. The source still follows the
same layering: the extension app imports shared domain logic and contains only
the OMP adapter, persistence, and probe transport.

`scripts/build/build.ts` bundles both apps with Bun:

```mermaid
flowchart LR
    subgraph Sources["📁 Source Packages"]
        ExtSrc["apps/omp-extension/src/index.ts"]
        UsageSrc["apps/provider-usage/src/index.ts"]
    end

    subgraph BuildStep["⚙️ Bun Bundler (scripts/build/build.ts)"]
        BunBuild["Bun.build(target: bun, format: esm)"]
    end

    subgraph Dist["📦 Dist Artifacts"]
        ExtDist["apps/omp-extension/dist/index.js"]
        UsageDist["apps/provider-usage/dist/index.js"]
    end

    subgraph InstallStep["🚀 Installer (scripts/install/install.ts)"]
        Installer["install:omp<br/><code>atomic copy + backup</code>"]
    end

    subgraph Target["🌐 OMP State Directory (~/.omp/agent)"]
        ExtInstalled["extensions/gemini-health.js<br/><code>OMP plugin discovery</code>"]
        UsageInstalled["scripts/omp-provider-usage.js<br/><code>CLI monitor & widget host</code>"]
    end

    ExtSrc --> BunBuild
    UsageSrc --> BunBuild
    BunBuild --> ExtDist
    BunBuild --> UsageDist
    ExtDist --> Installer
    UsageDist --> Installer
    Installer --> ExtInstalled
    Installer --> UsageInstalled

    classDef srcBox fill:#E7F5FF,stroke:#1971C2,stroke-width:2px,color:#000
    classDef buildBox fill:#FFF9DB,stroke:#F59F00,stroke-width:2px,color:#000
    classDef distBox fill:#E6FCF5,stroke:#0CA678,stroke-width:2px,color:#000
    classDef installBox fill:#F3F0FF,stroke:#7950F2,stroke-width:2px,color:#000
    classDef targetBox fill:#FFE8CC,stroke:#D9480F,stroke-width:2px,color:#000

    class ExtSrc,UsageSrc srcBox
    class BunBuild buildBox
    class ExtDist,UsageDist distBox
    class Installer installBox
    class ExtInstalled,UsageInstalled targetBox
```

`install:omp` renames them to `gemini-health.js` and
`omp-provider-usage.js` in the OMP state directory.

## Usage data flow

```mermaid
flowchart TD
    subgraph Sources["📥 Raw Inputs & Providers"]
        OMP["⚙️ OMP CLI<br/><code>omp usage --json</code>"]
        DeepSeek["🌐 DeepSeek API<br/><code>api.deepseek.com/user/balance</code>"]
        HealthCache[("💾 gemini-health-latest.json<br/><code>Cached route status</code>")]
    end

    subgraph Ingestion["🔌 apps/provider-usage (I/O)"]
        Fetch["fetchUsage()<br/><code>Polls OMP & DeepSeek providers</code>"]
        ReadSnap["readSnapshot()<br/><code>Zero-token passive health read</code>"]
    end

    subgraph Domain["🧠 packages/core (Pure Transformations)"]
        Sections["sectionsFor()<br/><code>• Keep Gemini limits for Antigravity<br/>• Sort severity: HANG/ERR first<br/>• Sort descending usage %</code>"]
        Dashboard["buildDashboard()<br/><code>Constructs schema-2 dashboard model</code>"]
    end

    subgraph Presentation["🖥️ Outputs & Sinks"]
        TUI["packages/tui: renderProviderUsage()<br/><code>ANSI bars, status indicators & frames</code>"]
        JSONOut["apps/provider-usage --json<br/><code>Versioned dashboard JSON payload</code>"]
        DesktopApp["apps/desktop<br/><code>Electron tray icon & webview panel</code>"]
    end

    OMP --> Fetch
    DeepSeek -.->|"registered provider"| OMP
    HealthCache --> ReadSnap
    Fetch --> Sections
    ReadSnap --> Sections
    Sections --> Dashboard
    Dashboard --> TUI
    Dashboard --> JSONOut
    JSONOut -->|"IPC / Subprocess read"| DesktopApp

    classDef sourceBox fill:#EBFBEE,stroke:#2F9E44,stroke-width:2px,color:#000
    classDef ioBox fill:#E7F5FF,stroke:#1971C2,stroke-width:2px,color:#000
    classDef domainBox fill:#FFF3BF,stroke:#E67700,stroke-width:2px,color:#000
    classDef sinkBox fill:#F3F0FF,stroke:#7950F2,stroke-width:2px,color:#000

    class OMP,DeepSeek,HealthCache sourceBox
    class Fetch,ReadSnap ioBox
    class Sections,Dashboard domainBox
    class TUI,JSONOut,DesktopApp sinkBox
```

For Google Antigravity, `columnsFor` keeps only `Gemini` limits. Shared
Claude/GPT 3P limits are intentionally excluded from this focused view. Rows
are sorted by route severity first (`HANG`/`ERR`), then by highest selected
usage.

The OMP extension also registers a `deepseek` usage provider via
`pi.registerProvider("deepseek", { usage })`. `omp usage --json` polls
`https://api.deepseek.com/user/balance` using `DEEPSEEK_API_KEY` and returns a
`deepseek` report. The provider-usage CLI renders this report as currency
columns (`BALANCE`, `GRANTED`), preferring `CNY` over `USD`.
## Health data flow

```mermaid
sequenceDiagram
    autonumber
    participant Hook as ⚡ OMP Hook / User
    participant Ext as 🛡️ omp-extension
    participant Prober as 📡 Probe Client
    participant Core as 🧠 packages/core
    participant State as 💾 State Files
    participant Config as ⚙️ auth.accountPolicies

    Note over Hook,Ext: Trigger: auto_retry_start / agent_end / /gemini-heal
    Hook->>Ext: Trigger health check (confirm=true)
    activate Ext

    Ext->>Prober: checkAll(confirm=true)
    activate Prober
    Prober-->>Ext: ProbeResult[] (ok / hang / auth / err)
    deactivate Prober

    Ext->>Core: nextStreaks(previousStreaks, probeResults)
    activate Core
    Core-->>Ext: updated streaks
    deactivate Core

    Ext->>State: recordHealth(): atomic write streaks & latest snapshot

    Ext->>Core: restorableEmails(managedExcluded, streaks, config)
    activate Core
    Core-->>Ext: eligibleEmails[] (spaced healthy streak met)
    deactivate Core

    opt Eligible accounts exist
        Ext->>Config: maybeRestoreManaged(): clear reservePct: 100
    end

    Ext->>Ext: applyHeal(probeResults)
    alt Minority accounts failed (active circuit breaker)
        Ext->>Config: Add reservePct: 100 to failing accounts
        Ext->>State: Atomic write managed exclusions (state.json)
    else All accounts failed (provider outage)
        Ext->>Ext: Preserve policies (no-op guardrail)
    end

    Ext-->>Hook: publish(ctx, results, policies)
    deactivate Ext
```

The provider usage CLI only reads `gemini-health-latest.json`. It never probes
a model, so an idle monitoring tab spends zero model tokens. See
[roadmap.md](roadmap.md) for the 90-day reliability scaling plan,
[GLOSSARY.md](../GLOSSARY.md) for system terminology, and
[ADR-0002](adr/0002-opt-in-auto-restore.md) for opt-in recovery policy.

## State files

| File                         | Owner          | Purpose                                       |
| ---------------------------- | -------------- | --------------------------------------------- |
| `auth.accountPolicies`       | OMP config     | Active account exclusions (`reservePct: 100`) |
| `gemini-health-state.json`   | Extension      | Managed exclusions created by heal/auto-heal  |
| `gemini-health-streaks.json` | Extension      | Spaced healthy-check streaks                  |
| `gemini-health-latest.json`  | Extension      | Cached route snapshot for read-only UIs       |
| `gemini-health-widget.json`  | Extension      | TUI widget visibility                         |
| `desktop-widget-error.log`   | Desktop widget | Append-only fatal and refresh diagnostics     |

All non-config files use atomic writes. Mutating paths use strict reads so a
corrupt state file is surfaced rather than silently replaced. Streak corruption
is backed up to `.corrupt-<timestamp>` and rebuilt.

```mermaid
flowchart TD
    subgraph Components["🧩 Toolkit Components"]
        Ext["🛡️ apps/omp-extension<br/><code>Prober, circuit breaker & auto-heal</code>"]
        CLI["📊 apps/provider-usage<br/><code>CLI monitor & schema-2 producer</code>"]
        Desktop["🖥️ apps/desktop<br/><code>System tray & webview widget</code>"]
        OMP["⚙️ OMP Core / Agent<br/><code>Model routing & quota policy</code>"]
    end

    subgraph StateFiles["💾 State & Configuration Files"]
        Policies[("auth.accountPolicies<br/><code>Active exclusions (reservePct: 100)</code>")]
        ManagedState[("gemini-health-state.json<br/><code>Managed exclusions by heal/auto-heal</code>")]
        Streaks[("gemini-health-streaks.json<br/><code>Spaced healthy-check streaks</code>")]
        Snapshot[("gemini-health-latest.json<br/><code>Cached route status snapshot</code>")]
        WidgetState[("gemini-health-widget.json<br/><code>TUI widget visibility state</code>")]
        DesktopLog[("desktop-widget-error.log<br/><code>Append-only crash & refresh diagnostics</code>")]
    end

    Ext <-->|"read / write managed exclusions"| ManagedState
    Ext <-->|"read / write streak intervals"| Streaks
    Ext -->|"atomic write snapshot"| Snapshot
    Ext <-->|"read / write widget visibility"| WidgetState
    Ext <-->|"read / write policies"| Policies
    OMP <-->|"enforces account routing"| Policies

    Snapshot -->|"read-only (zero model tokens!)"| CLI
    CLI -->|"spawns JSON subprocess"| Desktop
    Desktop -->|"appends fatal errors"| DesktopLog

    classDef compBox fill:#E7F5FF,stroke:#1971C2,stroke-width:2px,color:#000
    classDef fileBox fill:#FFF3BF,stroke:#E67700,stroke-width:2px,color:#000
    classDef readOnlyBox fill:#D3F9D8,stroke:#2B8A3E,stroke-width:2px,color:#000

    class Ext,CLI,Desktop,OMP compBox
    class Policies,ManagedState,Streaks,WidgetState,DesktopLog fileBox
    class Snapshot readOnlyBox
```

## Guardrails

- Heal applies only when a minority of accounts fail; all-failing is treated as
  provider-wide and changes nothing.
- Managed exclusions restore only after `restoreStreak` healthy checks, spaced
  by `restoreGapSeconds`.
- Manual exclusions are never auto-removed.
- `/gemini-enable` refuses when the latest snapshot is not `OK`, requires
  `--force` to override, and refuses ambiguous local-part matches.
- `publish` isolates UI failures from the check/heal path.
- Probe `401/403` invalidates the token cache.
- The usage monitor watch loop survives `omp usage` failures and keeps the last
  frame until the next successful read.
- The desktop widget never probes a model; it spawns the installed monitor CLI and renders its versioned JSON.
- The desktop renderer is local-only, sandboxed, with context isolation and CSP blocking all network access.

## Non-goals

- No automatic model fallback; the account circuit breaker preserves
  `gemini-3.8-flash`.
- No periodic health probing; the snapshot is refreshed by events/manual checks.
- No custom Orca status-bar item; Orca's public plugin API exposes right-sidebar
  panels and commands, not status-bar contributions.
- No packaged desktop binaries or auto-updater; the desktop widget runs from source via Bun.
- No Windows 11 Widgets-board provider; the widget uses the notification area / menu bar.
