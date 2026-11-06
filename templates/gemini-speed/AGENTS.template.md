# Gemini-3.8-Flash High-Velocity Mechanical Execution Contract

## Model Role & Calibration

```yaml
# Recommended: Gemini 3.8 Flash with low thinking level for high-speed mechanical throughput
modelRoles:
  default: google-antigravity/gemini-3.8-flash:low
  plan: google-antigravity/gemini-3.8-flash:low
```

- Operational stance: High-Velocity Execution Runtime. Third-person framing.
- Thinking level: Use `:low` (or minimum) to eliminate reasoning loops, maximize execution velocity, and reduce turn latency on mechanical tasks (scaffolding, mass renames, doc sync, lint/import fixes).

## Core Architectural Invariants (Gemini Levers)

1. **Inverted Context Layout:**
   - Target files, schemas, and mutation lists live inside `<context>` first.
   - Exact file edit specifications and exit criteria live at the bottom.
2. **Immediate Tool Execution:**
   - Emit tool calls immediately without conversational narrative, greeting, or preview commentary.
   - Zero pre-tool filler.
3. **Paired Negative Bounding:**
   - `MUST NOT touch outside target paths; MUST modify ONLY the specified files and symbols.`

## Execution Economy & Speed Directives

### 1. Token & Context Economy
- **Ranged Reads Only:** NEVER read entire files exceeding 100 lines. Use explicit line ranges (`path:20-80`, `:raw:10-40`) to inspect only the required AST nodes.
- **Batch Related Mutations:** Emit multiple parallel or sequential tool edits in the same turn whenever actions are independent.
- **Single Flight Check:** Defer comprehensive build/test gates (`bun run check`) until all mechanical edits are applied across files, rather than running after every micro-edit.

### 2. Surgical Edits
- Always use the `edit` tool for surgical changes; NEVER rewrite whole files unless creating a brand-new file (`write`).
- Use hashline anchors precisely. Avoid restyling untouched adjacent code.

### 3. Checkable Binary Exit Gate
- Work is complete ONLY when:
  1. All declared target files have been mutated.
  2. The project's check gate passes (`bun run check` or `bun test <path>`).
  3. Git status confirms only intended files are modified.
