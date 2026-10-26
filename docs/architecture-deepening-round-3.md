# Architecture Review & Deepening (Round 3)

_Date: 2026-10-26_  
_Focus: AntigravityHealthManager domain depth, strict presentation seams, and desktop renderer lifecycle encapsulation._  
_Vocabulary: Based on `skill://codebase-design` (module, interface, depth, seam, adapter, leverage, locality)._

---

## 1. Candidate Overview

| #     | Candidate                                                            | Recommendation | Dependency Category   | Core Seam Impact                                                                                                                                                                                        |
| :---- | :------------------------------------------------------------------- | :------------- | :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** | **Deepen `AntigravityHealthManager` & Absorb Circuit Breaker Logic** | `Strong`       | `ports & adapters`    | Eliminates the shallow facade in `health-manager.ts` and collapses 20+ procedural free functions in `circuit-breaker.ts` into true instance methods utilizing injected stores.                          |
| **2** | **Enforce Strict `Dashboard` Seam & Prune Presentation Fallbacks**   | `Strong`       | `in-process`          | Eliminates intermediate `ProviderSection[]` leakage into presentation layers (`packages/tui`, `apps/provider-usage`), removing duplicate compiler fallback branches and inlining shallow `terminal.ts`. |
| **3** | **Encapsulate Component Lifecycles in Desktop Renderer**             | `Strong`       | `local-substitutable` | Introduces `SettingsViewController` with managed cleanup to eliminate zombie `window` `keydown` listeners and uncommitted theme preview leaks, and prunes synthetic re-exports in `card.ts`.            |

---

## 2. Detailed Specifications

### Candidate 1: Deepen `AntigravityHealthManager` & Absorb Circuit Breaker Logic

- **Files**:
  - `apps/omp-extension/src/health-manager.ts`
  - `apps/omp-extension/src/circuit-breaker.ts`
  - `apps/omp-extension/src/auto-heal.ts`
  - `apps/omp-extension/src/commands.ts`
  - `apps/omp-extension/src/cli.ts`
- **Problem**:
  `health-manager.ts` acts as an empty facade whose methods delegate backward to free functions in `circuit-breaker.ts` (392 lines). Those free functions bypass the manager's injected stores and mutate module-level singletons (`policyStore`, `probeClient`, `tokenCache`).
- **Solution**:
  Absorb the healing, restoration, streak tracking, and snapshot persistence algorithms directly into `AntigravityHealthManager` instance methods, utilizing `this.policyStore`, `this.probeClient`, and `this.historyStore`. Reduce `circuit-breaker.ts` to constants and backward-compatible shims.
- **Wins**:
  - _Real dependency injection at health seam_
  - _Eliminate 20+ sprawling free functions_
  - _Locality: healing, streaks, and exclusions cohere_
  - _In-memory test surface without filesystem I/O_
  - _Leverage: atomic multi-step remediation in 1 method_

---

### Candidate 2: Enforce Strict `Dashboard` Seam & Prune Presentation Fallbacks

- **Files**:
  - `packages/tui/src/provider-usage-view.ts`
  - `apps/provider-usage/src/json.ts`
  - `apps/provider-usage/src/terminal.ts`
  - `apps/provider-usage/src/config.ts`
- **Problem**:
  Presentation packages accept the loose union `Dashboard | ProviderSection[]`, embedding duplicate fallback calls to `buildDashboard()` with hardcoded TUI threshold constants. Meanwhile, `terminal.ts` is an ultra-shallow 19-line file with a single boolean predicate.
- **Solution**:
  Enforce `Dashboard` strictly at the presentation seam in `renderProviderUsage(dashboard: Dashboard)` and `jsonPayload(dashboard: Dashboard)`. Inline `useAlternateScreen` into `config.ts` and delete `terminal.ts`.
- **Wins**:
  - _Strict view model seam in presentation_
  - _Delete duplicate compiler fallback branches_
  - _Delete shallow terminal.ts module_
  - _ProviderSection encapsulated inside core compiler_
  - _Clean, minimal interface for callers_

---

### Candidate 3: Encapsulate Component Lifecycles in Desktop Renderer

- **Files**:
  - `apps/desktop/src/renderer/settings-view.ts`
  - `apps/desktop/src/renderer/renderer.ts`
  - `apps/desktop/src/renderer/card.ts`
  - `apps/desktop/src/renderer/card.test.ts`
- **Problem**:
  Closing settings via the header gear icon in `renderer.ts` unmounts the DOM element but leaves the global `Escape` `keydown` listener bound to `window`. Furthermore, uncommitted live theme previews stick on `documentElement`. Additionally, `card.ts` re-exports `icon` and `renderLimitCell` solely for test convenience.
- **Solution**:
  Return a `SettingsViewController` from `renderSettingsView` with a `destroy()` method that cleans up global window listeners and reverts uncommitted theme previews. Prune synthetic re-exports in `card.ts`.
- **Wins**:
  - _Zero zombie window event listeners_
  - _Uncommitted theme previews revert reliably_
  - _Delete synthetic test re-exports in card.ts_
  - _Locality: view cleanup managed in one place_
  - _Clean lifecycle contracts across renderer views_
