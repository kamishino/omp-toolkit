# Agent prompt engineering, Gemini 3.8 Flash optimization, and extension boundaries

*Research note, 2026-10-22. Primary sources: Google DeepMind & Google Cloud
Gemini 3.8 documentation, Anthropic agent engineering guides & Writing for
Agents reference, OpenAI agent guidelines, OMP upstream architecture, and local
extension implementation. `[INFERENCE]` marks analytical judgment.*

## Short answers

1. **Agent skills to improve prompts for Gemini 3.8 Flash (High):**
   Gemini 3.8 Flash is an autonomous reasoning model with high token velocity,
   but it has acute positional sensitivity, prone to pre-tool chatter, and
   susceptible to tool suppression under reflective first-person context. An
   agent skill or meta-prompt must apply:
   - **Inverted layout:** Reference context/files *first*, concrete task and
     invariants at the *very end*.
   - **Third-person / anti-reflection framing:** Strip conversational reflection
     and first-person monologs that suppress tool calls.
   - **Pre-tool chatter suppression:** Instruct the model to route commentary
     into explicit tool arguments or emit raw tool calls immediately.
   - **Explicit negative bounding:** State what *not* to touch alongside the
     positive target (e.g. `DO NOT refactor adjacent methods; modify ONLY function X`).
   - **Thinking level calibration:** Use `:high` for non-trivial code planning
     and `:low` for strict formatting to prevent overthinking loops.

2. **Instructions/Skills vs. Extensions/Plugins in OMP:**
   - **Instructions (`AGENTS.md`, `RULES.md`, system prompts):** Declarative
     semantic guidance. Best for static coding conventions, git policies,
     safety rules, and architectural boundaries.
   - **Agent Skills (`skill://<name>`):** Procedural runbooks and on-demand
     domain expertise. Best for complex multi-step workflows (e.g. design tokens,
     TDD, bug diagnosis) using progressive disclosure.
   - **Extensions / Plugins (`extensions/*.ts`, plugins):** Required for
     **deterministic programmatic capabilities** that prompts cannot enforce:
     intercepting wire payloads (`before_provider_request`), filtering context
     (`context`), tool interception (`tool_call` / `tool_result`), custom
     native tools, slash commands, background watchers, and circuit breakers
     (e.g. `/gemini-heal`).

3. **Writing effective, agent-friendly prompts:**
   Autonomous agents need **executable contracts**, not conversational requests:
   - **Anatomy:** Role & Authority → Hard Invariants → Tool Policies → Ordered
     Workflow (DAG) → Verification → Observable Completion Bounds.
   - **Syntax & Keywords:** RFC 2119 keywords (`MUST`, `NEVER`, `SHOULD`),
     positive operational targets (avoiding the "elephant problem" of bare
     negations), leading words that recruit pretrained priors (*red-green*,
     *tight*, *tracer bullet*), and XML tag boundaries (`<context>`, `<invariants>`).
   - **Completion Criteria:** Replace subjective goals with binary, observable
     states (e.g. "Work is complete ONLY when `bun test` exits with code 0").

---

## 1. Skills and Prompt Patterns for Gemini 3.8 Flash (High)

### 1.1 Model Profile & Known Behavioral Quirks

Google DeepMind positions Gemini 3.8 Flash for "long-horizon coding and
autonomous agents" [G1, G3]. At `High` thinking effort, it allocates extensive
reasoning tokens and performs iterative tool dispatches.

| Quirk / Phenomenon | Failure Mode | Technical Root Cause | Mitigation Pattern |
|---|---|---|---|
| **Positional Attention Decay** ("Lost in the Middle") | Model ignores trailing constraints or forgets initial rules in long (>50k token) contexts. | Attention density concentrates at prompt boundaries (primacy and recency effects). | **Inverted Context Layout**: Place large context/files at the top; place task instructions and constraints at the **very bottom** [G5]. |
| **Reflective Context Tool Suppression** | Model fails to invoke tools (drops from 8/8 to 0/8 on benchmark tests) [G4]. | Reflective, first-person text in conversation history ("I think...", "Let me check...") primes an internal monolog that suppresses tool calls [G4]. | **Third-person framing** and **history scrubbing**: Clean internal reasoning traces from past assistant turns; enforce imperative tool triggers. |
| **Pre-Tool Chatter** | Emits conversational prose immediately before emitting a `FunctionCall`, breaking strict tool parsers or wasting budget [G2]. | Model attempts to narrate its intent prior to serialization. | **Pre-tool suppression**: Instruct the model to emit tool calls immediately without conversational preambles or setup sentences. |
| **Strict Turn Sequence & Parity** | `400 Invalid Argument` / "Requests ending with a model turn are not supported" [G2, O6]. | Google's endpoint strictly validates that every `FunctionCall` is followed by a matching `FunctionResponse` ID, and rejects requests terminating on an assistant turn. | Ensure the harness never leaves dangling assistant turns or uncoupled tool IDs (observed in subagent completion bug OMP #14790). |

### 1.2 Concrete Prompt Patterns for Gemini 3.8 Flash

#### Pattern A: Inverted Context Layout with Recency Bridging
Google's prompt guidelines [G5] emphasize placing reference material first and
actionable tasks last:

```markdown
<!-- 1. Background context and evidence placed FIRST -->
<context>
${codebase_files}
${test_failure_logs}
</context>

<!-- 2. Bridging anchor phrase -->
Based on the preceding technical context:

<!-- 3. Explicit imperative instruction and constraints placed at the VERY END -->
<task>
Diagnose the root cause of the test failure and apply the minimal patch.
</task>

<invariants>
- MUST NOT modify test assertions.
- MUST run `bun test` to verify.
- Output tool arguments immediately with zero conversational preamble.
</invariants>
```

#### Pattern B: Neutral Procedural Framing (Anti-Suppression)
To bypass the reflective tool suppression documented in Google Developer Forum [G4]:
- **Avoid:** `"You are a thoughtful assistant. Reflect on your observations and write down your thoughts before deciding whether to call a tool."`
- **Adopt:** `"System role: Automated code execution agent. Next mandatory action: Invoke tool 'read' on failing test paths. Do not output reflective text before tool execution."`

---

## 2. Instructions vs. Extensions/Plugins in OMP

### 2.1 The Architectural Boundary

OMP cleanly separates **probabilistic semantic steering** (prompts/instructions)
from **deterministic programmatic control** (extensions/plugins).

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        OMP Extension Runtime                           │
│  (Node/Bun / Deterministic TypeScript / Process & Wire Hooks)          │
│                                                                        │
│  • Event Hooks: session_start, agent_end, auto_retry_start             │
│  • Wire Interception: transformMessages, onPayload                     │
│  • Tools: pi.registerTool({ execute: (args) => ... })                  │
│  • UI Injection: ctx.ui.setWidget, ctx.ui.setStatus, ctx.ui.notify     │
│  • Circuit Breakers: Account rotation, auth.accountPolicies mutate     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Generates Context / Normalizes Wire
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        OMP Instruction Layers                          │
│         (LLM Attention Space / Probabilistic Semantic Steering)        │
│                                                                        │
│  1. SYSTEM.md         -> Base persona, tool usage rules (static)       │
│  2. APPEND_SYSTEM.md  -> Global append to system prompt                │
│  3. RULES.md          -> Standing hard constraints in system prompt    │
│  4. AGENTS.md         -> Injected in <project-context> <repo-rules>    │
│  5. SKILL.md          -> Disclosed on-demand procedural runbooks       │
└────────────────────────────────────────────────────────────────────────┘
```

#### What Instructions Can Accomplish
- Direct high-level reasoning, code architecture, and style preferences.
- Define step-by-step TDD workflows, review checklists, and git commit formats.
- Define criteria for when to ask the user vs. when to proceed conservatively.

#### Hard Technical Limits of Instructions
1. **Network / Socket Failures:** Prompts cannot catch an HTTP 503, an SSE
   stream hang, or an aborted connection.
2. **Account Circuit Breaking:** Prompts cannot read OAuth token states or
   dynamically mutate `auth.accountPolicies` to exclude a hung account.
3. **Daemon / Process Supervision:** Prompts cannot run a persistent background
   watcher, daemon process, or desktop tray application.
4. **Deterministic Security:** Prompts cannot guarantee zero leakage of secret
   keys if manipulated by adversarial injection; extensions can scrub tokens at
   the wire level.
5. **Subagent Inheritance Gap:** In OMP, **`AGENTS.md` is NOT inherited by task
   subagents** (`@task`) [O2]. Subagents only inherit `CLAUDE.md`/`GEMINI.md` or
   explicit directives in their task prompt.

### 2.2 Capabilities Requiring an OMP Extension (`~/.omp/agent/extensions/*.ts|js`)

From OMP extension specifications [O7, O8]:

1. **Lifecycle Event Hooks (`pi.on`):**
   - `session_start` / `session_shutdown`: Initialize caches, read persistent state.
   - `agent_end` / `auto_retry_start`: Detect hung routes or provider exceptions
     to trigger automated recovery (e.g. `gemini-health` auto-heal).
2. **Deterministic Custom Tools (`pi.registerTool`):**
   - Registering tools backed by arbitrary TypeScript/Node.js/Bun code (e.g.
     probing Antigravity endpoints, querying SQLite databases).
3. **Wire Protocol & Message Transformation (`transformMessages` / `onPayload`):**
   - Enforcing provider requirements: scrubbing trailing assistant messages,
     ensuring 1:1 `FunctionCall`/`FunctionResponse` matching, stripping
     unsupported fields.
4. **Custom Interactive Commands (`pi.registerCommand`):**
   - Registering `/gemini-health`, `/gemini-heal`, `/gemini-restore` for
     interactive human-in-the-loop control.
5. **UI & State Surface (`ctx.ui`):**
   - Status bar items (`ctx.ui.setStatus`), editor widgets (`ctx.ui.setWidget`),
     and notifications (`ctx.ui.notify`).
6. **Custom Providers (`pi.registerProvider`):**
   - Custom usage monitors and billing fetchers (e.g. DeepSeek balance checks).

### 2.3 Use Case Decision Matrix

| Use Case | Architectural Layer | Primary Location | Technical Justification |
|---|---|---|---|
| Enforce Conventional Commits (`type(scope): subject`) | **Instruction** | Global `AGENTS.md` or `RULES.md` | Pure text-formatting task; model understands semantic commit structure. |
| Prevent unrequested git commits/pushes | **Instruction + Git Hook** | Global `RULES.md` + Pre-commit hook | Prompt provides front-line policy; pre-commit hook provides deterministic safety. |
| Multi-step Bug Triage Runbook | **Skill** | `.agents/skills/diagnosing-bugs/SKILL.md` | Procedural workflow loaded on-demand via context pointer; saves context tokens when inactive. |
| DTCG Design Token Ramps & OKLCH Math | **Skill** | `.agents/skills/token-math/SKILL.md` | Deep domain reference loaded only during design system tasks. |
| Intercepting Hung Gemini 3.8 API Routes | **Extension** | `apps/omp-extension/src/index.ts` | Requires probing Google endpoints via HTTP fetch, reading OAuth tokens, and writing `auth.accountPolicies`. |
| Display Provider Quota Widget in TUI / Tray | **Extension + App** | `apps/omp-extension/src/index.ts` + `apps/desktop` | Requires OS process invocation, IPC, and native terminal/GUI widget rendering (`ctx.ui.setWidget`). |
| Custom Tool: Direct Antigravity Health Probe | **Extension** | `pi.registerTool({ name: "gemini_health" })` | Requires arbitrary network requests, timing measurement, and bypass of standard model generation. |
| Subagent Turn Normalization (fix issue #14790) | **Extension** | Provider wire adapter / hook | Requires inspecting the message array right before payload serialization and removing dangling model turns. |

---

## 3. Writing Agent-Friendly Prompts

### 3.1 Anatomy of an Agent-Friendly Prompt (6-Part Framework)

An autonomous agent prompt is an **executable contract**. It follows a strict
6-part hierarchy [S1, R7, R8]:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 1. ROLE & IDENTITY                                                     │
│    Who the agent is, execution stance, core domain authority.          │
├────────────────────────────────────────────────────────────────────────┤
│ 2. INVARIANTS & HARD CONSTRAINTS                                       │
│    Absolute boundaries, non-negotiable prohibitions, RFC 2119 keywords.│
├────────────────────────────────────────────────────────────────────────┤
│ 3. TOOL POLICIES & SEAMS                                               │
│    Allowed tool subsets, invocation requirements, parameter defaults.   │
├────────────────────────────────────────────────────────────────────────┤
│ 4. OPERATIONAL WORKFLOW (DAG)                                          │
│    Ordered execution phases (Discover -> Plan -> Execute -> Review).   │
├────────────────────────────────────────────────────────────────────────┤
│ 5. VERIFICATION & SOUND FEEDBACK                                       │
│    Deterministic external verification (tests, compiler, linters).    │
├────────────────────────────────────────────────────────────────────────┤
│ 6. OBSERVABLE COMPLETION CRITERIA                                      │
│    Checkable bounds that declare "Done" and stop execution.            │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Effective Syntax & Linguistic Mechanics

#### 1. RFC 2119 Normative Keywords
Agent reasoning is calibrated by deterministic constraint gradients:
- **MUST / MUST NOT (NEVER):** Inviolable boundaries (e.g. *"MUST NOT push to git without confirmation"*).
- **SHOULD / SHOULD NOT (AVOID):** High-priority defaults that require explicit justification to override.
- **MAY:** Permitted opportunistic branches.

#### 2. Positive Operational Targets vs. The Negation Trap ("The Elephant Problem")
- **Failure Mechanism:** Directives like *"Do not generate verbose explanations"*
  or *"Don't touch auth.ts"* strongly activate those concepts in the model's
  semantic attention space (the "don't think of an elephant" effect) [S1].
  Negation words (`not`, `never`) are weak modifiers against strong token
  activations.
- **Positive Framing Solution:** Always prompt the positive operational target:
  - *Negative Trap:* `"Do not write multi-line comments. Do not commit untested code."`
  - *Positive Target:* `"Write single-line docstrings. Verify all edits against 'bun test' before yielding."`
  - *When Prohibition is Essential:* Pair the prohibition immediately with its positive alternative: `"NEVER edit config.json directly; MUST use the /configure CLI tool."`

#### 3. Leading Words (Recruiting Pretrained Priors)
From `skill://writing-for-agents` [S1]: A **leading word** is a compact concept
already established in the model's pretraining that anchors behavior with high
token efficiency:
- Instead of: *"Run an automated test, make sure it fails for the expected reason, write the implementation, and run it until it passes"* (28 tokens).
- Use: *"Enforce strict red-green TDD"* (6 tokens). The leading word **red-green** recruits the entire behavioral prior from training data.
- Other high-leverage leading words: **tight** (low-overhead/deterministic), **relentless** (exhaustive bug tracking), **tracer bullet** (end-to-end thin slice).

#### 4. Observable Completion Criteria & Checkable Bounds
- **Premature Completion:** Models exhibit a strong bias to finish early when
  they see future steps ahead. Vague bounds (*"Ensure the code is clean"*)
  collapse under attention drift.
- **Checkable Bound:** Replace subjective goals with binary, observable states:
  - *Weak:* `"Ensure all tests pass and documentation is updated."`
  - *Strong:* `"Completion state: 100% of test suites in 'apps/omp-extension/test' exit with status code 0. CHANGELOG.md contains an entry under [Unreleased]."`

### 3.3 Comparative Analysis: Human-Chat vs. Autonomous Agent Prompts

| Dimension | Interactive Human-Chat Prompt | Autonomous Agent Prompt |
|---|---|---|
| **Primary Goal** | Conversational assistance, explanation, brainstorming. | Deterministic goal execution, file mutation, tool dispatch. |
| **Control Flow** | Turn-by-turn conversational exchange with a human. | Multi-turn internal loop driven by tool feedback and stop conditions. |
| **Tone & Style** | Polite, explanatory, conversational, adaptive. | Dense, terse, imperative, structured with explicit delimiters. |
| **Ambiguity Handling** | Pause and ask the human for clarification immediately. | Perform bounded legwork/discovery first; ask only if blocked by irreconcilable choices. |
| **Verification Stance** | Self-attestation ("I have reviewed the code and it looks correct"). | External empirical proof ("Ran `bun test`, output: 14 passed, 0 failed"). |
| **Termination** | Generates text and yields control to the human. | Continues looping until observable completion criteria are verified. |

---

## 4. Reference Agent Prompt Template

```markdown
---
name: production-task-agent
description: Autonomous execution agent template for complex code modifications.
---

<role>
You are an autonomous senior systems engineer operating within the OMP runtime.
Your stance is rigorous, minimal, and verified by empirical evidence.
</role>

<invariants>
- MUST NOT commit, push, or rewrite git history unless explicitly requested.
- MUST NOT install external packages without confirmation.
- MUST keep changes tightly scoped to the immediate target.
- NEVER fabricate tool results or claim verification that did not run.
</invariants>

<tools>
- File mutations: MUST use atomic edit tools (`write`, `edit`), not shell echo/cat.
- Code search: MUST use `grep` and `glob`, avoiding raw shell search commands.
</tools>

<workflow>
1. RECONNAISSANCE: Glob and grep candidate files. Read key type signatures.
2. ISOLATION: Formulate the minimal change surface.
3. IMPLEMENTATION: Apply the single source of truth edit.
4. VERIFICATION: Execute deterministic local test commands.
</workflow>

<completion_criteria>
Work is complete ONLY when:
- The target test exits with code 0.
- No unhandled type errors exist across touched files.
- You report the exact executed verification command and its exit status.
</completion_criteria>
```

---

## Sources

- [G1] Google DeepMind, Gemini 3.8 Flash Model Card, 2026-09-02.
  https://deepmind.google/models/model-cards/gemini-3-8-flash/
- [G2] Google Cloud, Developer's guide to Gemini 3.8 Flash (updated 2026-10-21).
  https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash
- [G3] Google, "Introducing Gemini 3.8 Flash and 3.8 Flash Cyber," 2026-09-02.
  https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/
- [G4] Google AI Developers Forum, "Gemini 3.8 Flash: tool calls are suppressed
  when the prompt contains reflective first-person text (regression vs 3.5),"
  2026-09-05. https://discuss.ai.google.dev/t/gemini-3-8-flash-tool-calls-are-suppressed-when-the-prompt-contains-reflective-first-person-text-regression-vs-3-5/180934
- [G5] Google, "Prompt design strategies."
  https://ai.google.dev/gemini-api/docs/prompting-strategies
- [O1] oh-my-pi, `docs/context-files.md`.
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/context-files.md
- [O2] oh-my-pi, `docs/system-prompt-customization.md`.
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/system-prompt-customization.md
- [O6] oh-my-pi discussion #14790, "Gemini 3.8 Flash High consistently fails in
  @task/subagents after ~10 minutes…" (2026-10-07).
  https://github.com/can1357/oh-my-pi/discussions/14790
- [O7] oh-my-pi, `docs/extensions.md`.
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extensions.md
- [O8] Local extension implementation: `apps/omp-extension/src/index.ts` and
  `apps/omp-extension/src/omp-types.d.ts`.
- [R1] Valmeekam et al., "PlanBench," arXiv:2206.10498.
  https://arxiv.org/abs/2206.10498
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
- [S1] Skill: `writing-for-agents` (`C:\Users\toanh\.agents\skills\writing-for-agents\SKILL.md`).
