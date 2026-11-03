# OMP Extension Evaluation — Decision Record and Report

**Status: Draft** — decision interview complete and scope contract accepted.
Only explicit user acceptance of the finished report may change this document
to Final. No evaluation findings or verdict are recorded yet, and ending the
interview does not by itself authorize implementation or fixes.

Target: `@omp-toolkit/omp-extension` in `apps/omp-extension/` (OMP runtime
extension and standalone CLI daemon; see `README.md` in this folder).

## Settled decisions (Q1–Q25)

| # | Decision | Settled answer |
| --- | --- | --- |
| Q1 | Purpose | End with a go / no-go / fix-first verdict plus a prioritized fix list, not a neutral description. |
| Q2 | Primary lens | Trust first: correctness, failure modes, testability, and coupling to omp outrank features and polish. |
| Q3 | Scope boundary | The extension plus its host contract with omp (host APIs, config, lifecycle). No full audit of omp itself or the rest of omp-toolkit. |
| Q4 | Evidence bar | Every material claim needs inspected code, run tests, or reproduced behavior. Anything else is labelled unconfirmed. README/comments alone are not evidence. |
| Q5 | Failure definition | One load-bearing flaw (data loss, security hole, silent wrong output, host-breaking crash) fails the evaluation regardless of other strengths. |
| Q6 | Output form | This written report in the repo. No code fixes until the user approves the report; evaluation and remediation are separate decisions. |
| Q7 | Standard | **Personal tool only** (user override of the publishable recommendation). Rough edges and thin docs are acceptable if it works for the owner; this does not lower the Q2/Q5/Q10 trust and safety bars. |
| Q8 | Execution | Run it for real: builds, its test suite, and exercising the extension/CLI with real inputs, not static reading alone. |
| Q9 | Ranking | Findings ranked by user impact first, then likelihood. Not by fix effort or file order. |
| Q10 | Security scope | In scope despite personal use: destructive operations, command injection, and secret/token handling can still harm the owner's files, shell, and credentials. |
| Q11 | Compatibility | Judged against the omp version installed on this machine. Portability/cross-version behavior may be noted but is not scored. |
| Q12 | Verdict set | Keep / Fix-first / Rewrite / Delete. Rewrite is reserved for design-level failure that blocks trust, not ordinary bugs. |
| Q13 | Depth | Risk-based exhaustive: every entry point and dangerous path inspected; lower-risk utility code may be sampled, with any gaps named explicitly. |
| Q14 | Missing tests | If core paths have no tests, the verdict is capped at Fix-first, even if manual runs pass. |
| Q15 | Report location | This file, `apps/omp-extension/EVALUATION.md`. |
| Q16 | Live-state safety | Reversible-only live runs. Builds, tests, read-only probes, dry-runs (e.g. `/gemini-heal --dry-run`), and effects confined to temp dirs or a sandboxed `PI_CODING_AGENT_DIR` are allowed. Anything mutating live routing, live state files, or global prompt files must be dry-run, run against a backup with restore verified afterward, or reported as not exercised. |
| Q17 | Core vs peripheral | Must-pass (session-protection core): route probing, heal/circuit-breaker, streak auto-restore, stall-triggered auto-heal, the `gemini_health` tool, and the Gemini wire normalizer. Peripheral (failure is a finding, not by itself a failed verdict): TUI widget, `/template`, DeepSeek telemetry, reliability history, OS notifications, warm-up/check, standalone CLI. Dangerous peripherals are still must-inspect per Q13. |
| Q18 | Prompt for evaluation | Cold audit. No specific incident or suspicion; no area is presumed guilty, and the agenda is set by code, tests, and exercised behavior. |
| Q19 | Keep vs Fix-first | Keep requires no High findings anywhere (core or dangerous peripheral) and no broken core behavior when exercised. Medium/low findings may coexist with Keep as a fix list. Any High, or any exercised core failure, makes it Fix-first. |
| Q20 | Q14 cap scope | The untested `src/index.ts` wiring and missing live-host e2e cap the verdict at Fix-first **unless** Q8 exercises (within Q16) actually load the extension in a real omp context and drive the core registrations. Even then, "add a wiring smoke test" remains a fix-list item. Untested `src/cli.ts` (peripheral, Q17) and `src/config.ts` (constants) do not by themselves trigger the cap. |
| Q21 | Severity definitions | Harm-based. **High**: realistic path to wrong routing (healthy excluded / hung kept / restore lost), silent alteration or loss of data or requests, secret/token exposure, or host/session breakage — core or dangerous peripheral. **Medium**: wrong or misleading behavior the owner would notice and can work around, or a defect needing unusual conditions. **Low**: cosmetic, documentation drift, maintainability smells with no current wrong behavior. Severity is not downgraded for rarity alone and is not capped outside the core. |
| Q22 | Necessity test | Included. The evaluation must test whether the underlying Antigravity/Gemini hang problem is still real (owner experience plus inspectable history/state evidence within Q16). If the problem appears dead, Delete is a live verdict even for clean code. |
| Q23 | Owner experience | Hangs still happen and the extension visibly rescues the owner (heal/exclusion/restore perceived as effective in recent use). Necessity is established from the owner side; the evaluation must still corroborate or flag disagreement with inspectable history/state. Delete would need extraordinary justification. |
| Q24 | Installed-bundle drift | In scope. The evaluation must verify that the installed bundle (`~/.omp/agent/extensions/gemini-health.js`) matches a fresh build from current source, within the Q16 reversible-only boundary; the source alone is not assumed to be what runs. |
| Q25 | Effort budget | No cap: do it properly per Q13. If a blocker (e.g. shell/sandbox) prevents required evidence, stop and report it rather than issuing an unsupported verdict. |

## Scope contract (accepted by the owner; document still Draft)

The owner explicitly accepted Q1–Q25 and this scope contract, with the
instruction to stop here. The evaluation itself has not been run and no
remediation is approved; both require a separate explicit request.

### Artifact-level boundary

- In scope: the deliverable is this evaluation report. Evidence is gathered
  from `apps/omp-extension/` code and tests, its use of `@omp-toolkit/core`
  only at the boundary it depends on, its contract with the installed omp
  host (APIs, `auth.accountPolicies` config, lifecycle hooks, CLI), the
  Q16 reversible-only live exercises, the Q17 must-pass core, the Q22/Q23
  necessity corroboration from inspectable history/state, and the Q24
  installed-bundle drift check.
- Out of scope: fixing code, adding tests, changing runtime behavior, a full
  audit of omp, and audits of other omp-toolkit apps/packages.
- Execution words ("go", "do it all") do not widen this boundary. Wider work
  needs the owner's explicit approval of a wider boundary, or a follow-up
  request with its own interview.

### Done means

- [x] Decision tree exhausted and this scope contract explicitly accepted.
- [x] Fact-finding brief on layout, surface, tests, and gaps completed.
- [ ] Every entry point and risky path inspected or the gap named (Q13).
- [ ] Builds, tests, real exercises (Q8/Q16/Q20), necessity evidence
  (Q22/Q23), and bundle-drift check (Q24) run, with results quoted — or a
  blocker reported per Q25 instead of an unsupported verdict.
- [ ] Findings ranked per Q9, severities per Q21, evidence per Q4; verdict
  per Q12 subject to Q5, Q14/Q20, and Q19.
- [ ] This document accepted by the user and marked Final. (The interview
  contract below may be accepted while the document is still Draft; only
  explicit acceptance of the finished report makes it Final.)

### Staged work

- Any remediation (fixes, tests, rewrite, deletion) is a deferred proposal.
  Accepting this record does not approve it; it returns as its own request.

## Risks and constraints noted so far

- The extension mutates live omp routing policy, probes with OAuth tokens,
  writes state under `~/.omp/agent`, and can replace global `AGENTS.md` /
  `RULES.md` via `/template`. Exercise must avoid silent damage to live state.
- Personal-tool standard (Q7) coexists with the fatal-flaw rule (Q5): harm is
  judged as harm to the owner and their machine/sessions.

## Unresolved questions

None from the interview. The evaluation itself (inspection, exercises,
findings, verdict) is pending a separate explicit request.

## Fact-finding notes (explorer brief, pre-evaluation)

These are inventory facts to shape the evaluation design, not findings or a
verdict. Shell/`git status` was unavailable during exploration (Windows
sandbox ACL timeout), so working-tree state and test-run results are
unverified.

- Tests: 15 test files, 132 cases, 4,561 source LOC (3,532 test LOC), colocated
  `src/*.test.ts` (`bun:test`, mocked exec/fetch, temp dirs). Re-verified
  2026-11-03: the extension suite is hermetic — mocked policy store, forced
  toast platform, and path-agnostic gateway resolution — so the Linux, macOS,
  and Windows CI matrix runs without an installed `omp` binary or host-specific
  absolute paths.
- No tests for: `src/index.ts` (extension factory + DeepSeek provider
  registration), `src/cli.ts` (arg parsing / exit codes / `process.exit`),
  `src/config.ts`. No live/e2e test against a real OMP host, the `omp` CLI,
  or the Antigravity endpoint.
- Gates: root `bun run check` (biome + `tsc --noEmit` + `bun test` +
  check-tokens); focused tests via `bun test apps/omp-extension`.

## Findings

_Not yet evaluated — placeholder only, no claims made._
