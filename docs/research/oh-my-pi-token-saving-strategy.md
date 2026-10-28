# Research Report: Oh-My-Pi Developer Community Token Saving Strategies

**Date:** 2026-10-28  
**Subject:** Upstream developer discussions, issue tracker retrospectives, pull requests, and architectural specifications from [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi) (`omp`) on minimizing token consumption, optimizing context lifetime, and maximizing prompt caching.

---

## 1. Executive Summary

In autonomous AI agent runtimes like `oh-my-pi` (`omp`), token expenditure is dominated not by the user's initial prompt, but by **multi-turn tool feedback accumulation** (reading files, executing bash commands, inspecting LSP diagnostics, and carrying conversational history across hours of work).

The upstream OMP developer community treats token optimization not as a single configuration switch, but as a **cohesive six-pillar systems architecture**:

```
                                  OMP TOKEN OPTIMIZATION ARCHITECTURE
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Prefix Stability & KV Cache  │ Byte-stable prefixes; rolling cache breakpoints; 75-90% read cut │
│ 2. Hierarchical Compaction      │ context-full, /shake, snapcompact; first-class CompactionEntry   │
│ 3. Tool Spilling & Range I/O    │ artifact:// offloading; exact line ranges; truncated summaries   │
│ 4. Prompt Hierarchy Hygiene     │ Zero-redundancy SYSTEM.md vs AGENTS.md; inverted prompt layout   │
│ 5. Context Sandboxing (Agents)  │ Isolated subagent context (task, scout); compact artifact return │
│ 6. Model Routing & Compute Caps │ High thinking for planning; Flash / low effort for execution     │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

By coordinating these layers, long-running agent workflows routinely achieve **70% to 90% effective cost and token reductions** compared to unmanaged agent loops.

---

## 2. Pillar 1: Prompt Caching & Prefix Stability (`applyPromptCaching`)

Prompt caching (supported across Anthropic Claude, Google Vertex/AI Studio, DeepSeek, and OpenAI) provides an automatic **75% to 90% discount on cached input tokens** and reduces time-to-first-token (TTFT). However, caching is fundamentally brittle: a single changed byte in the prompt prefix invalidates the entire downstream KV-cache.

### A. The Byte-Stable Prefix Rule
Upstream issues (`#3033`, `#11897`) document frequent "silent cache zeroing" caused by dynamic prefix mutations:
- **Anti-Pattern:** Injecting dynamic timestamps, random IDs, or changing git branch status messages into the early system prompt or first user message. Every turn breaks cache affinity, forcing the provider to bill full input token counts (`cache_write` rather than `cache_read`).
- **OMP Strategy:** Static rules (`SYSTEM.md`, `RULES.md`, core instructions) are placed strictly at the beginning of the context stream and kept 100% byte-identical across turns.

### B. Rolling Breakpoint Placement (`cache_control`)
- OMP's `applyPromptCaching` middleware mirrors modern layout contracts by injecting rolling cache breakpoints (`type: "ephemeral"`).
- **Upstream Bug Recovery (`#11897`):** When multiple context-injection extensions (e.g. `pi.on("context")`) dynamically prepend synthesized text, breakpoints land on shifting text blocks. OMP developer guidelines mandate placing cache breakpoints strictly on **immutable message boundaries** (historical user/assistant turns) rather than transient middleware injections.

### C. Session-Stable Affinity Keys (`prompt_cache_key`)
- For side turns (ephemeral `/btw` questions), compaction sub-invocations, and background agent evaluations, OMP applies `--prompt-cache-key` / session affinity headers (`#6049`, `#7218`).
- This guarantees that auxiliary queries inherit the primary session's warm KV-cache instead of re-processing hundreds of thousands of repository context tokens.

### D. Local Provider Append-Only Mode (`provider.appendOnlyContext`)
- Local inference servers (Ollama, LM Studio, llama.cpp) require append-only context formats to maintain their KV-cache slot allocations.
- Upstream fix `#3033` established explicit `appendOnlyContext: on` configuration overrides to prevent local models from needlessly recalculating prompt context from scratch on every turn.

---

## 3. Pillar 2: Hierarchical Compaction Engine (`compaction.*`)

When long-running tool loops approach the context window limit, naive truncation causes catastrophic task amnesia, while full-history retention causes context exhaustion. OMP implements a multi-tiered compaction engine:

### A. First-Class `CompactionEntry` Boundaries
Unlike chat interfaces that discard old messages as unstructured text, OMP treats compaction artifacts as typed domain objects (`packages/agent/src/compaction/`):
- Tracks `firstKeptEntryId`, `tokensBefore`, `tokensAfter`, and `method`.
- Preserves working state, active todos, decisions, and file paths while shedding intermediate command chatter.

### B. Multi-Tier Compaction Strategies

| Strategy | Command / Trigger | Operation | Token Impact |
|:---|:---|:---|:---|
| **`context-full`** | Automatic threshold trigger | Summarizes older conversational turns into a dense handoff block; maintains state boundary. | **~60% to 75% context reduction** |
| **`/shake`** | Manual or scheduled trigger | Mechanical content-elision: strips bulky tool-call inputs/outputs, unified diffs, and large stdout logs from context, converting them into URI pointers (`artifact://`). | **~50% to 80% token recovery without losing conversational continuity** |
| **`snapcompact`** | Extreme context threshold | Densely archives historical turns into compact reference structures for long-horizon sessions. | **Maximum compression for 500k+ token sessions** |
| **Branch Summarization** | Tree branch navigation (`/tree`) | Summarizes abandoned branch explorations so past attempts don't leak into the active branch. | **Prevents cross-branch context pollution** |

### C. Context Overcounting Bug Mitigations (`#2628`, `#15797`)
Upstream developer discussions solved critical pre-prompt estimation discrepancies where local estimators overcounted encrypted reasoning payloads (`thinkingSignature`, `encrypted_content`) or dropped reasoning blocks against the provider's token limit. Accurate estimation prevents premature auto-compaction and unnecessary summarization cycles.

---

## 4. Pillar 3: Tool Output Spilling & Range-Constrained I/O

The single largest source of accidental token consumption in coding agents is **unconstrained tool I/O** (e.g. running `cat giant-file.ts` or executing `git diff` that dumps 3,000 lines into context).

### A. The "Range Slicing" Invariant
OMP's tool policy strictly enforces range-based file access:
- **`read` tool selectors:** Agents must read line ranges (e.g. `path.ts:50-100` or `:raw:10-25`) rather than whole files.
- **AST outline first:** Agents query symbol declarations and line numbers before reading targeted implementation bodies, reducing 10,000-token file reads to ~200-token surgical reads.

### B. Automated Output Spilling (`artifact://`)
- Any command output exceeding configured size limits (e.g. `bash` stdout/stderr, large test dumps) is automatically intercepted by the runtime.
- The raw payload is saved to local session storage and referenced as `artifact://<id>`.
- The model receives only a truncated head/tail summary with line counts. The agent reads specific slices (`artifact://<id>:1-50`) only if necessary.

---

## 5. Pillar 4: System Prompt & Context Hierarchy Hygiene

Redundant instructions injected into every prompt turn quietly consume thousands of tokens over a session.

### A. The Context Segregation Standard
OMP separates prompt layers to avoid duplication:
1. `SYSTEM.md`: Static behavioral rules (never changes, highly cacheable).
2. `RULES.md`: Inviolable hard safety constraints (concise, always applied).
3. `AGENTS.md`: Loaded into the trailing `<project-context>` `<repo-rules>` block.
- **Upstream Guideline:** Never duplicate rules between `AGENTS.md` and the system prompt. Repeating formatting rules, role definitions, or generic guidelines across multiple context files wastes tokens on every turn.

### B. The Inverted Context Layout
Evaluations show that placing massive rules at the top causes prompt decay, while verbose conversational narration preceding tool calls burns output tokens.
- **Data first, imperative task at the very end:** Placing background data in `<context>` blocks and the concrete instruction at the prompt's conclusion increases model compliance while eliminating repetitive reasoning chatter.
- **Preamble Stripping:** Forcing the model to omit pleasantries ("Sure, I can help with that...") saves 50–150 tokens on every single tool-use turn.

---

## 6. Pillar 5: Context Sandboxing via Subagent Delegation

When an agent needs to explore a codebase, grep across 50 files, or test multiple prototype fixes, executing those loops in the primary context window bloats the conversation history beyond repair.

### A. Ephemeral Context Sandboxing
OMP provides specialized subagents (`task`, `scout`, `sonic`, `reviewer`):
- **Read-Only Scout (`agent: "scout"`):** Dispatched to investigate unknown code or search patterns. The dozens of `glob`, `grep`, and `read` tool turns execute inside the scout's own ephemeral context.
- **Compressed Handoff (`agent://<id>`):** When the subagent completes, only its structured, compressed verdict is delivered back to the lead agent.
- **Token Impact:** Keeps the primary agent's context small (~10,000–25,000 tokens), preventing long-context degradation and massive re-tokenization costs on subsequent turns.

---

## 7. Pillar 6: Model Routing & Test-Time Compute Budgeting

Different phases of software engineering have vastly different intelligence and reasoning requirements:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Planning Phase   │ High-reasoning model (e.g. o1, Claude Opus, Gemini Pro)   │
│                  │ thinking_level: HIGH · Deep analysis · Few calls            │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ Execution Phase  │ High-throughput model (e.g. Flash, Sonnet, DeepSeek)       │
│                  │ thinking_level: LOW/MEDIUM · Surgical edits · Fast & cheap  │
└────────────────────────────────────────────────────────────────────────────────┘
```

### A. Role-Based Model Aliases (`modelRoles`)
- OMP supports assigning distinct models to distinct roles (`modelRoles.plan`, `modelRoles.default`, `modelRoles.review`).
- Planning requires deep constraint discovery and synthesis, but represents <10% of total calls.
- Execution requires schema compliance and fast file edits across many turns (>90% of calls). Routing execution to high-throughput Flash/Lite tiers yields **up to 80% monetary cost reductions**.

### B. Capping Reasoning Tokens on Mechanical Tasks
- For models with test-time compute (extended thinking), reasoning tokens can quickly dominate costs (e.g., spending 8,000 thinking tokens on a 2-line lint fix).
- Setting `thinking_level: "LOW"` on mechanical refactoring and formatting tasks preserves reasoning tokens for complex algorithmic challenges.

---

## 8. Actionable Implementation Checklist for OMP Developers & Users

To maximize token savings in your daily OMP workflows, follow these developer-tested practices:

- [ ] **Verify Prompt Cache Hit Rates:** Monitor session token metrics; ensure `cache_read` tokens consistently account for >70% of total input tokens after turn 3.
- [ ] **Run `/shake` on Bloated Sessions:** If tool outputs or large diffs have expanded the context, execute `/shake` to shed output debris into artifacts without resetting conversational memory.
- [ ] **Enforce Ranged Reads:** Never read whole files (>150 lines) directly; use `read path.ts:1-60` or outline first.
- [ ] **Delegate Broad Discovery to `scout`:** Never run 15 exploratory grep/read tool calls in the main session; dispatch a `scout` subagent and ingest only the summary.
- [ ] **Audit Context Files for Duplication:** Ensure `AGENTS.md` contains only project-specific rules, with zero restatement of OMP's default tool or safety policies.
- [ ] **Tune Thinking Levels by Task:** Use `thinking_level: HIGH` during initial plan formulation; dial down to `LOW` or `MEDIUM` during file editing and unit test runs.
- [ ] **Enable `appendOnlyContext` on Local Endpoints:** If using Ollama or llama.cpp, verify that append-only context caching is active in `config.json`.
