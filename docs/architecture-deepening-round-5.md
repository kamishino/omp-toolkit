# Architecture Review & Deepening (Round 5)

_Date: 2026-10-26_  
_Focus: Desktop theme lifecycle encapsulation, extension state persistence consolidation, and domain boundary hygiene._  
_Vocabulary: Based on `skill://codebase-design` (module, interface, depth, seam, adapter, leverage, locality)._

---

## 1. Candidate Overview

| #     | Candidate                                                                      | Recommendation | Dependency Category   | Core Seam Impact                                                                                                                                                                                                             |
| :---- | :----------------------------------------------------------------------------- | :------------- | :-------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Encapsulate Theme Lifecycle into a Deep `ThemeManager` in Desktop Renderer** | `Strong`       | `local-substitutable` | Encapsulates OS media query observation, active theme preference, CSS variable styling, and lifecycle cleanup into a deep `ThemeManager` in `tokens.ts`.                                                                     |
| **2** | **Consolidate State Persistence into `AntigravityHealthManager`**              | `Strong`       | `ports & adapters`    | Consolidates all state, streak, and snapshot file I/O inside `AntigravityHealthManager`, eliminating circular module imports and 60 lines of duplicate filesystem code in `circuit-breaker.ts`.                              |
| **3** | **Clean Core Export Seam & Restore Domain Purity in Formatting**               | `Strong`       | `in-process`          | Scopes internal intermediate transformation functions in `usage.ts` private to core, exports clean domain models, and relocates fixed-width terminal column padding (`padPercent`, `padResetCompact`) to `@omp-toolkit/tui`. |

---

## 2. Detailed Specifications

### Candidate 1: Encapsulate Theme Lifecycle into a Deep `ThemeManager` in Desktop Renderer

- **Files**:
  - `apps/desktop/src/renderer/tokens.ts`
  - `apps/desktop/src/renderer/renderer.ts`
  - `apps/desktop/src/renderer/settings-view.ts`
- **Problem**:
  Theme resolution is fragmented: `renderer.ts` sets up an unmanaged `matchMedia` listener at module root while `tokens.ts` re-queries `matchMedia` independently inside `applyThemePreference`.
- **Solution**:
  Encapsulate OS media query observation, active preference tracking, and DOM CSS variable styling in a deep `ThemeManager` class in `tokens.ts`. Call `themeManager.init()` in `renderer.ts`.
- **Wins**:
  - _Locality: OS media query and theme styling cohere_
  - _Eliminates duplicate matchMedia queries_
  - _Clean lifecycle: ThemeManager manages its own listeners_
  - _renderer.ts root shrinks by 10 lines of loose wiring_
  - _Settings view previews delegate to themeManager_

---

### Candidate 2: Consolidate State Persistence into `AntigravityHealthManager`

- **Files**:
  - `apps/omp-extension/src/circuit-breaker.ts`
  - `apps/omp-extension/src/health-manager.ts`
- **Problem**:
  `circuit-breaker.ts` retains 60 lines of duplicate JSON file reading and writing (`writeState`, `readStateForWrite`, `readSnapshot`, `readStreaks`, `readStreaksForWrite`, `writeStreaks`) that circular-imports with `health-manager.ts` and bypasses the health manager instance `targetDir`.
- **Solution**:
  Consolidate all state file persistence inside `AntigravityHealthManager` and reduce `circuit-breaker.ts` persistence functions to direct delegates.
- **Wins**:
  - _Eliminates circular module dependency_
  - _Eliminates 60 lines of duplicate JSON file I/O_
  - _Single Source of Truth for extension state persistence_
  - _circuit-breaker.ts becomes a lean constants module_
  - _True dependency injection: all I/O respects healthManager's targetDir_

---

### Candidate 3: Clean Core Export Seam & Restore Domain Purity in Formatting

- **Files**:
  - `packages/core/src/index.ts`
  - `packages/core/src/format.ts`
  - `packages/tui/src/theme.ts`
- **Problem**:
  `@omp-toolkit/core` exposes 12 internal compiler transformation functions from `usage.ts` that zero external callers use, while leaking terminal column padding helpers (`padPercent`, `padResetCompact`) into pure domain core.
- **Solution**:
  Scope intermediate compiler functions internal to core, export strictly public domain helpers from the package index, and localize terminal column padding in `@omp-toolkit/tui`.
- **Wins**:
  - _Core index presents clean public domain seam_
  - _Hides 7 internal compiler stages from external callers_
  - _Terminal column padding moves to presentation layer_
  - _Restores domain purity to @omp-toolkit/core_
  - _Eliminates obsolete pipeline exports_
