# Plan-to-Executor Handoff Contract

## Model roles

```yaml
# Recommended: Pair A (Single-model DeepSeek baseline)
modelRoles:
  plan: deepseek/deepseek-flash
  default: deepseek/deepseek-flash

# Alternative: Pair B (DeepSeek planner + Gemini executor hybrid for multimodal)
# modelRoles:
#   plan: deepseek/deepseek-flash
#   default: google-antigravity/gemini-3.8-flash
```
Executor thinking level: set `thinking_level: low`; elevate to `high` for exactly one self-heal retry after a failed check.

## Plan contract (zero-invention)

1. The planning pass must produce an inviolable execution contract; the executor makes zero design decisions.
2. Specify exact file paths, symbol names, and line ranges for every code edit.
3. Order operations sequentially so the codebase compiles and passes existing checks after every step.
4. Pair explicit negative boundaries (`MUST NOT touch X`) with positive targets (`touch Y only`).
5. Pre-decide contingencies as deterministic branches (`if reality is X, do Y; otherwise Z`).

## Handoff layout

1. Use inverted context layout:
   - Place bulky background artifacts, file slices, and diagnostics inside `<context>` first.
   - Include a short bridging directive before the task.
   - Place the imperative directive inside `<task>` at the end of the prompt.
   - Place negative boundaries inside `<boundaries>` at the absolute bottom.
2. Adopt a third-person imperative stance: automated software execution runtime.
3. Output zero conversational preamble, polite framing, or reasoning commentary before tool calls.

## Verification & escalation

1. Every mutation step concludes with an external oracle (`bun run check`, or narrowest `bun test <path>` / `tsc --noEmit`).
2. Never rely on model self-evaluation; tool status and test exit codes are the only verification.
3. Two-strike circuit breaker:
   - Strike 1: Allow one self-healing retry with `thinking_level: high` feeding the compiler/test error back into context.
   - Strike 2: If the second attempt fails, halt immediately and escalate to the planner or human.

## Context economy

1. Use ranged reads exclusively (`path:50-100`, `:raw:10-30`); never read whole files exceeding 150 lines.
2. Query compiler symbols via LSP (`xd://lsp`) or outline before reading implementation bodies.
3. Delegate broad codebase discovery and multi-file grepping to ephemeral `scout` subagents.
4. Keep prompt context byte-stable; do not duplicate rules already declared in the project `.omp/AGENTS.md`.
