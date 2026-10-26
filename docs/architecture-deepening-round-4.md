# Architecture Review & Deepening (Round 4)

_Date: 2026-10-26_  
_Focus: Desktop action consolidation, unified monitor execution runner, and currency formatting coherence._  
_Vocabulary: Based on `skill://codebase-design` (module, interface, depth, seam, adapter, leverage, locality)._

---

## 1. Candidate Overview

| #     | Candidate                                                                 | Recommendation | Dependency Category   | Core Seam Impact                                                                                                                                                                                   |
| :---- | :------------------------------------------------------------------------ | :------------- | :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Absorb External Launchers into `DesktopRuntime` & Delete `actions.ts`** | `Strong`       | `local-substitutable` | Absorbs `launchTerminalMonitor` and `launchOrcaTab` directly into `DesktopRuntime` methods, deleting the shallow `apps/desktop/src/actions.ts` file and utilizing runtime's existing `dialogHost`. |
| **2** | **Deepen Monitor Execution into a Unified `MonitorRunner`**               | `Strong`       | `in-process`          | Unifies split-brain polling and data acquisition between interactive TUI mode and batch/JSON/headless mode into a single deep `MonitorRunner` in `apps/provider-usage`.                            |
| **3** | **Harden Core Domain Currency Formatting & DeepSeek Coherence**           | `Strong`       | `in-process`          | Makes `money(value, unit)` in `packages/core/src/format.ts` case-insensitive and unifies `deepseek.ts` balance notes through canonical `money()`.                                                  |

---

## 2. Detailed Specifications

### Candidate 1: Absorb External Launchers into `DesktopRuntime` & Delete `actions.ts`

- **Files**:
  - `apps/desktop/src/actions.ts` (delete)
  - `apps/desktop/src/runtime.ts`
  - `apps/desktop/src/main.ts`
- **Problem**:
  `actions.ts` is a 64-line shallow pass-through module that duplicates Bun and script path resolution, and directly couples to Electron's static `dialog` rather than `DesktopRuntime`'s configurable `dialogHost`.
- **Solution**:
  Absorb `launchTerminal(panelWindow?: BrowserWindow | null): Promise<void>` and `launchOrca(): void` directly into `DesktopRuntime` methods, utilize the runtime's existing `checkoutRoot`, `intervalSeconds`, `env`, and `dialogHost`, and delete `actions.ts`.
- **Wins**:
  - _Delete shallow actions.ts module_
  - _Depth: DesktopRuntime encapsulates process launching_
  - _Locality: uses runtime's existing dialogHost_
  - _Headless test surface covers launcher errors_
  - _main.ts shrinks by another 15 lines_

---

### Candidate 2: Deepen Monitor Execution into a Unified `MonitorRunner`

- **Files**:
  - `apps/provider-usage/src/interactive-monitor.ts`
  - `apps/provider-usage/src/index.ts`
  - `apps/provider-usage/src/monitor-runner.ts` (new)
- **Problem**:
  `apps/provider-usage` suffers from a split-brain architecture where `InteractiveMonitor` owns the lifecycle for TUI mode, while `index.ts` reimplements the exact same polling, data fetch, heartbeat, and snapshot reads for batch and JSON modes.
- **Solution**:
  Unify data acquisition, heartbeat writes, and execution modes (`interactive`, `batch`, `json`, `schedule`) into a deep `MonitorRunner`, shrinking `index.ts` to a thin 15-line entrypoint.
- **Wins**:
  - _Depth: 1 runner manages all execution modes_
  - _Locality: heartbeat and polling loop unify_
  - _Eliminates split-brain execution logic_
  - _Batch and JSON modes become unit-testable_
  - _index.ts reduces to a 15-line entrypoint_

---

### Candidate 3: Harden Core Domain Currency Formatting & DeepSeek Coherence

- **Files**:
  - `packages/core/src/format.ts`
  - `packages/core/src/deepseek.ts`
  - `packages/core/src/format.test.ts`
- **Problem**:
  `money(value, unit)` in `packages/core/src/format.ts` strictly checks `unit === "cny"` and `unit === "usd"`. Passing uppercase `"CNY"` or `"USD"` (the standard `DeepSeekCurrency` enum in `deepseek.ts`) silently drops currency symbols (`"100.00"` instead of `"¥100.00"`). `deepseek.ts` bypasses `money()` by building raw template strings.
- **Solution**:
  Make `money(value, unit)` case-insensitive (`unit.toLowerCase()`), support both uppercase and lowercase currency codes robustly, and unify `deepseek.ts` balance notes through `money()`.
- **Wins**:
  - _Locality: currency formatting concentrates in format.ts_
  - _Case-insensitive currency normalization_
  - _DeepSeek balance notes use canonical money()_
  - _Zero silent currency symbol formatting drops_
  - _Strengthens domain type-safety_
