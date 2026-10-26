# Architecture Review & Deepening (Round 2)

_Date: 2026-10-26_  
_Focus: Deepening opportunities across `apps/desktop`, `apps/omp-extension`, and `packages/core`._  
_Vocabulary: Based on `skill://codebase-design` (module, interface, depth, seam, adapter, leverage, locality)._

---

## 1. Candidate Overview

| #     | Candidate                                                              | Recommendation | Dependency Category   | Core Seam Impact                                                                                                                                                                                          |
| :---- | :--------------------------------------------------------------------- | :------------- | :-------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Absorb WarmUp Execution into `DesktopRuntime`**                      | `Strong`       | `local-substitutable` | Eliminates a 9-callback trampoline context bag in `apps/desktop/src/warmup-handler.ts`, consolidating state transitions (`warmupRunning`, `warmupMessage`, `refresh()`) directly inside `DesktopRuntime`. |
| **2** | **Invert Extension Health Seam: Canonical `AntigravityHealthManager`** | `Strong`       | `ports & adapters`    | Eliminates legacy backward delegation and 10+ free functions in `circuit-breaker.ts`, making `AntigravityHealthManager` the primary coordinator for all extension commands and CLI hooks.                 |
| **3** | **Deepen Schedule Domain into an Evaluative `ScheduleRegistry`**       | `Strong`       | `in-process`          | Consolidates an anemic 19-line global `Map` (`schedule/registry.ts`) and standalone `evaluator.ts` into a cohesive `ScheduleRegistry` offering one-step policy resolution and window evaluation.          |

---

## 2. Detailed Candidate Specifications

### Candidate 1: Absorb WarmUp Execution into `DesktopRuntime`

- **Files**:
  - `apps/desktop/src/warmup-handler.ts`
  - `apps/desktop/src/runtime.ts`
  - `apps/desktop/src/main.ts`
- **Problem**:
  `main.ts` currently unpacks 5 runtime properties and forwards 4 callback handlers into a loose `WarmUpHandlerContext` object with 9 properties: `panelWindow`, `lastDashboard`, `checkoutRoot`, `isWarmUpRunning`, `isQuitting`, `onWarmUpStart`, `onWarmUpEnd`, `onRefreshRequested`, and `env`. `warmup-handler.ts` bounces logic back to the runtime through these callbacks.
- **Solution**:
  Absorb warm-up execution directly into `DesktopRuntime` as an async method: `runtime.handleWarmUp(request: WarmUpRequest, panelWindow?: BrowserWindow | null): Promise<void>`.
- **Wins**:
  - _Delete 9-callback trampoline seam_
  - _Depth: runtime owns complete warmup lifecycle_
  - _Locality: state transitions cohere in runtime_
  - _main.ts glue shrinks by 18 lines_
  - _Headless test surface covers warmup execution_

---

### Candidate 2: Invert Extension Health Seam: Make `AntigravityHealthManager` Canonical

- **Files**:
  - `apps/omp-extension/src/health-manager.ts`
  - `apps/omp-extension/src/circuit-breaker.ts`
  - `apps/omp-extension/src/commands.ts`
  - `apps/omp-extension/src/cli.ts`
  - `apps/omp-extension/src/auto-heal.ts`
- **Problem**:
  `AntigravityHealthManager` currently delegates backward to free functions in `circuit-breaker.ts`, and production callers in `commands.ts` (450 lines) and `cli.ts` (110 lines) bypass the manager entirely to import 10+ free functions.
- **Solution**:
  Migrate callers in `commands.ts`, `cli.ts`, and `auto-heal.ts` to consume the canonical `healthManager` instance (`AntigravityHealthManager`), deprecating redundant free function proxies.
- **Wins**:
  - _Inverts backward delegation into forward architecture_
  - _commands.ts imports 1 manager interface_
  - _cli.ts imports 1 manager interface_
  - _Locality: healing and streaks cohere cleanly_
  - _Swappable manager adapter in extension tests_

---

### Candidate 3: Deepen Schedule Domain into an Evaluative `ScheduleRegistry`

- **Files**:
  - `packages/core/src/schedule/registry.ts`
  - `packages/core/src/schedule/evaluator.ts`
  - `packages/core/src/dashboard/builder.ts`
  - `apps/provider-usage/src/interactive-monitor.ts`
- **Problem**:
  `schedule/registry.ts` is an anemic 19-line global map. Callers must execute a multi-step dance of querying policies, checking for undefined, and invoking standalone evaluator functions (`const policy = getTimeWindowPolicy(id); const window = policy ? evaluateWindow(policy, now, tz) : null;`).
- **Solution**:
  Deepen `ScheduleRegistry` to encapsulate policy storage, evaluation, transition countdowns, and schedule table generation in one step (`scheduleRegistry.evaluate(provider, now, tz)`).
- **Wins**:
  - _Depth: 1 method evaluates policy and window_
  - _Eliminates caller lookup-and-null-check dance_
  - _Locality: policies and evaluation cohere_
  - _Consolidates registry.ts and evaluator.ts_
  - _Leverage: clean singleton for dashboard and TUI_
