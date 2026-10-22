# Model intelligence, planning, and planning-vs-execution models

*Research note, 2026-10-22. Primary sources are papers, vendor engineering docs,
and OMP source/docs. `[INFERENCE]` marks judgment; vendor claims are labeled.*

## Short answer

- **"Model intelligence" is not one variable.** The useful decomposition is
  task-specific reasoning/decomposition, instruction and tool reliability,
  usable context, test-time compute, and cost/latency. A composite benchmark
  index is a coarse prior, not a planner score.
- **Higher reasoning capability helps short/medium plan generation, but not
  robustly.** o1-preview reaches 97.8% on 3–5-block Blocksworld versus 34.6%
  for GPT-4, yet falls to 23.6% on 20–40-step problems and 52.8% on
  obfuscated Blocksworld; it identifies only 27% of unsolvable instances
  [S2].
- **Planning helps only when the plan is grounded, feasible, and matches the
  executor's actual affordances.** A trained planner lifts a base executor
  from 9.85% to 29.63% and dynamic replanning to 44.24% on WebArena-Lite; a
  zero-shot planner can *hurt* a trained executor (23.63% vs 36.97% with no
  planner) [S3].
- **Planning vs execution is primarily an information/error-surface split,
  not automatically a model-tier split.** The planner owns global
  decomposition and uncertainty; the executor owns grounded action, tool
  fidelity, policy adherence, and error recovery. A stronger planner is
  justified when planning errors dominate and the plan is the contract; a
  stronger executor or verifier is justified when execution, adherence, or
  silent verification errors dominate.
- **Measure phase-level failures and cost per success, not the intelligence
  score.** OMP supports a hard `plan` role, an optional one-shot `prewalk`
  handoff, and a separate `advisor` reviewer; none of these establishes that
  the plan model should have a higher catalog `int`.

## Definitions

| Term | Operational meaning here | What it predicts | Main caveat |
|---|---|---|---|
| **Composite benchmark score** | Artificial Analysis Intelligence Index v4.3.2: 10 evaluations weighted Agents 30%, Coding 20%, Scientific Reasoning 20%, General 30%; primarily text/English; zero-shot, pass@1 [S17] | Broad capability triage; a somewhat better prior for agentic execution than knowledge-only indices because 50% is agentic/coding | Not planning-specific; mixes knowledge, long context, science, and hallucination; weights/versions change; AA says it “may not apply directly to every use case” [S17] |
| **Reasoning capability** | RL-trained long chain-of-thought / deliberative inference, e.g. o1 [S2] | Short/medium plan generation; some obfuscated planning; unsolvable detection | Collapses on longer/complex problems; can be less efficient than standard models on easy tasks [S2][S26] |
| **Test-time compute** | Extra inference tokens, search, repeated sampling, or verifier-guided selection [S6][S25] | Problems where the model already has non-trivial success; reliability with a good verifier | Diminishing returns and verifier bottleneck; hardest prompts still favor larger models [S6] |
| **Instruction following** | Ability to satisfy explicit constraints and policies | Plan adherence and executor policy compliance | Degrades as constraints accumulate; not the same as knowing the right action |
| **Tool use** | Correct schema use, API calls, command execution, GUI grounding | Execution success and error recovery | Agent-computer interface/scaffold can matter as much as the model [S10][S12][S14] |
| **Context length** | Advertised vs usable context | Retrieval and synthesis if information is usable | Long context degrades in the middle and without literal matches |
| **Cost/latency** | Dollars, tokens, wall-clock per task | Feasibility of an architecture, not quality | Cost per *success* is the useful metric; large spreads at similar scores |

**Which are predictive of planning quality?**

- **Strongest:** task-specific planning/agentic evaluations on the target
  distribution (PlanBench-style planning, WebArena, SWE-bench, policy-heavy
  τ-bench), plus instruction/tool reliability. These measure the actual phase.
- **Moderate:** reasoning capability and test-time compute, *if* the task is
  in the regime where the model has non-trivial success. They are not
  monotonic with task length [S2][S26][S6].
- **Weak alone:** composite index, parameter count, advertised context length,
  cost/latency. They are priors or constraints, not plan-quality measures.
  `[INFERENCE]`

## Evidence: intelligence → planning

### Plan generation and correctness

PlanBench is the cleanest controlled evidence. On a static 600-instance,
3–5-block Blocksworld set, GPT-4 scores 34.6% zero-shot; Claude 3.5 Sonnet
57.6% one-shot; LLaMA 3.1 405B 62.6% zero-shot. On semantically identical but
obfuscated “Mystery Blocksworld,” no LLM reaches 5% [S1][S2, Table 1]. Much of the
apparent planning gain is therefore approximate retrieval, not general
algorithmic planning.

o1-preview changes the picture but does not close it. It reaches 587/600 =
97.8% on the small Blocksworld set, 52.8% on Mystery Blocksworld, and 37.3% on
randomized Mystery Blocksworld. On 110 larger problems requiring 20–40 steps,
it drops to 23.63%. On unsolvable instances it correctly identifies only 27%
(and falsely calls 11.5% of solvable randomized-Mystery instances impossible)
[S2, Tables 2–3, Figure 3]. Cost is phase-relevant: o1-preview costs $42.12 per
100 instances versus $0.65 for GPT-4o [S2, Table 4]. **Reasoning intelligence
helps plan generation, but the gain is length- and representation-sensitive.**

The Apple “Illusion of Thinking” study adds a boundary condition: across
controllable puzzle environments, LRMs show three regimes — standard models win
at low complexity, LRMs win at medium complexity, and both collapse at high
complexity; reasoning effort rises with complexity up to a point, then declines
despite remaining budget [S26]. This conflicts with a simple “more reasoning =
better planning” model and supports difficulty-aware routing.

Planning-before-code also helps when the plan is grounded:

- Plan-and-Act separates a Planner from an Executor and uses dynamic
  replanning; a *base* zero-shot planner with a synthetic-trained executor
  scores 23.63%, worse than 36.97% with no planner, while a trained planner
  with a base executor lifts 9.85% to 29.63% and dynamic replanning to 44.24%
  [S3, Table 1, §5.2–5.3]. This is direct evidence that a bad plan can hurt a
  good executor.
- LLM+P translates a problem to PDDL and uses a classical planner; it returns
  optimal plans for most benchmark problems, while LLMs alone fail to provide
  feasible plans for most [S4].
- Plan-and-Solve prompting makes a model divide a task into subtasks and carry
  them out; zero-shot PS/PS+ consistently outperforms zero-shot CoT on ten
  datasets [S7]. This is one model doing both phases, not a model-tier split.
- ReAct interleaves reasoning traces and actions; reasoning helps induce,
  track, and update plans, while actions supply external information and
  exception handling [S8]. Planning and execution are not cleanly separable in
  this pattern.
- Tree of Thoughts (ToT) makes inference a search over coherent thoughts; on
  Game of 24, GPT-4 with chain-of-thought solved 4% of tasks, while ToT
  achieved 74% [S5]. This is a deliberate inference/search gain, not
  necessarily a larger model.

### Plan-following, decomposition, and error recovery

Planning quality is not only “does the plan look right,” but “can it be
executed consistently.”

- τ-bench: state-of-the-art function-calling agents succeed on <50% of tasks
  and are inconsistent; pass^8 is <25% in retail [S10]. One-shot plan
  correctness is insufficient; reliability over repeated trials is the
  deployment metric.
- Anthropic’s “think” tool gives a model a scratchpad during tool use; on
  τ-bench airline/retail it improves pass^1 and pass^k over baseline, and
  Anthropic later recommends extended thinking over the dedicated tool in most
  cases [S15]. Execution-time deliberation improves policy adherence and
  multi-step consistency, but is not a planner substitute.
- Anthropic’s multi-agent research system uses a lead agent (Opus 4) and
  Sonnet 4 subagents with separate context windows. It reports a 90.2%
  improvement over single-agent Opus 4 on an internal research eval; token
  usage explains 80% of BrowseComp performance variance, and multi-agent
  systems use ~15× chat tokens. Anthropic explicitly cautions that most coding
  tasks have fewer parallelizable subtasks and that agents are not yet great at
  real-time delegation [S13]. This is a **vendor claim**, confounded by
  parallelism and token budget, not a clean planner-tier ablation.
- Agentless, a fixed localize → repair → validate pipeline with no agent loop,
  beats complex agents on SWE-bench Lite at 32.00% for $0.70 [S11]. Complex
  planning/agency is not always necessary.
- SWE-bench+ finds 32.67% of successful patches had solution leakage and 31.08%
  of passed patches were suspicious due to weak tests; after filtering,
  SWE-agent+GPT-4 drops from 12.47% to 3.97% [S12]. Verification can dominate
  apparent capability.

### Test-time compute and verification

- Snell et al.: compute-optimal test-time scaling improves efficiency >4× over
  best-of-N; on problems where a smaller model has non-trivial success,
  test-time compute can outperform a 14× larger model; on harder prompts the
  larger model remains better [S6].
- Large Language Monkeys: repeated sampling raises SWE-bench Lite coverage from
  15.9% (1 sample) to 56% (250 samples) with DeepSeek-Coder-V2, but without
  automatic verifiers, majority voting and reward models plateau beyond several
  hundred samples [S25]. **The verifier, not the sampler, becomes the
  bottleneck.**
- Self-verification is the weak link for planning. Stechly et al. find
  “significant performance collapse with self-critique and significant
  performance gains with sound external verification” on Game of 24, graph
  coloring, and STRIPS planning [S23]. Valmeekam et al. find LLM plan
  self-critique diminishes generation performance and produces many false
  positives [S24]. **For plans, prefer a sound external verifier over planner
  self-critique.**

### Evidence table

| Evidence | Type | Key result | Bearing |
|---|---|---|---|
| PlanBench + o1 [S2] | Empirical benchmark | 97.8% small Blocksworld; 23.63% long plans; 52.8% Mystery; 27% unsolvable detection | Reasoning helps planning, but not robustly; length/representation matter |
| Plan-and-Act [S3] | Empirical benchmark | No planner 36.97%; base planner 23.63%; trained planner + base executor 29.63%; dynamic 44.24%; 53.94% without CoT, 57.58% with CoT | Planner quality/fit is a bottleneck; bad plans can hurt good executors |
| LLM+P [S4] | Empirical | Classical planner optimal on most; LLM infeasible on most | Sound planning can be externalized |
| Plan-and-Solve [S7] | Empirical | Zero-shot plan-then-solve beats zero-shot CoT across 10 datasets | One model can plan and execute |
| ReAct [S8] | Empirical | Interleaved reasoning/actions improves interactive decision making | Planning/execution can be iterative, not one-shot |
| τ-bench [S10] | Empirical | GPT-4o-class agents <50%; pass^8 <25% retail | Plan-following consistency is poor |
| Agentless [S11] | Empirical | 32.00% SWE-bench Lite at $0.70, no agent loop | Complex planning is not always necessary |
| SWE-bench+ [S12] | Empirical critique | 32.67% leakage; 31.08% weak tests; 12.47% → 3.97% after filtering | Verification can dominate apparent capability |
| Anthropic multi-agent [S13] | Vendor internal eval | 90.2% over single Opus; 15× tokens; 80% variance from tokens | Stronger lead + cheaper subagents can help, but confounded |
| Anthropic think tool [S15] | Vendor benchmark | Improved pass^1/pass^k on τ-bench; later recommends extended thinking | Execution-time reasoning improves adherence |
| Snell [S6] | Empirical | Test-time compute beats 14× model on easier prompts; >4× efficiency | Compute can substitute for size only in a regime |
| Large Monkeys [S25] | Empirical | 15.9%→56% SWE-bench Lite with 250 samples | Verifier is the scaling bottleneck |
| Stechly [S23] | Empirical | Self-critique collapses; sound verifier gains | Do not use the planner as its own verifier |

## Planning model vs execution model

### Functional distinction

| Dimension | Planner | Executor |
|---|---|---|
| **Objective** | Feasible, complete, ordered plan; resolve ambiguity and dependencies | Grounded task success; correct tools/edits; policy adherence |
| **Input** | Goal, broad repo/world context, constraints, prior attempts | Plan artifact, local observation, tool outputs |
| **Output** | Plan contract: steps, decisions, assumptions, verification criteria | Actions, edits, tool calls, patches |
| **Error surface** | Global: wrong approach, missing dependency, infeasible order | Local: wrong API, syntax, context loss, policy drift, loop |
| **Recoverability** | Errors often irreversible without replanning | Errors often recoverable from environment feedback |
| **Call pattern** | Few calls; can be expensive and slow | Many calls; latency/cost sensitive |
| **Context** | Broad, long, ambiguous; must synthesize | Narrow, fresh, high-signal; too much context hurts |
| **Verification** | Hard; no sound oracle in general; self-critique unreliable | Tests, compiler, runtime, environment feedback |
| **Model traits** | Reasoning, decomposition, world knowledge, uncertainty handling | Instruction following, tool schema fidelity, code precision, adaptation |
| **Typical failure** | Plausible but wrong direction; missing steps | Executes a bad plan perfectly; tool/syntax/policy errors |

### Four ways to separate planning from execution

1. **Prompt/context separation (same weights).** Plan mode constrains tools to
   read-only and forces a plan artifact. Cheapest; no model diversity; depends
   on the model's ability to switch modes.
2. **Role separation (different weights).** A `plan` role/model and an
   execution/default model. This is OMP's `modelRoles.plan` and Anthropic's
   Opus lead + Sonnet subagents. Requires routing configuration and a clean
   handoff contract.
3. **Per-query routing/cascade.** A classifier sends easy queries to a cheap
   model and hard ones to a strong model. RouteLLM reports >2× cost reduction
   in some cases without compromising benchmark quality [S9]. Routers are
   trained classifiers; misrouting is the failure mode.
4. **Mid-task one-shot handoff.** Start on a strong model for planning, then
   switch to a cheaper/faster model after the approach is settled and the first
   edit/write begins. OMP `prewalk` is this pattern. It differs from a role
   split: the switch is one-shot and stateful, not a persistent role assignment.

Anthropic's orchestrator-workers pattern has a central LLM decompose and
delegate to worker LLMs, while its evaluator-optimizer pattern separates
generation from evaluation [S14]. Microsoft's magentic pattern has a manager
build and refine a task ledger while specialized agents use tools; it advises
assigning each agent a model matching task complexity, not necessarily the most
capable model [S27].

### Does a stronger planner help?

**Yes, when planning is the binding constraint and the plan is grounded.**
Plan-and-Act shows trained planner quality is the bottleneck: improving the
planner lifts even a base executor, while a zero-shot planner can hurt [S3].
Anthropic's lead-Opus/subagent-Sonnet result is consistent with “stronger
planning + cheaper execution,” but it is a vendor internal eval and is
confounded by 15× token use and parallelism [S13].

**No, not automatically.** Three limits recur:

- **A plan is only as good as its grounding.** Plan-and-Act's base planner
  underperforms no planner for a trained executor because its plans are not
  grounded in the environment [S3].
- **Planning can be unnecessary.** Agentless beats complex agents on SWE-bench
  Lite with a fixed localize → repair → validate pipeline [S11]. If the task is
  well-scoped and the harness is strong, a planning loop adds cost without
  adding capability.
- **Planning model self-verification is unreliable.** A stronger planner that
  critiques its own plan can collapse performance; a sound external verifier is
  the reliable gain [S23][S24].

`[INFERENCE]` The practical question is not “is the planner smarter?” but “does
the planner's output contain the decisions the executor would otherwise have to
invent?” A stronger planner that emits a decision-complete plan is valuable; a
stronger planner that emits an elegant but under-specified plan is not.

### When a stronger executor or verifier matters more

- **Execution is the long tail.** Frontier coding agents still fail on
  syntax/tool use and wrong solutions [S12]. If the plan is already
  decision-complete, the remaining failures are execution failures.
- **Policy/instruction adherence is the task.** τ-bench agents fail consistency
  and rule-following; execution-time reasoning improves this [S10][S15]. A
  stronger planner does not fix an executor that ignores the plan or the policy.
- **The environment is dynamic.** Plan-and-Act needs dynamic replanning because
  static plans cannot handle unexpected observations [S3]. That is
  execution-time adaptation.
- **Verification is weak.** If tests are weak or absent, silent wrong patches
  pass; SWE-bench+ finds 31.08% suspicious passes [S12]. A stronger verifier or
  better tests can dominate a stronger planner.
- **Context is the bottleneck.** Long-context degradation is addressed by
  context isolation/retrieval and clean handoffs, not by a higher intelligence
  score. `[INFERENCE]`

### Economics and context

- Planning calls are few; execution calls are many. `[INFERENCE]` This favors
  spending on the planner *if* planning quality is the bottleneck. But
  reasoning tokens can dominate: o1-preview costs 65× GPT-4o per 100 PlanBench
  instances [S2, Table 4].
- Multi-agent systems use ~15× chat tokens [S13]; cost per success, not cost
  per call, is the right denominator. RouteLLM shows large cost reductions are
  available through routing [S9], but require calibrated routers and evals.
- Context isolation is a real architectural benefit: subagents with separate
  context windows compress findings for the lead [S13]; the executor can
  discard observations it no longer needs [S3]. The cost is “game of
  telephone”; Anthropic recommends subagents write artifacts and pass
  references [S13, Appendix].
- Handoffs must be self-contained. OMP's plan prompt requires a plan that a
  fresh engineer/agent can execute with zero design decisions, because approval
  may clear or compact the conversation.

## OMP implications

OMP exposes distinct mechanisms; do not conflate them.

| Mechanism | Exact behavior | Source |
|---|---|---|
| **`plan` model role** | Built-in chat role among `default`, `smol`, `slow`, `vision`, `plan`, `commit`, `tiny`, `memory`, `task`, `advisor`. Configured under `modelRoles` in `config.yml`, not `models.yml`. Assigning `plan` does **not** enter plan mode; calling `todo` does not select the plan model. While plan mode is active, changing the `plan` role reapplies its model. Values can append `:minimal`/`:low`/`:medium`/`:high`. | [S18] |
| **Plan-mode transition** | Plan mode drives the active session model from the `plan` role: it switches to the plan model on entry and restores the pre-plan model on exit. The same policy runs when the `plan` role is reassigned mid-planning; a mid-stream switch is deferred to the turn boundary. It can apply only a thinking-level change. | [S20] |
| **`prewalk`** | Optional, off by default, one-shot handoff from the active model to a faster/cheaper target after planning reaches implementation. Default target `@smol`. Injects a planning nudge; when `todo` is active, a successful `todo` call opens the gate; switches at the completed assistant turn containing the first eligible `edit`/`write`. Disarms after the handoff and changes the active model/thinking level without rewriting role assignments. | [S19] |
| **Auto-prewalk** | Native judge classifies each new top-level task by *where expensive reasoning belongs*: `prewalk` (hard thinking first, implementation bounded), `primary` (strong reasoning still needed during implementation), or `direct` (no up-front phase). It is explicitly **not a difficulty rating or general model router**; it never picks a different planning model. Arms only when `prewalk` wins and probability ≥ 0.70. “A wrong handoff costs more than a missed one,” so ties favor `primary` and small tasks favor `direct`. Fails open. | [S19] |
| **`--plan-yolo`** | Starts in read-only plan mode, auto-approves the model's plan proposal, then switches to the execution target to implement it. `--plan-yolo-into` chooses the target; default is the `smol` role. | [S21] |
| **Settings** | `modelRoles.plan` / `PI_PLAN_MODEL`; `plan.enabled` default true; `plan.defaultOnStartup` default false; `prewalk.enabled` default false. | [S19][S22] |

**What this means**

- OMP implements both a **hard role split** (`plan` role + plan mode) and a
  **one-shot handoff** (`prewalk`). They answer different questions: the plan
  role selects who plans; prewalk decides when to stop paying for the planner.
- `prewalk` is deliberately conservative and bounded: it triggers only at the
  first edit/write after a successful todo, switches once, and disarms.
  Auto-prewalk's 0.70 threshold and “wrong handoff costs more than a missed
  one” are explicit design choices against aggressive routing [S19].
- Auto-prewalk classification skips plan mode and subagents; subagent prewalk is
  configured separately [S19]. Do not assume a top-level prewalk target applies
  to `task` agents.
- `--plan-yolo` is the aggressive variant: it auto-approves the plan and hands
  execution to `smol`. It removes the human check that plan mode exists to
  provide; use it only for bounded, well-specified tasks.
- The `advisor` is a **verifier/reviewer**, not a planner or executor. It
  resolves through `advisor`, else `slow`, else a strong built-in chain; it is
  a separate model axis. This is the right place to spend on verification, not
  necessarily on planning. `[INFERENCE]`
- OMP has **no doc/source asserting that `plan` must have a higher intelligence
  score than `default`**, and no built-in plan-quality metric. The `int` field
  is a catalog aggregate; using it as the sole basis for role assignment is
  unsupported. `[INFERENCE]`
- OMP logs auto-prewalk judgments as model usage under purpose `auto-prewalk`
  [S19], but that is a routing log, not a plan-quality eval. Measure plan
  quality externally.

## Practical decision rule

1. **Start with one strong model for both phases plus a real verifier.**
   OpenAI's practical guidance is to prototype with the most capable model for
   every task, establish a baseline, then swap in smaller models where evals
   still pass [S16, “Selecting your models”]. Do not split roles before you
   have a baseline.
2. **Attribute failures by phase.** For each failed trajectory, label planning
   (wrong approach, missing dependency, infeasible order), execution (tool
   syntax, wrong API, edit error), adherence (ignored plan/policy), verification
   (passed but wrong), or context (lost information). Upgrade the phase with
   the largest recoverable bucket.
3. **Upgrade the planner when planning errors dominate and the plan is the
   contract.** Strong candidates: ambiguous scope, architecture, cross-file
   migration, unfamiliar codebase, long horizon, high cost of wrong direction,
   and a narrow executor. Require the plan to be grounded and
   decision-complete; otherwise a stronger planner can hurt [S3].
4. **Upgrade the executor when the plan is decision-complete but execution
   fails.** Strong candidates: tool-heavy work, policy-heavy environments,
   dynamic observations, long-tail APIs, recovery from failures. Add
   execution-time reasoning and improve the agent-computer interface before
   assuming a smarter planner will help [S15].
5. **Upgrade the verifier when errors are silent.** Prefer tests/compiler/
   runtime/sound external verifiers over planner self-critique [S23][S24]. If
   tests are weak, fix the tests first; SWE-bench+ shows weak tests can inflate
   success by ~8.5 points [S12].
6. **Run a 2×2 counterfactual before committing to a split:** strong planner ×
   strong executor, strong × weak, weak × strong, weak × weak. Measure
   end-to-end success, pass^k, plan feasibility, adherence, cost per success,
   and wall-clock. Plan-and-Act shows the interaction is real: planner quality
   changes whether a planner helps at all [S3].
7. **Keep the split only if it wins on cost per success at equal or better
   reliability.** Otherwise revert to one model. Complexity is not free:
   Agentless beats complex agents on SWE-bench Lite [S11], and multi-agent
   systems can use 15× tokens [S13].

### Decision matrix

| Symptom | First lever | Why |
|---|---|---|
| Wrong approach, missing dependencies, infeasible order | Stronger planner / more planning time | Global errors are not recoverable by a better executor [S3] |
| Plan is good but steps fail | Stronger executor / better ACI / execution-time reasoning | Execution and tool fidelity are the bottleneck [S12][S15] |
| Plan ignored, policy drift, inconsistent behavior | Stronger instruction-following executor + verifier | τ-bench consistency failure [S10] |
| Tests pass but patch is wrong | Better verifier/tests | Silent verification failure [S12] |
| Long context lost | Context isolation/retrieval, not a higher IQ | Usable context ≠ advertised context `[INFERENCE]` |
| Cost too high | Routing/cascade/one-shot handoff | RouteLLM and prewalk [S9][S19] |
| Simple, well-scoped fix | No plan mode; direct execution | Planning overhead is unnecessary [S11] |

### What to measure rather than assume

- **End-to-end success** on holdout tasks, not benchmark averages.
- **pass^k** (all k trials succeed), not pass@1, for reliability [S10].
- **Plan feasibility/completeness**: can a fresh executor implement without
  design decisions? Rubric: dependencies, ordering, exact targets,
  verification, assumptions.
- **Plan adherence**: step coverage, unplanned deviations, unnecessary steps,
  replans.
- **Phase-level error attribution**: planning vs execution vs adherence vs
  verification vs context.
- **First-pass yield and rework rate**: how often the first plan/patch is
  accepted.
- **Cost per success**, tokens, reasoning tokens, wall-clock; not cost per call.
- **Tool-call validity/repair rate** and context-length sensitivity.
- **Counterfactual role swaps** (2×2) and multiple seeds.
- **Router calibration**: auto-prewalk/judge confidence and false-handoff rate
  [S19].

## Caveats and conflicts

| Conflict | Evidence for | Evidence against | Resolution |
|---|---|---|---|
| **More reasoning improves planning** | o1 97.8% small Blocksworld vs GPT-4 34.6% [S2] | o1 23.63% long plans, 52.8% Mystery; Apple collapse at high complexity [S2][S26] | True on short/medium, in-distribution planning; not a general planner |
| **Self-correction helps** | Self-Refine reports ~20% average gains on open-ended refinement [S29] | Planning self-critique collapses; sound external verifier gains [S23][S24] | Task- and feedback-dependent; for plans, use external sound verification |
| **Multi-agent/role split helps** | Anthropic 90.2% over single Opus [S13] | Vendor internal eval; 15× tokens; coding less parallelizable | Promising for breadth-first, parallelizable work; not a default for coding |
| **Higher benchmark score = better agent** | Higher scores correlate with capability on the measured benchmark | Benchmarks vary; Agentless simple pipeline wins on SWE-bench Lite [S11] | Benchmark-specific; use the benchmark that matches the task |
| **Test-time compute substitutes for model size** | 14× larger model beaten on easier prompts [S6] | Hardest prompts still favor larger models [S6]; verifier bottleneck [S25] | Regime-dependent; allocate compute adaptively |
| **Long context solves context** | Larger windows are available | Lost-in-the-middle and NoLiMa degradation | Usable context ≠ advertised context; isolate/compress |

Additional caveats:

- **Composite index validity.** AA's index is a third-party synthesis with
  changing weights and versions; it is primarily text/English and explicitly
  not a universal use-case metric [S17]. No study found directly validates it
  against planning quality. `[INFERENCE]`
- **Benchmark contamination/saturation.** SWE-bench+ finds leakage and weak
  tests [S12]; SWE-bench Pro is explicitly contamination-resistant and much
  harder [S28]. Do not compare scores across benchmark versions.
- **Vendor vs independent.** Anthropic's 90.2% and think-tool figures are
  internal/vendor benchmarks [S13][S15]; independent replications are limited.
- **Planning can be net-negative.** Agentless [S11] and Plan-and-Act's base
  planner [S3] are direct counterexamples to “more planning always helps.”
- **Handoff loss.** A plan artifact can lose tacit context; OMP's prompt tries
  to prevent this by requiring decision-completeness.
- **Router error.** Cascades and auto-prewalk are classifiers; misrouting can
  cost more than the compute saved. OMP's threshold is intentionally
  conservative and fails open [S19].
- **Missing catalog data.** A missing `int` is not zero; do not rank or exclude
  a model on absent metadata.

## Sources

- [S1] Valmeekam et al., “PlanBench: An Extensible Benchmark for Evaluating
  Large Language Models on Planning and Reasoning about Change,”
  arXiv:2206.10498. https://arxiv.org/abs/2206.10498
- [S2] Valmeekam, Stechly, Kambhampati, “LLMs Still Can't Plan; Can LRMs? A
  Preliminary Evaluation of OpenAI's o1 on PlanBench,” arXiv:2409.13373.
  https://arxiv.org/abs/2409.13373 (Tables 1–4, Figure 3)
- [S3] Erdogan et al., “Plan-and-Act: Improving Planning of Agents for
  Long-Horizon Tasks,” arXiv:2503.09572.
  https://arxiv.org/abs/2503.09572 (§5.2–5.3, Table 1)
- [S4] Liu et al., “LLM+P: Empowering Large Language Models with Optimal
  Planning Proficiency,” arXiv:2304.11477.
  https://arxiv.org/abs/2304.11477
- [S5] Yao et al., “Tree of Thoughts: Deliberate Problem Solving with Large
  Language Models,” arXiv:2305.10601. https://arxiv.org/abs/2305.10601
- [S6] Snell et al., “Scaling LLM Test-Time Compute Optimally can be More
  Effective than Scaling Model Parameters,” arXiv:2408.03314.
  https://arxiv.org/abs/2408.03314
- [S7] Wang et al., “Plan-and-Solve Prompting: Improving Zero-Shot
  Chain-of-Thought Reasoning by Large Language Models,” arXiv:2305.04091.
  https://arxiv.org/abs/2305.04091
- [S8] Yao et al., “ReAct: Synergizing Reasoning and Acting in Language
  Models,” arXiv:2210.03629. https://arxiv.org/abs/2210.03629
- [S9] Ong et al., “RouteLLM: Learning to Route LLMs with Preference Data,”
  arXiv:2406.18665. https://arxiv.org/abs/2406.18665
- [S10] Yao et al., “τ-bench: A Benchmark for Tool-Agent-User Interaction in
  Real-World Domains,” arXiv:2406.12045.
  https://arxiv.org/abs/2406.12045
- [S11] Xia et al., “Agentless: Demystifying LLM-based Software Engineering
  Agents,” arXiv:2407.01489. https://arxiv.org/abs/2407.01489
- [S12] Aleithan et al., “SWE-Bench+: Enhanced Coding Benchmark for LLMs,”
  arXiv:2410.06992. https://arxiv.org/abs/2410.06992
- [S13] Anthropic, “How we built our multi-agent research system,” 2025-06-13.
  https://www.anthropic.com/engineering/multi-agent-research-system
- [S14] Anthropic, “Building effective AI agents,” 2024-12-19.
  https://www.anthropic.com/engineering/building-effective-agents
- [S15] Anthropic, “The ‘think’ tool: Enabling Claude to stop and think in
  complex tool use situations,” 2025-03-20 (extended-thinking update
  2025-12-15). https://www.anthropic.com/engineering/claude-think-tool
- [S16] OpenAI, “A practical guide to building agents,” 2026-01-15.
  https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- [S17] Artificial Analysis, “Intelligence Benchmarking Methodology”
  (Intelligence Index v4.3.2).
  https://artificialanalysis.ai/methodology/intelligence-benchmarking
- [S18] oh-my-pi, `docs/models.md`, “Role aliases and settings.”
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/models.md
- [S19] oh-my-pi, `docs/prewalk.md`.
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/prewalk.md
- [S20] oh-my-pi, `packages/coding-agent/src/plan-mode/model-transition.ts`.
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/plan-mode/model-transition.ts
- [S21] oh-my-pi, `docs/cli-reference.md`, “Prewalk and plan modes.”
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/cli-reference.md
- [S22] oh-my-pi, `docs/settings.md` (`PI_PLAN_MODEL`, `plan.*`,
  `prewalk.*`). https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/settings.md
- [S23] Stechly, Valmeekam, Kambhampati, “On the Self-Verification Limitations
  of Large Language Models on Reasoning and Planning Tasks,” arXiv:2402.08115.
  https://arxiv.org/abs/2402.08115
- [S24] Valmeekam, Marquez, Kambhampati, “Can Large Language Models Really
  Improve by Self-critiquing Their Own Plans?,” arXiv:2310.08118.
  https://arxiv.org/abs/2310.08118
- [S25] Brown et al., “Large Language Monkeys: Scaling Inference Compute with
  Repeated Sampling,” arXiv:2407.21787.
  https://arxiv.org/abs/2407.21787
- [S26] Shojaee et al., “The Illusion of Thinking: Understanding the Strengths
  and Limitations of Reasoning Models via the Lens of Problem Complexity,”
  arXiv:2506.06941. https://arxiv.org/abs/2506.06941
- [S27] Microsoft, “AI Agent Orchestration Patterns,” Azure Architecture
  Center. https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns
- [S28] Deng et al., “SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software
  Engineering Tasks?,” arXiv:2509.16941.
  https://arxiv.org/abs/2509.16941
- [S29] Madaan et al., “Self-Refine: Iterative Refinement with Self-Feedback,”
  arXiv:2303.17651. https://arxiv.org/abs/2303.17651
