# Architecture Review & Deepening (Round 7)

_Date: 2026-10-26_  
_Focus: Antigravity account resolution, desktop panel geometric cleanup, and core domain type segregation._  
_Vocabulary: Based on `skill://codebase-design` (module, interface, depth, seam, adapter, leverage, locality)._

---

## 1. Candidate Overview

| #     | Candidate                                                                      | Recommendation | Dependency Category   | Core Seam Impact                                                                                                                                                         |
| :---- | :----------------------------------------------------------------------------- | :------------- | :-------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Deepen `AntigravityHealthManager` with Account Resolution & Disambiguation** | `Strong`       | `in-process`          | Consolidates duplicated account needle filtering, local-part prefix matching, ambiguity checks, and notification formatting into a deep `resolveAccount(needle)` method. |
| **2** | **Clean Dead Parameters & Dead Code in Desktop Panel Geometry**                | `Strong`       | `local-substitutable` | Removes unused ghost `cursor` parameter from `PanelPositionOptions` and `placePanel`, and deletes uncalled `createPanel` dead export in `panel.ts`.                      |
| **3** | **Normalize Wire vs Domain Types in `@omp-toolkit/core`**                      | `Strong`       | `in-process`          | Segregates `packages/core/src/types.ts` into structured architectural sections with explicit docstrings distinguishing external wire schemas from domain models.         |

---

## 2. Detailed Specifications

### Candidate 1: Deepen `AntigravityHealthManager` with Account Resolution & Disambiguation

- **Files**:
  - `apps/omp-extension/src/health-manager.ts`
  - `apps/omp-extension/src/commands.ts`
  - `apps/omp-extension/src/health-manager.test.ts`
- **Problem**:
  `commands.ts` duplicates procedural account filtering across `gemini-warmup`, `gemini-check`, and `gemini-enable`: case-folding, prefix matching on `@`, ambiguity checking, and warning message formatting are repeated verbatim across multiple commands.
- **Solution**:
  Add `resolveAccount(needle: string): Promise<AccountResolution>` to `AntigravityHealthManager` returning `{ status: "found"; account: Account } | { status: "not_found"; error: string } | { status: "ambiguous"; error: string; matches: Account[] }`.
- **Wins**:
  - _Depth: 1 method handles search and disambiguation_
  - _Locality: account resolution logic coheres in health manager_
  - _commands.ts shrinks by ~35 lines of duplicate filtering_
  - _Account matching is 100% unit-testable on health manager_
  - _Standardizes exact-email over prefix-match priority_

---

### Candidate 2: Clean Dead Parameters & Dead Code in Desktop Panel Geometry

- **Files**:
  - `apps/desktop/src/panel-position.ts`
  - `apps/desktop/src/panel-position.test.ts`
  - `apps/desktop/src/panel.ts`
- **Problem**:
  `PanelPositionOptions.cursor` is queried via `screen.getCursorScreenPoint()` in `panel.ts` and passed into `placePanel`, but is **never read or used anywhere** inside `placePanel()`. In `panel.ts`, `createPanel` is dead exported code with zero callers.
- **Solution**:
  Remove the ghost `cursor` parameter from `PanelPositionOptions` and `placePanel`, and delete dead `createPanel` in `panel.ts`.
- **Wins**:
  - _Interface shrinks: eliminates unused ghost cursor parameter_
  - _Deletes unneeded screen.getCursorScreenPoint() call_
  - _Deletes dead createPanel export in panel.ts_
  - _Tests simplify without dummy cursor coordinates_
  - _Passes deletion test: complexity decreases with zero loss of behavior_

---

### Candidate 3: Normalize Wire vs Domain Types in `@omp-toolkit/core`

- **Files**:
  - `packages/core/src/types.ts`
  - `packages/core/src/index.ts`
- **Problem**:
  `packages/core/src/types.ts` is an unsegregated grab-bag mixing raw wire schemas (`UsageReport`, `MonitorHeartbeat`), circuit breaker domain types (`HealthResult`, `StreakState`), and intermediate tabular AST structures (`UsageColumn`, `ProviderRow`, `ProviderSection`).
- **Solution**:
  Organize types in `types.ts` into clear semantic sections (Wire Schemas, Health Domain, Aggregation Models), keeping the interface crystal clear and AI-navigable.
- **Wins**:
  - _High AI-navigability and clean domain documentation_
  - _Explicit separation of wire telemetry from business domain_
  - _Clear contracts for data-source adapters vs presentation models_
  - _Strengthens type definitions without breaking callers_
  - _Improves 6-month maintainability_
