# Model selection, Gemini prompt sensitivity, and the agent harness

*Research note, 2026-10-22. Primary sources: Artificial Analysis (AA) model
pages and methodology, Google/Gemini docs, Meta/Muse docs, OMP docs/source, and
planning/agent research. Community reports are labeled. `[INFERENCE]` marks
judgment.*

## Short answers

1. **Choose by phase-specific evidence, not by the composite score alone.**
   Planning candidates should be scored on plan feasibility, decision
   completeness, dependency discovery, grounding, and cost per accepted plan.
   Execution candidates should be scored on tool validity, instruction
   adherence, code/test correctness, recovery, pass^k, and cost per success.
   Use AA/PlanBench/SWE-bench/τ-bench only as screening evidence, then run a
   2×2 plan/execute evaluation on your own tasks.
2. **Gemini 3.8 Flash is not generally "bad at planning," but the user's
   experience is plausible and partly reproducible.** A Google developer report
   shows a concrete 3.8 regression: reflective first-person context suppresses
   self-initiated tool calls (0/8 vs 8/8 on 3.5), and explicit guidance only
   partially recovers it. OMP also has documented Gemini/agent integration
   failure modes: strict function-call/history validation, and a subagent
   finalization bug where the request ends with a model turn. These are
   harness/context effects, not proof that Gemini needs more explicit prompts
   for every task. Meta's Muse Spark/Wonder docs explicitly claim better
   handling of messy/conflicting input and asking for clarification, which
   matches the user's perception, but those are vendor claims.
3. **Improve the harness in this order:** normalize provider/tool-call
   histories; keep a minimal, non-conflicting prompt overlay; make plans and
   acceptance criteria first-class artifacts; add external verification;
   isolate/ compress context; measure phase-level failures and cost per
   success. Do not try to prompt-engineer a model into a different capability
   profile.
4. **The system prompt layout affects the harness, but AGENTS.md is not the
   system prompt.** OMP loads `~/.omp/agent/AGENTS.md` into the trailing
   `<repo-rules>` project-context block; it does not replace the static default
   instruction block. `SYSTEM.md` replaces the default instruction block;
   `APPEND_SYSTEM.md` appends. The user's 8-point charter is a global,
   project-specific overlay with several conflicts with OMP defaults and with
   non-frontend repositories. Keep OMP's default prompt; move project rules to
   project `.omp/AGENTS.md`; keep only cross-project invariants globally.
5. **Use the default system prompt plus a minimal global AGENTS.md; do not
   replace the default prompt.** A custom global file is justified for genuine
   cross-project invariants (safety, scope, verification, git authorization),
   not for frontend/design/TDD rules that apply only to some repositories.

## 1. A phase-specific model-selection strategy

### Evaluation criteria

| Phase | Primary criteria | Useful evidence | Failure modes to measure |
|---|---|---|---|
| Planning | Plan feasibility, decision completeness, constraint/dependency discovery, grounding, context synthesis, risk identification | PlanBench/o1 results; AA agentic/coding/long-context sub-scores; repository-specific plan eval | Missing constraints, infeasible order, vague steps, hallucinated files/APIs, executor must invent decisions |
| Execution | Tool schema validity, instruction/policy adherence, code correctness, test pass, error recovery, latency/cost | Terminal-Bench, SWE-bench, τ-bench, AA coding/agentic; repository tests | Wrong tool/API, syntax/edit errors, ignored plan, loop, policy drift, silent wrong patch |
| Verification | Error detection, false-positive rate, ability to use tests/compiler/runtime | Sound external verifier, tests, smoke runs | Passes weak tests; self-critique false negatives |

A practical funnel:

1. **Hard filters:** provider availability, context/output limits, modalities,
   tool support, thinking levels, quota, latency.
2. **Screening:** AA `int` and relevant sub-scores; plan/agent benchmarks;
   model version/effort. Treat differences under ~4 composite points as a
   prior, not a verdict. `[INFERENCE]`
3. **Task eval:** 10–20 real tasks; plan-only runs; execution runs; 2×2 matrix
   (strong/strong, strong/weak, weak/strong, weak/weak). Measure plan acceptance,
   planning error attribution, test pass, tool errors, replans, cost per
   success, wall-clock, and pass^k.
4. **Per-provider shortlist:** rank within the provider; present evidence and
   missing data; let the user assign `modelRoles`.

### Composite comparison (AA v4.3.2)

| Model | AA `int` | Cost/task | Speed | Context | Note |
|---|---:|---:|---:|---:|---|
| Muse Wonder Full (Max) | **56** [A5] | N/A | N/A | 1M | Highest; price/speed not public on AA |
| Muse Wonder (Max) | **52** [A4] | $4.52 | 142 tok/s | 1M | Strong but expensive |
| Muse Spark 1.3 (Max) | **48** [A3] | $1.60 | 98 tok/s | 1M | Deprecated; newer Muse Wonder exists |
| DeepSeek V4.1 Flash 1017 (Max) | **45** [A1] | $0.26 | 203 tok/s | 1M | Cheapest/fastest in this set |
| Gemini 3.8 Flash (High) | **41** [A2] | $1.24 | 137 tok/s | 1M | Multimodal; strong agentic/coding |

This table is a screening prior, not a plan-quality ranking. AA's index weights
Agents 30%, Coding 20%, Scientific Reasoning 20%, General 30%; it has no
PlanBench-style planning component [A6]. The same score can come from
different capability profiles.

## 2. Gemini 3.8 Flash: is the user's experience supported?

### What the primary docs say

- Gemini 3.8 Flash is positioned for "long-horizon coding and autonomous
  agents"; Google says it "works harder," executing extra reasoning steps and
  calling tools iteratively, and may use more tokens at higher effort [G3].
  The model card lists software engineering, agentic tasks, and complex
  knowledge work as intended uses; it does not claim the model needs unusually
  explicit prompts [G1].
- Google's own demos include a game and a DOS-style Maps app built from a
  "simple prompt" in Antigravity [G3]. That contradicts a blanket "Gemini needs
  detailed prompts" claim; the effect is task- and harness-specific.
- Google's prompt guide says clear, specific instructions and few-shot examples
  generally help, and that different phrasing can change results [G5]. That is
  not Gemini-specific; all models benefit from clear intent.
- Google Cloud's 3.8 developer guide imposes strict function-calling rules:
  `FunctionResponse` must match the preceding call; history must not end with a
  model turn; prefilled model turns are unsupported; pre-tool commentary should
  be cleaned or moved into an `update()` tool call [G2]. These are harness
  requirements, not evidence of low intelligence.

### Concrete community evidence

A Google AI Developers Forum report (2026-09-05) shows a reproducible
Gemini 3.8 Flash regression:

- With a short prompt and short system instruction, 3.8 Flash calls a
  `save_note` tool 8/8; 3.5 Flash also 8/8.
- Adding a long reflective, first-person passage to the user context drops 3.8
  to **0/8**, while 3.5 stays 8/8.
- A longer system instruction that explicitly encourages saving only recovers
  3.8 to **3/8**; increasing thinking level does not fix it.
- Removing the model's own prior reasoning from the conversation restores
  behavior (0/8 → 6/8); the report argues the model is imitating a
  "keep it to myself" pattern in its history [G4].

This is a specific context/tool-call regression, not a general "needs explicit
directions" result. It does, however, explain why an agentic run can feel like
the model is ignoring intent: the model returns valid reasoning but does not
call the tool. Label: community reproduction, not an official Google
acknowledgment.

### OMP-specific Gemini failure modes

- OMP issue #11267: early Gemini 3.8 Antigravity/Gemini-CLI builds exposed raw
  `-low`/`-medium`/`-high`/`-tiered` variants instead of one canonical model;
  fixed by the revision-templated variant collapse (shipped by v18.2.1)
  [O5]. This is catalog/version behavior, not prompt sensitivity.
- OMP discussion #14790: Gemini 3.8 Flash High worked as the root model but
  failed in `@task` subagents after ~10 minutes with "Requests ending with a
  model turn are not supported." The author isolated it to OMP's task
  finalization: the child returned a final text answer, OMP injected a
  `developer` reminder for another model turn, the Responses converter dropped
  that reminder, and the request ended with an assistant/model turn. Workaround:
  have the task agent finish via `yield` with its report; root cause is
  harness/serialization, not model reasoning [O6]. Reported on OMP 18.8.0;
  verify on the current 18.12.6 before relying on the workaround.
- The Google Cloud guide's strict history/function-call rules match this class
  of failure: a provider adapter must never send a model-final turn or an
  unmatched function response [G2].

### Does the user's comparison to Muse/DeepSeek hold?

- Meta's Muse Spark 1.3 page says it is "trained for agentic workflows," with
  "higher first-attempt accuracy and reliable tool calling," and that it
  "tracks context and prior results, works through messy or conflicting inputs,
  and asks for input when needed" [M1]. This is a vendor claim that directly
  matches the user's perception (more context tracking, clarification), but it
  is not an independent head-to-head.
- Meta's Muse Wonder blog emphasizes Active Memory (carrying context across
  conversations) and Active Focus (sustaining multi-step work, trying
  alternatives, asking for clarification) [M2]. Again vendor framing.
- AA scores put Muse Spark 1.3 at 48, Muse Wonder at 52, Muse Wonder Full at 56,
  versus Gemini 41 and DeepSeek 45 [A1]–[A5]. Higher composite scores are
  consistent with the user's experience, but AA does not measure clarifying
  behavior or prompt sensitivity.
- No primary source found showing DeepSeek V4.1 Flash is systematically better
  at inferring vague intent than Gemini 3.8. DeepSeek's AA 45 and low cost are
  evidence of capability/economics, not of clarification behavior.

**Verdict:** the user's experience is plausible and has at least one concrete
Gemini-specific failure mode, but the general claim "Gemini needs more explicit
prompts than smarter models" is not established. The effect may be a mix of
Gemini's autonomous "work harder" policy, literal context/tool-call behavior,
OMP's provider adapter, and task selection. Measure it with the same harness and
prompts before attributing it to model intelligence. `[INFERENCE]`

### Practical mitigation

For Gemini as executor:

- Put acceptance criteria, stop conditions, and "ask before irreversible action"
  in the system/project context; keep them short and at the end of the relevant
  context.
- Normalize history and tool responses per Google's rules; never end a request
  with a model turn; use matching `FunctionResponse` IDs; avoid prefilled model
  turns [G2].
- For self-initiated tool calls, test with and without reflective/first-person
  history; if the regression reproduces, do not rely on self-initiated tools
  [G4].
- If the task needs clarification, explicitly authorize one question when a
  material ambiguity remains; otherwise the model may guess. Test clarification
  rate, not just final answer.
- If the harness fix does not close the gap, use DeepSeek/Muse for that phase;
  do not keep adding prompt text to compensate for a provider bug.

## 3. How to improve the agent harness

The harness is the model plus system prompt, tools/ACI, context, loop/planning,
verification, approvals, subagents, and evals. High-leverage improvements:

1. **Provider/tool normalization first.** Enforce valid message/tool sequences
   for each provider; never send model-final turns, unmatched tool results, or
   dropped developer reminders. This is the difference between "Gemini is bad"
   and "the adapter emitted an invalid request" [G2][O6].
2. **Keep the prompt architecture layered.**
   - OMP default system prompt: generic role, tool policy, exploration,
     delegation, verification, delivery.
   - Global `AGENTS.md`: only cross-project invariants.
   - Project `.omp/AGENTS.md`: architecture, commands, conventions.
   - `RULES.md`: a few hard always-apply constraints.
   - `SYSTEM.md`/`APPEND_SYSTEM.md`: only when you deliberately replace/append
     the default instruction block [O1][O2].
3. **Make plans executable artifacts.** Require exact targets, dependencies,
   acceptance criteria, verification commands, and assumptions; a fresh
   executor should need zero design decisions. This is also what makes plan
   handoffs safe.
4. **Verify with external signals.** Tests, compiler, runtime, smoke runs, and
   independent reviewers beat model self-critique; self-verification can
   collapse on planning tasks [R6].
5. **Manage context deliberately.** Use project context files for durable
   conventions, compaction for long sessions, and subagent artifacts/references
   instead of copying full transcripts. Avoid sending a long reflective log
   into a provider that is sensitive to it [G4][R9].
6. **Route by phase, not by fashion.** Use separate `plan`/`default` roles only
   when measured; `prewalk` only for front-loaded reasoning; an `advisor` for
   verification, not as a planner substitute [O4].
7. **Measure phase-level outcomes.** Plan acceptance, planning-error rate,
   execution test pass, tool-call validity, clarification rate, pass^k, cost
   per success, and wall-clock. Do not optimize a composite score.

### OMP-specific harness notes

- `AGENTS.md` is injected as `<repo-rules>` in the trailing
  `<project-context>` block, after the static system prompt; it is not the
  static system prompt [O1].
- Task subagents **do not inherit** `AGENTS.md` (they do inherit
  `CLAUDE.md`/`GEMINI.md` per OMP's table); if a rule must bind subagents, put it
  in the agent definition or verify a propagation mechanism [O2].
- The OMP default prompt already has strong exploration, delegation,
  verification, and delivery rules [O3]. A global AGENTS.md that restates or
  contradicts them adds tokens and ambiguity.
- `RULES.md` is always-apply and stays in the system prompt; keep it short
  [O1].
- `SYSTEM.md` replaces the default instruction block; `APPEND_SYSTEM.md` adds
  text while keeping the default. Use the latter for a few global additions;
  avoid the former unless you can maintain the whole prompt [O2].

## 4. Auditing the user's `~/.omp/agent/AGENTS.md`

### Observed file

Path: `C:\Users\toanh\.omp\agent\AGENTS.md`. The file is 1,851 bytes, 14 lines,
460 o200k tokens / 472 DeepSeek tokens / 537 Claude-v3 tokens by OMP's local
tokenizer [O7]. It is an 8-point global charter:

1. Clean Architecture / public entrypoints.
2. Consistent Coding Style / 5-Part Stepdown Layout / named exports / early
   returns / 3-tier imports.
3. Prettier or Biome after edits.
4. Multiple atomic commits.
5. Conventional annotated Git tags.
6. 3-tier design tokens / OKLCH / APCA / zero raw hex or px.
7. Tight TDD / <5s failing Red test before production edits.
8. Markdown SSOT / HTML for visual inspection / native ask for human decisions.

### What is good

- Safety/quality intent: verification, clean architecture, scoped imports,
  design-token discipline, human decisions.
- Commit/tag conventions are useful *when the user asks for a commit/tag*.
- Explicit verification is aligned with OMP's default harness [O3].

### What conflicts or overreaches

1. **Project-specific rules are global.** Clean Architecture, 5-Part Stepdown,
   3-tier imports, design tokens/APCA, and dual-surface Markdown/HTML are
   frontend/monorepo conventions, not universal. In a backend, script, or
   research repo, they can force irrelevant structure or conflict with local
   conventions.
2. **TDD conflicts with OMP's default test policy.** OMP says new tests only for
   uncertain edges or user request; the charter requires a failing Red test
   before production edits [O3]. For docs/config/infra, a <5s failing test may
   be impossible. Rewrite as "for behavior changes with a test seam, reproduce
   first; otherwise use the narrowest deterministic check."
3. **Formatter rule conflicts with the "no mid-flight tools" policy.** OMP
   says skip build/lint/tests/formatters mid-flight and run once afterward;
   the charter says install/run Prettier or Biome after edits [O3]. Make it
   "use the repository's formatter once after the change; do not install
   tooling."
4. **Commit/tag rules are standing state-changing instructions.** A global
   "multiple atomic commits" and "create annotated tags" can be read as
   authorization to modify git history/tags without a request. Scope both to
   "when the user asks to commit/tag."
5. **Named "gates" are not gates.** "Module Boundaries", "Coding Principles
   Gate", "Anti-Slop Critique Gate", etc. are labels, not commands. They create
   false assurance. Replace with actual CI/hook commands or remove the column.
6. **Undefined terms invite invention.** "5-Part Stepdown Layout" is not
   defined; a model may guess. Define it or move it to the project file.
7. **All rules are equal "MUST".** There is no priority; formatting/commit
   rules compete with correctness. Separate safety invariants from preferences.
8. **Subagent gap.** OMP task subagents do not inherit `AGENTS.md` [O2], so the
   charter does not govern delegated work; do not assume it does. OMP also
   tells subagents not to run verification unless assigned [O3], so a global
   "TDD/verify before yielding" rule conflicts with the subagent contract if it
   does reach them.
9. **Non-existent tool aliases.** "ask / AskUserQuestion / question" mixes
   harnesses. OMP's interactive tool is `ask`; do not name unmounted tools
   (`AskUserQuestion`, `question`) in a global file.

### Recommended split

**Global `~/.omp/agent/AGENTS.md` (cross-project invariants):**

```markdown
# Global Agent Rules

Cross-project defaults. Project `.omp/AGENTS.md` overrides them.

## Safety and Git
- Never commit, push, tag, install dependencies, or rewrite history unless the
  user explicitly asks.
- Ask before destructive or irreversible actions; never delete unrelated code.
- When asked to commit: atomic conventional commits (`type(scope): subject`,
  <=72 chars, imperative). Tag only when asked.

## Work
- Read the project's instructions and follow its existing patterns; never add a
  second convention.
- Keep changes scoped; no unrelated refactors.
- For bugs, reproduce first. For behavior changes, run the narrowest relevant
  check. For UI, exercise the actual surface and report anything unverified.
- Use the repository's formatter/linter/test commands; do not install tooling
  unless asked.
- Ask only when a material decision cannot be resolved from the repo; otherwise
  choose the conservative option and state it.
```

**Project `.omp/AGENTS.md` (move only what applies):**

```markdown
# Project Rules

## Architecture
- <package boundaries / public entrypoints>

## Style
- <layout / exports / import order / formatter command>

## Design
- <tokens / OKLCH / APCA / raw-literal policy; only for UI projects>

## Verification
- <test command / TDD policy / smoke command / known slow checks>
```

Keep `RULES.md` for 1–3 hard constraints only (e.g. "never commit unless
asked"). Use hooks/CI for formatters, tests, and tag/commit validation. Do not
replace OMP's default `SYSTEM.md` unless you are prepared to maintain the full
tool/workflow prompt [O2].

### Does the system prompt affect the harness?

Yes, but not in the way "smarter model" does:

- The static system prompt shapes role, tool policy, exploration, delegation,
  verification, and delivery; it can change behavior without changing model
  weights [O3].
- `AGENTS.md` is a project-context overlay; it can add constraints but is not
  the static prompt and does not reach task subagents [O1][O2].
- Overlong or conflicting instructions can dilute attention and cause
  over-constraint, especially for literal models; Gemini 3.8's context/tool
  behavior is an example of context sensitivity [G4].
- The default prompt is already comprehensive. A minimal global overlay plus
  project-specific files is the safer default. Test any custom prompt with an
  A/B: same model, same tasks, same harness; vary only the prompt file; measure
  plan acceptance, rework, test pass, clarification rate, and cost.

### A/B protocol

Use three variants: **A** current 8-point charter, **B** the proposed lean
global file, **C** OMP defaults with an empty user `AGENTS.md`. Use 15 tasks:
5 bug fixes, 5 feature/refactor tasks, 5 non-frontend/docs tasks. Keep the
model, effort level, tools, and task prompts identical; run multiple seeds.
Measure pass rate, unsolicited git/install mutations (target zero), plan
acceptance/rework, clarification count, tokens, and wall-clock. Compare A/B/C
per task class; do not change model and prompt in the same experiment.

## 5. Practical recommendation

- Keep OMP's default system prompt. Do not create `SYSTEM.md` unless you have a
  specific reason to replace it.
- Replace the current global 8-point charter with the short global file above;
  move frontend/monorepo rules to project `.omp/AGENTS.md`; put 1–3 hard
  constraints in `RULES.md`; enforce formatters/tests/commits in hooks/CI.
- Use a phase-specific model matrix, not a single composite: plan with
  DeepSeek/Muse if plan quality is the bottleneck; execute with DeepSeek for
  cost/speed or Gemini for multimodal/Google quota; validate with a 2×2 eval.
- Treat Gemini's "needs clear directions" as a testable hypothesis: fix provider
  history/tool normalization first; then test explicit acceptance criteria,
  clarification policy, and context ordering.
- If Gemini still underperforms in agentic loops, use it for tasks that match
  its strengths (multimodal, long-horizon coding with a clean harness) and use
  DeepSeek/Muse for ambiguous planning; do not add prompt text indefinitely.

## Sources

- [A1] Artificial Analysis, DeepSeek V4.1 Flash 1017 (Max).
  https://artificialanalysis.ai/models/deepseek-v4-1-flash-1017
- [A2] Artificial Analysis, Gemini 3.8 Flash (High).
  https://artificialanalysis.ai/models/gemini-3-8-flash
- [A3] Artificial Analysis, Muse Spark 1.3 (Max).
  https://artificialanalysis.ai/models/muse-spark-1-3
- [A4] Artificial Analysis, Muse Wonder (Max).
  https://artificialanalysis.ai/models/muse-wonder
- [A5] Artificial Analysis, Muse Wonder Full (Max).
  https://artificialanalysis.ai/models/muse-wonder-full
- [A6] Artificial Analysis, Intelligence Benchmarking Methodology v4.3.2.
  https://artificialanalysis.ai/methodology/intelligence-benchmarking
- [G1] Google DeepMind, Gemini 3.8 Flash Model Card, 2026-09-02.
  https://deepmind.google/models/model-cards/gemini-3-8-flash/
- [G2] Google Cloud, Developer's guide to Gemini 3.8 Flash (updated
  2026-10-21). https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash
- [G3] Google, "Introducing Gemini 3.8 Flash and 3.8 Flash Cyber," 2026-09-02.
  https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/
- [G4] Google AI Developers Forum, "Gemini 3.8 Flash: tool calls are suppressed
  when the prompt contains reflective first-person text (regression vs 3.5),"
  2026-09-05. https://discuss.ai.google.dev/t/gemini-3-8-flash-tool-calls-are-suppressed-when-the-prompt-contains-reflective-first-person-text-regression-vs-3-5/180934
- [G5] Google, "Prompt design strategies."
  https://ai.google.dev/gemini-api/docs/prompting-strategies
- [M1] Meta, "Muse Spark 1.3."
  https://dev.meta.ai/models/muse-spark
- [M2] Meta AI Research, "Muse Wonder: A Frontier Model For Personal &
  Professional AI Agents," 2026-10-12. https://research.meta.ai/blog/muse-wonder
- [O1] oh-my-pi, `docs/context-files.md`.
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/context-files.md
- [O2] oh-my-pi, `docs/system-prompt-customization.md`.
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/system-prompt-customization.md
- [O3] oh-my-pi, `packages/coding-agent/src/prompts/system/system-prompt.md`.
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/prompts/system/system-prompt.md
- [O4] oh-my-pi, `docs/prewalk.md`.
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/prewalk.md
- [O5] oh-my-pi issue #11267, "fix(catalog): add Gemini 3.8 Flash variant
  collapse family for Antigravity and Gemini CLI."
  https://github.com/can1357/oh-my-pi/issues/11267
- [O6] oh-my-pi discussion #14790, "Gemini 3.8 Flash High consistently fails in
  @task/subagents after ~10 minutes…" (2026-10-07).
  https://github.com/can1357/oh-my-pi/discussions/14790
- [O7] Observed local file, 2026-10-22:
  `C:\Users\toanh\.omp\agent\AGENTS.md`, 1,851 bytes / 14 lines / 460 o200k
  tokens / 472 DeepSeek tokens / 537 Claude-v3 tokens via `omp toks --json`.
- [R1] Valmeekam et al., "PlanBench," arXiv:2206.10498.
  https://arxiv.org/abs/2206.10498
- [R2] Valmeekam, Stechly, Kambhampati, "LLMs Still Can't Plan; Can LRMs?",
  arXiv:2409.13373. https://arxiv.org/abs/2409.13373
- [R3] Erdogan et al., "Plan-and-Act," arXiv:2503.09572.
  https://arxiv.org/abs/2503.09572
- [R4] Xia et al., "Agentless," arXiv:2407.01489.
  https://arxiv.org/abs/2407.01489
- [R5] Yao et al., "τ-bench," arXiv:2406.12045.
  https://arxiv.org/abs/2406.12045
- [R6] Stechly, Valmeekam, Kambhampati, "On the Self-Verification Limitations
  of Large Language Models on Reasoning and Planning Tasks," arXiv:2402.08115.
  https://arxiv.org/abs/2402.08115
- [R7] OpenAI, "A practical guide to building agents."
  https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- [R8] Anthropic, "Building effective AI agents."
  https://www.anthropic.com/engineering/building-effective-agents
- [R9] Anthropic, "How we built our multi-agent research system."
  https://www.anthropic.com/engineering/multi-agent-research-system
