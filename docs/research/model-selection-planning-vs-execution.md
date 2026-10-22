# Selecting planning and execution models

*Research note, 2026-10-22. Sources are Artificial Analysis (AA) model pages and
methodology, the Stencil catalog, OMP source/docs, and planning research. AA's
headline score is a composite; `[INFERENCE]` marks judgment.*

## Short answers

1. **Do not select a planning model from intelligence alone.** A composite
   intelligence score is a useful first filter, not a plan-quality measure.
   Screen with it, then evaluate plan completeness, dependency discovery,
   grounding, and plan-following on your own tasks.
2. **DeepSeek V4.1 Flash 1017 (Max) for planning + Gemini 3.8 Flash (High) for
   execution is a reasonable hypothesis, not a proven strategy.** The AA gap is
   45 vs 41, but it is a composite, not a planning score; the two variants use
   different effort labels, and DeepSeek is also cheaper/faster. Test it against
   DeepSeek-for-both and Gemini-for-both before committing.
3. **Per-provider recommendations need a provider-scoped shortlist plus
   evidence, not one global ranking.** Filter by availability/context/tools,
   use `int` only as a prior, then run a 2×2 plan/execute evaluation. Present
   the user with 2–3 candidates per role, their evidence, missing data, and
   cost; the user assigns `modelRoles`.
4. **`prewalk` is conditionally good, not a default.** It fits tasks where the
   hard reasoning is front-loaded and the remaining implementation is bounded.
   OMP's auto-prewalk is deliberately conservative (0.70 confidence, fails
   open); it is a poor fit for unresolved races/invariants or tasks that need
   strong reasoning throughout.
5. **The AA numbers are disclosed, but they are not a clean planning
   comparison.** DeepSeek's 45 is specifically V4.1 Flash **1017 (Max)**; the
   earlier V4.1 Flash (Max) is 39. Gemini's 41 is 3.8 Flash **High**. The
   composite index has no PlanBench-style planning component, the rankings use
   different comparison sets, and OMP's catalog `int` can be rounded, missing,
   or stale. No hidden score; several non-obvious version/effort/index factors.

## 1. How to analyze a planning candidate

### What "intelligence" gets you

AA Intelligence Index v4.3.2 is a weighted composite of 10 evaluations:
Agents 30%, Coding 20%, Scientific Reasoning 20%, General 30%; primarily
text/English, zero-shot, pass@1 [A4]. It is a broad capability prior, not a
planner benchmark. It can tell you whether a model is in the right capability
class; it cannot tell you whether it will produce a feasible, grounded,
decision-complete plan for your repository.

The research evidence is mixed in a specific way:

- Reasoning capability helps short/medium plan generation, but collapses with
  plan length/representation: o1-preview is 97.8% on 3–5-block Blocksworld but
  23.63% on 20–40-step problems and 52.8% on obfuscated Blocksworld [R2].
- A trained planner can lift a base executor from 9.85% to 29.63%, but a
  zero-shot planner can hurt a trained executor (23.63% vs 36.97% with no
  planner) [R3]. Plan quality/fit matters more than the planner's headline
  score.
- Composite intelligence is not a substitute for task-specific evaluation;
  Agentless beats complex agents on SWE-bench Lite with a fixed pipeline [R4],
  and self-critique without a sound verifier can degrade plans [R6].

### A three-stage funnel

1. **Hard filters (must pass):**
   - authenticated/available provider; model enabled in OMP;
   - context window and max output enough for the plan artifact;
   - tool support and input modalities required by the task;
   - thinking levels the provider actually honors;
   - cost/quota/latency constraints.
2. **Capability screen (rank, do not decide):**
   - AA headline `int` if present; AA agentic/coding/long-context sub-scores
     when available;
   - plan-relevant evidence: PlanBench/o1-style results, agentic benchmarks,
     instruction following, tool use;
   - model checkpoint/version and effort label; do not compare `Max` vs `High`
     as if they were the same budget.
3. **Task-specific evaluation (decide):**
   - 10–20 representative tasks from your actual work (architecture, bug
     diagnosis, migration, review).
   - Plan-only run for each candidate: score plan feasibility, missing
     constraints, dependency/order, file targeting, verification steps,
     assumptions, and decision-completeness.
   - Execution run with each candidate pair: tests, tool errors, replans,
     first-pass yield, rework, cost per success, wall-clock.
   - 2×2 matrix: strong/strong, strong/weak, weak/strong, weak/weak.

A model that writes an elegant plan but leaves design decisions to the executor
is not a good planner. A model that writes a plain but decision-complete plan
is. Measure the plan's *executability*, not its prose.

## 2. DeepSeek plan + Gemini execution: is it a good strategy?

### The AA facts

| Item | DeepSeek V4.1 Flash 1017 (Max) | Gemini 3.8 Flash (High) |
|---|---|---|
| AA Intelligence Index | **45** [A1] | **41** [A3] |
| Earlier/base version | V4.1 Flash (Max) = **39**, deprecated [A2] | — |
| OMP catalog `int` | **missing** in observed `models.db`; CLI name says 1017 [O6] | **40.9**, rounded to 41 [O6] |
| Released | Oct 2026 [A1] | Sep 2026 [A3] |
| Rank shown | #2 / 121 (open-weights class) [A1] | #51 / 214 (its class) [A3] |
| Cost per AA task | **$0.26** [A1] | **$1.24** [A3] |
| Output tokens on AA | 210M (very verbose) [A1] | 170M (very verbose) [A3] |
| Speed | 203.4 output tok/s [A1] | 136.6 output tok/s [A3] |
| Context / output cap | 1M / 384K (OMP provider) [O6] | 1M / 64K (OMP provider) [O6] |
| Input | text, image [A1] | text, image, speech, video [A3] |

The 4-point headline gap is real on the same index version, but it is not a
planning effect size. AA's index includes agentic, coding, scientific, and
general evaluations; it does not include PlanBench or a dedicated plan-quality
benchmark [A4]. DeepSeek's gain may come from agentic/knowledge tasks that are
relevant to planning, but that is an inference, not a measured plan score.
`[INFERENCE]`

### Verdict

**Reasonable hypothesis, not yet a good strategy.** The split is supported if:

- planning is the binding constraint (ambiguous scope, architecture,
  cross-file changes, unfamiliar codebase);
- the plan is grounded and decision-complete;
- execution is bounded and can be verified by tests/tools;
- Gemini's multimodal input, provider quota, or tool surface is a real reason
  to use it for execution.

It is **not** supported by the 45-vs-41 number alone. Gemini's 41 is lower than
DeepSeek's 45 on the same composite, and Gemini is ~4.8× more expensive per AA
task ($1.24 vs $0.26) and slower (137 vs 203 tok/s) [A1][A3]. For tool-heavy,
many-turn execution, those are material. DeepSeek may be the better executor as
well; test it.

The strongest alternative is **DeepSeek for both phases**, with Gemini reserved
for tasks that need its multimodal input or Google/Antigravity quota. The
reverse (Gemini plan + DeepSeek execute) is also testable, but Gemini's lower
composite and higher cost make it a weaker default planner.

### 2×2 evaluation

| Pair | Planner | Executor | What it tests |
|---|---|---|---|
| A | DeepSeek 1017 Max | DeepSeek 1017 Max | One-model baseline; no handoff |
| B | DeepSeek 1017 Max | Gemini 3.8 High | Proposed split |
| C | Gemini 3.8 High | DeepSeek 1017 Max | Reverse split |
| D | Gemini 3.8 High | Gemini 3.8 High | Gemini-only baseline |

Measure: plan acceptance, missing constraints, plan adherence, test pass,
tool-call errors, replans, cost per success, wall-clock. Keep B only if it beats
A on cost per success at equal or better reliability. A 4-point composite gap
does not guarantee that.

## 3. Per-provider recommendation for the user

### Data sources

- `~/.omp/agent/models.db` table `model_cache`: one row per provider; the
  `models` column is a JSON array with `id`, `name`, `int`, `thinking`,
  `contextWindow`, `maxTokens`, `cost`, `input`, `reasoning`, `identity` [O6].
- `omp models --json` lists provider/id/name/thinking/context/cost, but **does
  not include `int`** in the observed OMP version [O6]. A recommender must read
  `models.db` or the upstream catalog; do not pretend `int` is zero.
- Stencil `https://catalog.stencil.so/models.json` carries `int`/`tps` for many
  provider/model rows; it exposed 39.5 for V4.1 Flash, 45.1 for 1017, and 40.9
  for Gemini 3.8 Flash [A5]. It is a catalog, not a planning evaluation.
- OMP `modelRoles` is global/project, not per provider. Build provider-scoped
  shortlists, then assign the selected selectors to `modelRoles.plan` and
  `modelRoles.default` [O1][O3].

### Recommendation algorithm

1. **Filter the provider:** only models that resolve with credentials, are
   enabled, and have the required context/modalities/tools.
2. **Extract evidence:** `int` (if present), thinking levels, context, max
   output, cost, speed, input modalities, checkpoint/version.
3. **Score separately for plan and execution:**
   - plan: reasoning/agentic evidence, plan-quality eval, context, instruction
     following; cost is secondary because plan calls are few;
   - execution: tool/code evidence, instruction following, context, recovery,
     latency, cost per success; cost dominates because execution calls are many.
4. **Do not compare across effort labels or versions.** `Max` vs `High` and
   `1017` vs base are different configurations; normalize or mark the mismatch.
5. **Run a small task eval** (section 1). If no eval exists, label the
   recommendation "prior only" and show the uncertainty.
6. **Present 2–3 candidates per role** with: selector, AA `int` or "missing",
   version/effort, context/tools, cost/speed, eval result, main risk. Let the
   user choose; do not silently set roles.

### Example shortlist (observed 2026-10-22)

| Provider | Plan candidate | Execution candidate | Notes |
|---|---|---|---|
| `deepseek` | `deepseek/deepseek-flash:max` — AA 45 for 1017 Max; OMP `int` missing | Same model `:max` or `:high` | Cheapest/fastest; verify the 1017 checkpoint; no OMP `int` |
| `google-antigravity` | `google-antigravity/gemini-3.8-flash:high` — AA 41; OMP `int` 40.9 | Same model `:high` | 1M context, multimodal input; $1.24/task, 137 tok/s; high effort is the top OMP level |
| Cross-provider | DeepSeek plan + Gemini exec | — | Test against DeepSeek/DeepSeek; do not assume 45 > 41 means better plan |

Do not infer that `deepseek-v4-pro` or `deepseek-v4-flash` are better/worse
planners from `int` alone; their OMP `int` values (36 and 34.3) are composite
priors, not plan scores.

## 4. Is `prewalk` a good strategy?

**Conditionally yes; not as a default.** OMP's `prewalk` is a one-shot handoff
from the active model to a faster/cheaper target after planning reaches
implementation. It injects a planning nudge; when `todo` is active, a successful
`todo` call opens the gate; it switches at the completed assistant turn
containing the first eligible `edit`/`write`, then disarms. The default target is
`@smol`; it changes the active model/thinking level without rewriting role
assignments [O2].

Auto-prewalk's native judge classifies a task by **where the expensive reasoning
belongs**: `prewalk` (hard thinking first, implementation bounded), `primary`
(strong reasoning still needed during implementation), or `direct` (no up-front
phase). It is explicitly not a difficulty rating or general router; it arms only
when `prewalk` wins with probability ≥ 0.70 and fails open. “A wrong handoff
costs more than a missed one,” so ties favor `primary` and small tasks favor
`direct` [O2].

Why this matches the research:

- Strong planner + cheaper executor helps when planning is front-loaded and the
  plan is grounded [R3].
- A bad/under-specified plan can hurt a good executor [R3]; execution is a long
  tail with tool/policy errors [R5].
- Auto-prewalk's conservative threshold is appropriate because handoff errors
  can cost more than the compute saved [O2]. `[INFERENCE]`

When **not** to use it: unresolved races/invariants, subtle lifecycle changes,
algorithmically hard changes, or tasks where diagnosis continues after the first
edit. When **not needed**: if you already use plan mode with a separate `plan`
role, plan mode switches to the plan model on entry and restores the prior model
on exit [O4]. That is already a plan-boundary split; stacking `prewalk` is
redundant unless you specifically want a mid-task handoff from the active model.

For the proposed DeepSeek/Gemini setup, `prewalk` is not required: plan mode
uses DeepSeek, execution uses Gemini after approval. Leave `prewalk.enabled`
false unless a 2×2 test shows a mid-task handoff helps.

## 5. The AA numbers: what is and is not disclosed

### Confirmed

- AA page for **DeepSeek V4.1 Flash 1017 (Max)**: **45** Intelligence Index
  [A1].
- AA page for **Gemini 3.8 Flash (High)**: **41** [A3].
- AA **base** DeepSeek V4.1 Flash (Max): **39**, marked deprecated; AA points to
  the 1017 release [A2].
- Stencil catalog: base V4.1 Flash `int` 39.5; 1017 `int` 45.1; Gemini 3.8
  Flash `int` 40.9 [A5].
- OMP local cache: `google-antigravity/gemini-3.8-flash` has `int: 40.9`;
  `deepseek/deepseek-flash` has no `int` in the observed cache, while
  `omp models --json` labels it “DeepSeek V4.1 Flash 1017” and gives thinking
  levels `low, high, max` [O6].

### The non-obvious differences

1. **Checkpoint/version.** 45 is 1017; base V4.1 Flash is 39. If any tool or
   cache maps “DeepSeek V4.1 Flash” to the base row, it will show 39/39.5, not
   45. Verify the exact checkpoint before comparing.
2. **Effort label.** DeepSeek is evaluated as **Max**; Gemini as **High**.
   Those labels are vendor-specific; they are not guaranteed to spend the same
   reasoning budget. AA's methodology uses reasoning models' maximum output
   tokens and a reasoning temperature, but the effort semantics come from each
   model [A4]. `[INFERENCE]`
3. **Composite index.** 45 and 41 are weighted composites (Agents 30%, Coding
   20%, Scientific 20%, General 30%) with no PlanBench/plan-quality component
   [A4]. A 4-point gap does not mean a 4-point planning gap.
4. **Ranking sets.** #2/121 (DeepSeek, open-weights class) and #51/214 (Gemini,
   its class) are not a single ranking [A1][A3]. Do not compare ranks.
5. **Cost/verbosity.** DeepSeek is $0.26/task with 210M output tokens; Gemini is
   $1.24/task with 170M [A1][A3]. DeepSeek is faster (203 vs 137 tok/s) but more
   verbose. Planning has few calls; execution has many, so these economics
   differ by role.
6. **Provider serving.** AA benchmarks API providers; OMP uses DeepSeek direct
   and Google Antigravity. A model can be served with different routing,
   quantization, tool support, or context limits. OMP's Antigravity entry maps
   `:high` to `gemini-3.8-flash-high`; DeepSeek's provider entry is direct
   [O6]. Do not assume AA's provider result is identical to OMP's path.
7. **Rounding/staleness.** AA displays integers; OMP displays `Math.round(int)`
   and its cache may be stale or omit `int` [O6]. Missing is not zero.

So: **no evidence of an undisclosed score or manipulation**. The numbers are
disclosed; what is *not* disclosed in the headline is the version/effort/index
composition/provider context that determines whether the comparison is relevant
to planning.

## Recommended setup and decision

- Keep the current plan/default split as a **candidate**, not a conclusion:
  `modelRoles.plan = deepseek/deepseek-flash:max`;
  `modelRoles.default = google-antigravity/gemini-3.8-flash:high`;
  `prewalk.enabled = false` (observed 2026-10-22) [O6].
- Before committing, verify OMP actually serves DeepSeek **1017** (not the base
  39 checkpoint) and that `:max` is honored. The observed local cache lacks
  `int`; refresh/verify the catalog rather than treating it as zero.
- Run the 2×2 matrix (A–D) on 10–20 real tasks. If B (DeepSeek plan + Gemini
  exec) does not beat A (DeepSeek/DeepSeek) on cost per success at equal or
  better reliability, use A. Use Gemini when its multimodal input, Google
  quota, or tool surface is the actual reason.
- If you want a user-facing recommender, present a provider-scoped shortlist
  with the table columns above and label “prior only” when no local plan eval
  exists. Do not auto-set roles from `int` alone.

## Sources

- [A1] Artificial Analysis, “DeepSeek V4.1 Flash 1017 (max) — Intelligence,
  Performance & Price Analysis.” https://artificialanalysis.ai/models/deepseek-v4-1-flash-1017
- [A2] Artificial Analysis, “DeepSeek V4.1 Flash (max)” (deprecated).
  https://artificialanalysis.ai/models/deepseek-v4-1-flash
- [A3] Artificial Analysis, “Gemini 3.8 Flash (high) — Intelligence,
  Performance & Price Analysis.” https://artificialanalysis.ai/models/gemini-3-8-flash
- [A4] Artificial Analysis, “Intelligence Benchmarking Methodology”
  (Intelligence Index v4.3.2).
  https://artificialanalysis.ai/methodology/intelligence-benchmarking
- [A5] Stencil, shared model catalog.
  https://catalog.stencil.so/models.json
- [O1] oh-my-pi, `docs/models.md`, “Role aliases and settings.”
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/models.md
- [O2] oh-my-pi, `docs/prewalk.md`.
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/prewalk.md
- [O3] oh-my-pi, `docs/settings.md`.
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/settings.md
- [O4] oh-my-pi, `packages/coding-agent/src/plan-mode/model-transition.ts`.
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/plan-mode/model-transition.ts
- [O5] oh-my-pi, `docs/cli-reference.md`, “Prewalk and plan modes.”
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/cli-reference.md
- [O6] Observed on this workstation, 2026-10-22: `~/.omp/agent/models.db`
  `model_cache` and `omp models --json`; not an OMP default. `int` is optional;
  missing is not zero.
- [R1] Valmeekam et al., “PlanBench,” arXiv:2206.10498.
  https://arxiv.org/abs/2206.10498
- [R2] Valmeekam, Stechly, Kambhampati, “LLMs Still Can't Plan; Can LRMs?,”
  arXiv:2409.13373. https://arxiv.org/abs/2409.13373
- [R3] Erdogan et al., “Plan-and-Act,” arXiv:2503.09572.
  https://arxiv.org/abs/2503.09572
- [R4] Xia et al., “Agentless,” arXiv:2407.01489.
  https://arxiv.org/abs/2407.01489
- [R5] Yao et al., “τ-bench,” arXiv:2406.12045.
  https://arxiv.org/abs/2406.12045
- [R6] Stechly, Valmeekam, Kambhampati, “On the Self-Verification Limitations
  of Large Language Models on Reasoning and Planning Tasks,” arXiv:2402.08115.
  https://arxiv.org/abs/2402.08115
- [R7] Snell et al., “Scaling LLM Test-Time Compute Optimally…,”
  arXiv:2408.03314. https://arxiv.org/abs/2408.03314
- [R8] Anthropic, “How we built our multi-agent research system.”
  https://www.anthropic.com/engineering/multi-agent-research-system
- [R9] OpenAI, “A practical guide to building agents.”
  https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
