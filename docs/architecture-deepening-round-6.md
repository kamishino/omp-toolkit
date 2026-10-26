# Architecture Review & Deepening (Round 6)

_Date: 2026-10-26_  
_Focus: Auto-heal concurrency encapsulation, core heartbeat single source of truth, and type-safe desktop IPC seams._  
_Vocabulary: Based on `skill://codebase-design` (module, interface, depth, seam, adapter, leverage, locality)._

---

## 1. Candidate Overview

| #     | Candidate                                                                | Recommendation | Dependency Category   | Core Seam Impact                                                                                                                                                                                              |
| :---- | :----------------------------------------------------------------------- | :------------- | :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** | **Encapsulate Concurrency & Probing Workflows in `AutoHealCoordinator`** | `Strong`       | `in-process`          | Eliminates leaking `isRunning`/`setRunning` lock primitives in `auto-heal.ts`, consolidating mutual exclusion and the probe-and-publish workflow into deep coordinator methods.                               |
| **2** | **Unify Monitor Heartbeat Contract & Path in `@omp-toolkit/core`**       | `Strong`       | `in-process`          | Adds `resolveHeartbeatPath` to `packages/core/src/environment.ts` and `MonitorHeartbeat` to `types.ts`, eliminating duplicate `agentDir()` in `provider-usage` and ad-hoc types in `omp-extension`.           |
| **3** | **End-to-End Type-Safe IPC Contract for Desktop**                        | `Strong`       | `local-substitutable` | Maps string IPC channel keys to typed payload signatures in `apps/desktop/src/ipc.ts`, eliminating unchecked parameter casts in `main.ts` and enforcing compile-time verification across the Electron bridge. |

---

## 2. Detailed Specifications

### Candidate 1: Encapsulate Concurrency & Probing Workflows in `AutoHealCoordinator`

- **Files**:
  - `apps/omp-extension/src/auto-heal.ts`
  - `apps/omp-extension/src/commands.ts`
- **Problem**:
  `AutoHealCoordinator` exposes `isRunning` and `setRunning(boolean)`. Command handlers in `commands.ts` manually implement try/finally lock management in 4 separate commands, and duplicate the probe-record-restore-publish sequence.
- **Solution**:
  Remove `setRunning` from the public interface. Provide `runExclusive(ctx, label, action)` for atomic execution and `probeAndPublish(ctx, options)` for the standard diagnostic workflow.
- **Wins**:
  - _Delete leaking setRunning lock primitive_
  - _Depth: coordinator executes atomic workflows_
  - _Locality: lock state stays inside coordinator_
  - _commands.ts shrinks by ~40 lines of boilerplate_
  - _Zero risk of unreleased concurrency locks_

---

### Candidate 2: Unify Monitor Heartbeat Contract & Path in `@omp-toolkit/core`

- **Files**:
  - `packages/core/src/environment.ts`
  - `packages/core/src/types.ts`
  - `apps/provider-usage/src/heartbeat.ts`
  - `apps/omp-extension/src/history-store.ts`
- **Problem**:
  `environment.ts` omits the monitor heartbeat path, causing `apps/provider-usage` to reimplement its own `agentDir` and `apps/omp-extension` to independently hardcode filenames and local types.
- **Solution**:
  Add `resolveHeartbeatPath` and `MonitorHeartbeat` to `@omp-toolkit/core`, and migrate `heartbeat.ts` and `history-store.ts` to consume them.
- **Wins**:
  - _Single source of truth for all toolkit paths_
  - _Delete duplicated agentDir in provider-usage_
  - _Delete duplicate LocalHeartbeat type_
  - _Locality: heartbeat contract co-located in core_
  - _Changes to heartbeat path update once_

---

### Candidate 3: End-to-End Type-Safe IPC Contract for Desktop

- **Files**:
  - `apps/desktop/src/ipc.ts`
  - `apps/desktop/src/preload.ts`
  - `apps/desktop/src/main.ts`
- **Problem**:
  The IPC seam between Electron's main process and browser renderer relies on raw string constants and unchecked parameter casts in `main.ts`, preventing the compiler from catching mismatched channel names or payload signatures.
- **Solution**:
  Define a strongly typed `RendererToMainEvents` map in `ipc.ts` and introduce typed `onIpc` and `sendIpc` helpers.
- **Wins**:
  - _Compile-time verification across IPC seam_
  - _Eliminate unchecked parameter casts in main.ts_
  - _Payload changes immediately flag broken callers_
  - _Leverage: single event contract for preload and main_
  - _Clean, refactoring-safe IPC architecture_
