# OMP Toolkit 90-day reliability roadmap

## North star and success metric

- **North star:** one operator, two independent Windows machines, four OMP
  providers (Google Antigravity, OpenAI Codex, Muse Code, DeepSeek), zero manual
  route fixes for 30 consecutive days.
- **Manual route fix:** any `/gemini-enable`, `/gemini-heal`, or
  `/gemini-restore` invocation, or any incident that remains unresolved for
  more than 15 minutes.
- **Not a manual route fix:** restarting OMP, Orca, or the monitor after a
  reboot; running the one-time `/gemini-auto-restore` opt-in; reading the
  monitor.
- **Proof:** `bun run reliability:report --days=30 --machine all` exits 0 only
  when every machine has route-check coverage for every day, zero manual
  interventions, and zero late incidents.
- **Second machine:** joins on day 51, after the first machine has passed the
  Phase 1 and Phase 2 acceptance gates.

## Baseline

- `v0.1.0` extension with event-driven Gemini health, managed exclusions, and
  the route snapshot.
- Provider usage CLI with Google Antigravity route health plus OpenAI Codex,
  Muse Code, and DeepSeek usage.
- `bun run monitor:orca` one-command Floating Workspace launcher.
- Known manual exclusion: `<account>` still uses a manual `reservePct: 100`
  policy.
- No history database, no cross-process lock, no opt-in auto-restore, no
  recovery timer, no incident alerting, no reliability report.

Cross-platform installation and CLI support are defined by
[ADR-0004](adr/0004-cross-platform-support.md); the 30-day reliability proof
remains on Windows.

> This roadmap is public. Personal machine names, account emails, and terminal
> handles must not be added to it.

## Phase table

| Phase | Days | Theme | Effort | Exit gate |
|---|---:|---|---:|---|
| 0 | 1–14 | Instrument the truth | 12–16 h | 7 days of history rows and a working weekly report |
| 1 | 15–35 | Hands-off recovery | 18–24 h | Opt-in restore and conditional timer pass tests; 7 days on machine 1 |
| 2 | 36–50 | Safe concurrency | 12–18 h | Two concurrent writers cannot lose policy updates; lock tests pass |
| 3 | 51–90 | Alert and prove | 20–28 h | 30 consecutive days, both machines, report exit 0 |

Dependencies are strict: Phase 1 starts only after Phase 0's report works;
Phase 2 starts only after Phase 1's acceptance; Phase 3 starts only after
Phase 2's lock is in use by every mutating path.

## Phase 0 — Instrument the truth (Days 1–14)

**Outcome:** the operator can measure reliability instead of remembering it.

### Work items

1. Add `packages/core/src/history.ts` with pure types only:
   ```ts
   export type HistoryEventKind =
     | "route_check"
     | "policy_change"
     | "manual_intervention"
     | "restore"
     | "incident"
     | "incident_resolved"
     | "alert"
     | "session_start";

   export interface HistoryEvent {
     at: number;
     machineId: string;
     kind: HistoryEventKind;
     provider?: string;
     account?: string;
     status?: string;
     incidentId?: string;
     detail?: string;
   }
   ```
   Export it from `packages/core/src/index.ts`.

2. Add `apps/omp-extension/src/history.ts` using `bun:sqlite`. It owns all
   history I/O; `packages/core` stays pure.

   Database path: `~/.omp/agent/omp-toolkit-history.db`, overridable with
   `OMP_TOOLKIT_HISTORY_DB`.

   Schema, created with `CREATE TABLE IF NOT EXISTS`:
   ```sql
   events(
     id INTEGER PRIMARY KEY,
     at INTEGER NOT NULL,
     machine_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     provider TEXT,
     account TEXT,
     status TEXT,
     incident_id TEXT,
     detail TEXT
   );
   ```
   Add indexes on `events(at)`, `events(kind, at)`, and
   `events(incident_id)`. Set `PRAGMA journal_mode = WAL` and
   `PRAGMA busy_timeout = 5000`. Delete rows older than 30 days on open, once
   per process.

3. Add machine identity. On first history open, create
   `~/.omp/agent/omp-toolkit-machine.json` atomically:
   ```json
   { "id": "<crypto.randomUUID()>", "hostname": "<os.hostname()>", "createdAt": 0 }
   ```
   Read it on every process start; never regenerate while the file exists.
   If the file is corrupt, throw and surface the path; do not overwrite it.

4. Wire event writes in `apps/omp-extension/src/index.ts`:
   - `recordHealth(results)` writes one `route_check` event per result.
   - `applyHeal` writes `policy_change` for each changed account.
   - `restoreManaged` writes `restore` for each restored account.
   - `/gemini-enable`, `/gemini-heal`, `/gemini-restore` write
     `manual_intervention` with the command name.
   - `session_start` writes `session_start`.
   History failures must not fail a health check, heal, or restore; catch and
   emit a single warning per process.

5. Add `scripts/reliability-report.ts` and the package script:
   ```json
   "reliability:report": "bun scripts/reliability-report.ts"
   ```
   Flags: `--days=<n>` default 30, `--machine=<id|all>` default `all`.
   With independent per-machine state, run the report on each machine;
   `--machine all` means all machine ids present in that machine's local
   database.
   Output one table row per machine:
   `machine | days | checks | ok | hang | error | auth | restores | manual | incidents | late | monitor-age`.
   `incidents` counts `incident` events. `late` counts incidents whose matching
   `incident_resolved` event is absent 15 minutes after the incident (or absent
   entirely); match on `incident_id`. A `late` incident counts as a manual
   failure for the exit code.
   Exit 0 only when every machine has checks on every requested UTC day, zero
   manual interventions, and zero `late` incidents; otherwise exit 1.
   If the database is absent, print `no history` and exit 1.

6. Add a monitor heartbeat. `apps/provider-usage/src/index.ts` writes
   `~/.omp/agent/omp-toolkit-monitor.json` atomically on every successful
   `runOnce()`:
   ```json
   { "at": 0, "hostname": "<os.hostname()>", "pid": 0 }
   ```
   The report matches the heartbeat to the machine by hostname and treats a
   heartbeat older than 10 minutes as stale; it prints `monitor-age=stale`.

### Acceptance

- `bun run check` passes.
- Run the extension once, then `bun run reliability:report --days=1` prints one
  machine, at least one check, zero manual interventions, and
  `monitor-age=stale` until the monitor runs.
- Run `bun ~/.omp/agent/scripts/omp-provider-usage.js --health`, then repeat the
  report; `monitor-age` is a recent age, not `stale`.
- Restart OMP; the machine id is unchanged and history rows accumulate.
- A forced history write failure prints one warning and does not fail the
  health check.

## Phase 1 — Hands-off recovery (Days 15–35)

**Outcome:** managed and opted-in manual exclusions restore while OMP is idle,
without operator commands.

### Work items

1. Add the sidecar `~/.omp/agent/gemini-health-auto-restore.json` with shape
   `{ "enabled": ["email"] }`. Add strict read/write helpers to
   `apps/omp-extension/src/index.ts`, using the existing `writeFileAtomic`
   pattern. Corrupt content throws; do not clobber.

2. Add commands in `apps/omp-extension/src/index.ts`:
   - `/gemini-auto-restore <email-or-local-part>`: resolve against
     `loadAccounts()`; refuse ambiguous local parts; write the exact email.
   - `/gemini-auto-restore off <email-or-local-part>`: remove the email.
   - `/gemini-auto-restore` with no args: list opted-in accounts and current
     manual exclusions.
   Each successful change writes a `policy_change` history event.

3. Change `restorableEmails` in `packages/core/src/health.ts` to:
   ```ts
   export function restorableEmails(
     state: HealthState,
     streaks: StreakState,
     threshold: number,
     optedIn: ReadonlySet<string> = new Set(),
     manuallyExcluded: ReadonlySet<string> = new Set(),
   ): string[] {
     return [...new Set([...state.excluded, ...manuallyExcluded])].filter(
       (email) => {
         if (!state.excluded.includes(email) && !optedIn.has(email)) return false;
         return (streaks[email]?.ok ?? 0) >= threshold;
       },
     );
   }
   ```
   Managed exclusions need no opt-in; manual exclusions require it.

4. Update `maybeRestoreManaged` in `apps/omp-extension/src/index.ts`:
   - Read policies, `state.excluded`, auto-restore sidecar, and streaks.
   - Compute `manuallyExcluded` as emails with `reservePct >= 100` that are not
     in `state.excluded`.
   - Pass `optedIn` and `manuallyExcluded` to `restorableEmails`.
   - For every restorable email, remove its policy. Remove it from
     `state.excluded` only if it was managed. Keep the auto-restore sidecar
     entry so the account stays opted in.
   - Call `reloadIfAvailable(ctx)` after a non-empty restore and write
     `restore` events.

5. Add the conditional recovery timer in the extension factory:
   - Add `isIdle(): boolean;` to `ExtensionContext` in
     `apps/omp-extension/src/omp-types.d.ts`.
   - Constants: `RECOVERY_INTERVAL_MS = 300_000`, override with
     `GEMINI_HEALTH_RECOVERY_INTERVAL_SECONDS`, minimum 60 seconds.
   - On `session_start`, clear any previous interval and start
     `setInterval(tick, RECOVERY_INTERVAL_MS)` only when
     `ctx.agent.kind === "main"`.
   - `tick`: return if `running`; return if `!ctx.isIdle()`; return if there is
     no managed exclusion and no opted-in manual exclusion; otherwise call
     `refresh(ctx, false)`.
   - On `session_shutdown`, clear the interval.
   - Do not probe healthy periods: an empty exclusion set skips the tick
     without calling `omp usage` or a model probe.

6. Add tests in `packages/core/src/index.test.ts`:
   - managed exclusion restores without opt-in;
   - manual exclusion does not restore without opt-in;
   - opted-in manual exclusion restores at the threshold;
   - opted-in manual exclusion below the threshold does not restore;
   - duplicates across managed/manual sets restore once.

### Acceptance

- `bun run check` passes.
- Set a manual exclusion for a test account, run `/gemini-auto-restore <account>`,
  then simulate three spaced healthy checks; the policy is removed and a
  `restore` event exists.
- The same account without opt-in stays excluded after the same streak.
- With no exclusions, the timer runs for 15 minutes and the history DB gains
  no new `route_check` rows.
- With an opted-in exclusion, the timer produces a check at the configured
  interval while `ctx.isIdle()` is true.
- Shut down OMP; no timer callback runs after `session_shutdown`.

## Phase 2 — Safe concurrency (Days 36–50)

**Outcome:** the extension, the health CLI, and command handlers cannot lose a
policy update when they overlap.

### Work items

1. Add `apps/omp-extension/src/lock.ts`:
   - Lock path `~/.omp/agent/omp-toolkit.lock`.
   - `acquireLock(operation: string, timeoutMs = 5_000)`:
     - open with `fs.openSync(path, "wx")`;
     - write `{ token, pid, machineId, operation, acquiredAt }`;
     - on `EEXIST`, read the lock; if `acquiredAt` is older than 30 seconds,
       unlink and retry; otherwise sleep 50 ms and retry until timeout;
     - throw `lock_timeout` after the deadline.
   - `releaseLock(token)`: unlink only when the stored token matches.
   - `withLock(operation, fn)`: acquire, run, release in `finally`.

2. Wrap every read-modify-write path in `withLock`:
   - `writeState`, `writeStreaks`, `writePolicies`, `applyHeal`,
     `restoreManaged`, `maybeRestoreManaged`, and the history retention delete.
   - Do not wrap read-only snapshot reads or `publish`.
   - Keep atomic file writes; the lock protects the read-modify-write window,
     not individual writes.

3. Add `scripts/doctor.ts` and `"doctor": "bun scripts/doctor.ts"`:
   - check OMP version via `omp --version`;
   - check installed extension/script files exist;
   - check history DB opens and schema version is current;
   - check machine id file;
   - check lock file is either absent or stale;
   - check Orca floating selector with
     `orca terminal list --worktree id:global-floating-terminal --json`;
   - print PASS/FAIL per check and exit 1 on any FAIL.

4. Document the two-machine rollout in `docs/runbook.md`:
   - install on machine 1, run the 30-day proof;
   - install the same independent setup on machine 2 on day 51;
   - each machine has its own agent dir, history DB, machine id, and monitor;
   - no sync, no shared config, no cross-machine lock.

### Acceptance

- `bun run check` passes.
- Unit tests in `apps/omp-extension/src/lock.test.ts` using a temp directory:
  - second acquire waits and then succeeds after release;
  - stale lock is removed;
  - timeout throws `lock_timeout`;
  - release with the wrong token leaves the lock intact.
- Run `/gemini-heal` and the extension timer concurrently in a test harness;
  both complete and the policy file contains every expected change.
- `bun run doctor` reports all PASS on machine 1 and is safe to run while the
  monitor is running.

## Phase 3 — Alert and prove (Days 51–90)

**Outcome:** incidents are visible, and the 30-day metric is auditable.

### Work items

1. Add `scripts/windows-toast.ps1` with `param([string]$Title, [string]$Message)`.
   Try, in order:
   1. `BurntToast` module if `Get-Module -ListAvailable BurntToast` returns it;
   2. WinRT `Windows.UI.Notifications.ToastNotificationManager` with
      `CreateToastNotifier("OMP Toolkit")`;
   3. exit 0 without a toast, after printing `toast_unavailable`.
   The extension calls it with `powershell.exe -NoProfile -ExecutionPolicy
   Bypass -File <path> -Title "OMP Toolkit" -Message <text>`. Toast failures
   must not fail a health check.

2. Add incident recording in the extension:
   - `HealthSnapshot` gains optional
     `incident?: { id: string; at: number; kind: "all-failed" | "restore-failed" | "lock-timeout" | "history-error"; detail: string }`.
   - Set `incident` when every probed account fails, when a restore attempt
     throws, when the lock times out, or when the history DB fails.
   - Write an `incident` event with `incidentId = incident.id` and call the
     toast. Throttle to one toast per `kind` per 15 minutes.
   - Clear `incident` and write `incident_resolved` with the same
     `incidentId` after a subsequent healthy check or successful restore.

3. Render the incident in the monitor:
   - `packages/tui/src/provider-usage-view.ts` adds one red line immediately
     below the summary when `options.showHealth` and the snapshot has an
     incident newer than 24 hours: `INCIDENT <kind> · <age> · <detail>`.
   - The line truncates detail to fit the 86-column frame.
   - The footer continues to show `health <age>`.

4. Run the proof:
   - Machine 1 starts its 30-day proof on day 51 after Phase 2 acceptance.
   - Install machine 2 on day 51 with the same independent setup.
   - Both machines run `bun run monitor:orca` and the in-process recovery
     timer.
   - Before day 51, opt in `<account>` on machine 1 with
     `/gemini-auto-restore <account>`; that setup action is not counted.
   - Weekly: `bun run reliability:report --days=7 --machine all`; record the
     output in the weekly review note.
   - Day 80: run `bun run reliability:report --days=30 --machine all`; it must
     exit 0.
   - Days 81–90: buffer for regressions; no new feature work.

### Operating cadence

- **Monday, 15 minutes:** run `bun run reliability:report --days=7`; choose one
  fix at most.
- **Friday, 10 minutes:** confirm `monitor-age` is fresh; copy the history DB to
  `~/.omp/agent/backups/history-<date>.db`.
- **Incident:** run `bun run doctor`; read the monitor banner; do not edit
  policies by hand unless the report shows a lock or restore failure.

### Acceptance

- `bun run check` passes.
- Force an all-accounts-failed snapshot; the monitor shows one `INCIDENT`
  line, the history DB has one `incident` event, and one toast is attempted.
- Resolve the incident with a healthy check; `incident_resolved` is written
  and the banner disappears.
- `bun run reliability:report --days=30 --machine all` exits 0 with the
  expected table on day 80.

## Definition of done

The 90-day roadmap is complete when all of the following are true:

- Machine 1 and machine 2 each have 30 consecutive days with route-check
  coverage for every day.
- `bun run reliability:report --days=30 --machine all` exits 0 on each machine.
- Manual interventions: 0 on both machines.
- Late incidents: 0 on both machines.
- The monitor heartbeat is fresh on both machines.
- No policy was edited by hand during the proof window.
- The second machine uses independent state; no sync or shared database.

> This roadmap deliberately excludes public distribution, a provider SDK, a web
> dashboard, and macOS/Linux support until the 30-day proof is complete. The
> desktop widget is a monitor host and does not change the Windows-only 30-day
> reliability proof.
