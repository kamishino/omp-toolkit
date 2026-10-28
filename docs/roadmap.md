# OMP Toolkit 90-day execution-quality roadmap

## North star and success metric

- **North star:** measurably better agent execution quality at no worse cost,
  for one operator across two independent Windows machines and four OMP
  providers (Google Antigravity, OpenAI Codex, Muse Code, DeepSeek), while
  finishing the 30-consecutive-day zero-manual-fix reliability proof as an
  unwaivable exit gate.
- **North-star metric (pooled across both machines):**
  - `errorEndedRate = agent_run(status="error") / agent_run(all)`.
  - `costProxy`: mean tokens per non-error run if per-run token totals are
    available in `agent_end` payloads; otherwise `agent_run(all) / session_start`
    (runs per session).
  - **Success at Day 90:** `errorEndedRate` improved by $\ge 25\%$ relative to
    baseline, `costProxy` not worse than baseline by $> 10\%$, and $\ge 30$
    `agent_run` samples present in each measurement window (baseline and Days
    51–80). If a window has $< 30$ samples, the metric gate is reported as
    `insufficient data` and is treated as not met.
- **Mandatory reliability gate:**
  - **Manual route fix:** any `/gemini-enable`, `/gemini-heal`, or
    `/gemini-restore` invocation, or any incident that remains unresolved for
    more than 15 minutes.
  - **Not a manual route fix:** restarting OMP, Orca, or the monitor after a
    reboot; running the one-time `/gemini-auto-restore` opt-in; reading the
    monitor.
  - **Proof:** `bun run reliability:report --days=30 --machine all` exits 0 only
    when every machine has route-check coverage for every day, zero manual
    interventions, and zero late incidents during the Days 51–80 proof window
    (or the single permitted restart window).
  - **Precedence:** the cycle fails if the reliability gate fails, even if
    execution-quality thresholds are met.
- **Capacity:** sized for ~5 hours/week including operating cadence; strictly
  one feature at a time.

## Baseline

- Reliability history SQLite database (`omp-toolkit-history.db`) with
  machine identity and `bun run reliability:report`.
- Gemini health probe client and circuit breaker with managed exclusions.
- Opt-in auto-restore sidecar (`gemini-health-auto-restore.json`),
  `/gemini-auto-restore` command, and in-process idle recovery timer
  (`RECOVERY_INTERVAL_MS = 300_000`).
- Cross-process lock (`apps/omp-extension/src/lock.ts`) wrapping all mutating
  health paths (`applyHeal`, `restoreManaged`, `maybeRestoreManaged`,
  `removeExclusion`, `writePolicies`).
- Eval-locked model pairing (Pair A `deepseek/deepseek-flash`) and versioned
  plan-to-executor handoff contract template (`templates/plan-exec-handoff/`).
- Weekly pacing, multi-provider schedule, desktop tray widget, and TUI
  monitor are shipped and maintain-only this cycle.
- **Known gaps:**
  - No `scripts/doctor.ts` or `bun run doctor` command exists in the tree
    (yet `docs/runbook.md` references it).
  - No production writer emits `incident` or `incident_resolved` events into
    history; the report's `late` incident metric is currently vacuous.
  - Two-machine rollout is undocumented in `docs/runbook.md`.
  - Machine 2 is not yet installed.
  - Account `<account>` still requires a manual `reservePct: 100` exclusion.

> This roadmap is public. Personal machine names, account emails, and terminal
> handles must not be added to it.

## Phase table

| Phase | Days  | Theme                        | Effort  | Exit gate                                                                                   |
| ----- | ----: | ---------------------------- | ------: | ------------------------------------------------------------------------------------------- |
| 0     |  1–14 | Close reliability gaps       | 12–16 h | doctor all-PASS on both machines; incident write→resolve proven; machine 2 installed        |
| 1     | 15–32 | Instrument execution quality | 10–14 h | `execution:report` prints pooled baseline from $\ge 14$ days and $\ge 30$ samples          |
| 2     | 33–50 | Improve execution quality    |  8–12 h | Each attempted menu intervention kept or reverted by 7-day keep/kill in Monday review notes |
| 3     | 51–90 | Prove both gates             |   4–6 h | `reliability:report --days=30` exit 0 on both machines and north-star thresholds met        |

### Strict dependencies and slippage rules

- Dependencies are strict: Phase 1 starts only after Phase 0's doctor and
  incident tests pass; Phase 2 starts only after Phase 1's baseline report is
  recorded; Phase 3 starts strictly on Day 51.
- **Day 51 never moves.** The 30-day proof requires an uninterrupted window
  on a frozen system.
- If Phase 0 or Phase 1 slips, Phase 0 and Phase 1 exit gates may **never** be
  waived. Slippage is absorbed first by cutting Phase 2 menu interventions from
  the bottom of the ranking, and second by consuming the Days 81–90 buffer.
- Phase 1 baseline observation may shrink only to the 14-day minimum.

---

## Phase 0 — Close reliability gaps (Days 1–14)

**Outcome:** the mandatory reliability proof becomes honest, complete, and
operable across both machines.

### Work items

1. Add `scripts/doctor.ts` and `"doctor": "bun scripts/doctor.ts"` in
   `package.json`:
   - check OMP version via `omp --version`;
   - check installed extension and script files exist;
   - check history DB opens and schema version is current;
   - check machine id file (`omp-toolkit-machine.json`) exists and is valid;
   - check lock file (`omp-toolkit.lock`) is either absent or stale;
   - check Orca floating selector with
     `orca terminal list --worktree id:global-floating-terminal --json`;
   - print PASS/FAIL per check and exit 1 on any FAIL.

2. Document the two-machine rollout in `docs/runbook.md`:
   - install on machine 1, verify baseline health and history;
   - install the same independent setup on machine 2 during Phase 0;
   - each machine has its own agent dir, history DB, machine id, and monitor;
   - no sync, no shared config, no cross-machine lock.

3. Implement incident recording, Windows toast notifications, and monitor banner:
   - Add `scripts/windows-toast.ps1` with `param([string]$Title, [string]$Message)`.
     Try, in order:
     1. `BurntToast` PowerShell module if available;
     2. WinRT `Windows.UI.Notifications.ToastNotificationManager` with
        `CreateToastNotifier("OMP Toolkit")`;
     3. exit 0 without toast after printing `toast_unavailable`.
     The extension invokes it with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <path> -Title "OMP Toolkit" -Message <text>`. Toast failures must not fail a health check.
   - Update `HealthSnapshot` in `packages/core/src/types.ts` with optional:
     `incident?: { id: string; at: number; kind: "all-failed" | "restore-failed" | "lock-timeout" | "history-error"; detail: string }`.
   - In `apps/omp-extension`: set `incident` when every probed account fails,
     when restore throws, when lock times out, or when history DB throws. Write
     an `incident` history event with `incidentId = incident.id` and invoke the
     toast (throttled to 1 toast per `kind` per 15 minutes).
   - Clear `incident` and write `incident_resolved` with the matching
     `incidentId` after a subsequent healthy check or successful restore.
   - In `packages/tui/src/provider-usage-view.ts`: add one red line immediately
     below the summary when `options.showHealth` is active and the snapshot has
     an incident newer than 24 hours: `INCIDENT <kind> · <age> · <detail>`,
     truncating detail to fit the 86-column frame. Footer continues to show
     `health <age>`.

4. Minor maintenance items:
   - Verify probe pins (`MODEL_WIRE`, `PI_AI_ANTIGRAVITY_VERSION` in
     `apps/omp-extension/src/probe-client.ts`) against upstream OMP and bump if
     stale.
   - Audit remaining persistence/`applyHeal` flow tests in `HANDOFF.md` §8;
     add only missing test coverage.

5. Machine 2 setup and manual account opt-in:
   - Run `bun run install:omp` on machine 2, initializing its independent
     history DB, machine id, and monitor.
   - Run `/gemini-auto-restore <account>` on machine 1 to opt in `<account>`.
     Setup actions taken during Phase 0 precede the proof window and are not
     counted as manual interventions.

### Acceptance

- `bun run check` passes.
- `bun run doctor` reports all PASS on machine 1 and machine 2, and is safe
  to run while the monitor is active.
- Simulate an all-accounts-failed snapshot in a test harness: monitor renders
  one `INCIDENT` line, history DB gains one `incident` event, and toast dispatch
  is attempted.
- Follow with a healthy check: `incident_resolved` is written and the incident
  banner clears.
- Machine 2 runs `bun run reliability:report --days=1` and prints its own
  distinct machine id with $\ge 1$ check.

---

## Phase 1 — Instrument execution quality (Days 15–32)

**Outcome:** execution quality and cost proxies are automatically recorded
from real sessions, establishing the auditable baseline for the cycle.

### Work items

1. Confirm session payload telemetry:
   - Inspect live `agent_end` event object and `ctx.models.current()` in
     `apps/omp-extension/src/auto-heal.ts` for token usage fields.
   - **Pre-decided branch:** if token counts are exposed on `agent_end`,
     `costProxy` = mean tokens per non-error run; otherwise `costProxy` =
     `agent_run(all) / session_start` (runs per session).

2. Extend domain history types and wire session event recording:
   - Add `"agent_run"` to `HistoryEventKind` in `packages/core/src/history.ts`.
   - In `apps/omp-extension/src/auto-heal.ts`: on `agent_end` when
     `ctx.agent.kind === "main"`, record one `agent_run` history event:
     - `provider`: current model provider from `ctx.models.current()`;
     - `status`: `"error"` if last assistant message `stopReason === "error"`,
       else `"ok"`;
     - `detail`: model id (plus formatted `tok=<n>` if token counts exist).
   - Wrap history writes in try/catch; history failure must never crash an
     agent session (emit at most one process warning).

3. Build execution quality reporting CLI:
   - Add `scripts/reliability/execution-report.ts` and `"execution:report": "bun scripts/reliability/execution-report.ts"` in `package.json`.
   - Flags: `--days=<n>` (default 14), `--machine=<id|all>` (default `all`).
   - Output one table row per machine:
     `machine | days | runs | error | errorRate | sessions | costProxy | manual`.
   - Output a final `POOLED` summary row summing runs, errors, and sessions
     arithmetically (never averaging percentages).
   - If history DB is missing or has zero `agent_run` rows, print
     `no execution data` and exit 1.

4. Accrue baseline data:
   - Operate normally across both machines for $\ge 14$ consecutive days after
     telemetry lands.
   - At Phase 1 exit gate, run `bun run execution:report --days=14` on machine 1
     and machine 2; record printed tables and the pooled baseline rate in that
     week's Monday review note.

### Acceptance

- `bun run check` passes.
- Trigger an agent session ending in success and one ending in error;
  `agent_run` rows accumulate in `omp-toolkit-history.db` with matching
  status.
- `bun run execution:report --days=14` on machine 1 prints $\ge 30$ runs with
  a calculated error rate.
- Forcing a history write failure emits one warning without interrupting the
  agent session.
- Baseline outputs from both machines are recorded in the weekly review note,
  documenting the baseline `errorEndedRate` and `costProxy`.

---

## Phase 2 — Improve execution quality (Days 33–50)

**Outcome:** apply strictly pre-evidenced interventions sequentially, keeping
only changes that measurably maintain or improve execution quality.

### Ranked intervention menu

Interventions must be executed one at a time in this exact priority order. An
item may be skipped only with written justification recorded in the Monday
review note; unranked or off-menu interventions are prohibited:

1. **Lock evaluated model roles in user config:**
   - Manually apply the winning Pair A configuration (`deepseek/deepseek-flash`
     for plan and default) to `~/.omp/agent/config.yml` with executor
     `thinking_level: low`, reserving `high` for single verification retries.
2. **Apply plan-to-executor handoff contract template:**
   - Apply `templates/plan-exec-handoff/` as the default working persona via
     `/template apply plan-exec-handoff`.
3. **Re-evaluate model pairings on catalog shifts:**
   - Run `bun scripts/eval/eval-model-roles.ts --live --report` at phase start.
     Re-lock roles only if the scorecard winner changes by the established
     decision rule (first-pass solve rate $\to$ plan acceptance $\to$ cost).
4. **Targeted wire normalizer fixes:**
   - Apply fixes to `apps/omp-extension/src/gemini-normalizer.ts` only when an
     active wire failure is reproduced by a failing test in the test suite.
5. **Tighten context-economy rules:**
   - Adjust `.omp/AGENTS.md` and template instructions only where Phase 1
     baseline data exposes clustered error patterns by provider or model.

### Keep / kill measurement rule

- After applying an intervention, observe for $\ge 7$ consecutive days.
- **Keep:** pooled `errorEndedRate` over the 7-day window does not exceed
  the trailing 7 days before it, **and** `costProxy` is not worse by $> 10\%$.
- **Kill / Revert:** if error rate regresses or cost exceeds threshold, revert
  the configuration or code change immediately and record the revert in the
  Monday review note.
- If a 7-day window yields $< 30$ runs, extend observation until 30 runs
  accrue or Day 50 is reached.

### Acceptance

- Every attempted intervention has a documented kept/reverted verdict with
  supporting before/after report metrics in the Monday review notes.
- `bun run check` passes after every code or template modification.
- Unattempted menu items are explicitly accounted for as cut under the
  Day 51 slippage rule or skipped with recorded reasons.

---

## Phase 3 — Prove both gates (Days 51–90)

**Outcome:** both machines achieve the 30-day zero-manual-fix reliability proof
under a frozen system while final execution quality is verified.

### Work items

1. **System freeze (Day 51):**
   - Strictly no new features, refactors, or menu interventions after Day 50.
   - Code changes permitted during Days 51–90 strictly to fix an active
     blocking incident. Maintain-only bugfixes to desktop or TUI are allowed
     only if they touch zero health, policy, or session telemetry code and are
     logged in the Monday review.

2. **Continuous dual-machine operation:**
   - Machine 1 and machine 2 run `bun run monitor:orca` and the in-process
     recovery timer continuously.
   - Both machines operate with independent state and zero manual policy edits.

3. **Day 80 audit:**
   - Run `bun run reliability:report --days=30 --machine all` on each machine
     (must exit 0).
   - Run `bun run execution:report --days=30 --machine all` on each machine
     and calculate pooled metrics over Days 51–80.

4. **Days 81–90 buffer:**
   - Reserved strictly for unexpected regression handling.

### Proof-break and restart rule

- Any manual route fix (`/gemini-enable`, `/gemini-heal`, `/gemini-restore`) or
  any incident remaining unresolved $> 15$ minutes breaks the 30-day count.
- **One restart permitted:** if a break occurs on or before Day 60, the
  operator may restart the 30-day window, concluding by Day 90 (consuming the
  buffer).
- If a break occurs after Day 60, or if a second break occurs, the cycle
  concludes at Day 90 as **failed**. Final reports are run and published in the
  review note without alteration.

### Acceptance

- `bun run check` passes.
- On Day 80 (or end of restart window), `bun run reliability:report --days=30 --machine all`
  exits 0 on machine 1 and machine 2.
- `bun run execution:report --days=30` pooled data contains $\ge 30$ samples
  and satisfies the $\ge 25\%$ error-rate improvement and $\le 10\%$ cost
  threshold.
- `git log` over Days 51–90 confirms compliance with the feature freeze.

---

## Operating cadence

- **Monday, 15 minutes:**
  - Run `bun run reliability:report --days=7`.
  - Run `bun run execution:report --days=7` (once Phase 1 telemetry lands).
  - Select at most one fix or intervention for the week.
  - Append report tables and decisions to the machine-local weekly review note
    (never committed to git, as it contains local hostnames).
- **Friday, 10 minutes:**
  - Confirm `monitor-age` is fresh on both machines.
  - Backup history database: copy `omp-toolkit-history.db` to
    `~/.omp/agent/backups/history-<YYYY-MM-DD>.db`.
- **Incident response:**
  - Run `bun run doctor`.
  - Read monitor `INCIDENT` banner.
  - Never edit policies by hand unless doctor/report identifies an unrecoverable
    lock or file corruption failure.

---

## Definition of done

The 90-day roadmap is complete when all of the following conditions are met:

1. **North-star execution quality met:** pooled `errorEndedRate` over the
   30-day proof window (Days 51–80) improved by $\ge 25\%$ compared to Phase 1
   baseline, with `costProxy` not worse by $> 10\%$, and $\ge 30$ runs
   recorded in both baseline and proof windows.
2. **Reliability proof exit 0:** `bun run reliability:report --days=30 --machine all`
   exits 0 on machine 1 and machine 2.
3. **Zero manual fixes:** 0 manual route interventions on both machines
   during the proof window.
4. **Zero late incidents:** 0 incidents unresolved after 15 minutes on either
   machine.
5. **Fresh heartbeats:** monitor heartbeat is fresh on both machines.
6. **No manual edits:** no routing policy was modified by hand during the
   proof window.
7. **Independence:** machine 2 operated entirely on local state without
   cross-machine sync or shared storage.
8. **Audited interventions:** every Phase 2 menu intervention has an
   empirical kept or reverted verdict logged in the review notes.

> This roadmap deliberately excludes public distribution, a provider SDK, a web
> dashboard, and macOS/Linux support until the next roadmap cycle. The desktop
> widget is a monitor host and does not alter the Windows-only 30-day
> reliability proof.
