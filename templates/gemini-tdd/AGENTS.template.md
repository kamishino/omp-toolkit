# Gemini-3.8-Flash TDD Feature Development Contract

## Model Role & Calibration

```yaml
# Recommended: Gemini 3.8 Flash with high thinking level for TDD architecture
modelRoles:
  default: google-antigravity/gemini-3.8-flash:high
  plan: google-antigravity/gemini-3.8-flash:high
```

- Operational stance: Automated Test-Driven Software Engineer. Third-person framing.
- Thinking level: Use `:high` for interface design, test authoring, and red-to-green implementation; drop to `:low` only for trivial mechanical edits.

## Core Architectural Invariants (Gemini Levers)

1. **Inverted Context Layout:**
   - Always position technical context, file slices, schemas, and diagnostics in an opening `<context>` block.
   - Position the imperative directives inside `<task>` and explicit constraints inside `<invariants>` at the bottom of the prompt.
2. **Pre-Tool Chatter Redirection:**
   - Emit tool calls immediately without conversational preamble, setup explanations, or polite commentary ("I will now...", "Let me check...").
3. **Paired Negative Bounding:**
   - Pair every negative constraint (`MUST NOT touch X`) with its explicit positive operational target (`MUST touch ONLY Y`).

## Strict Red-Before-Green Execution Loop

Every feature modification, bug fix, or behavioral change MUST follow the non-negotiable 5-step TDD cycle:

```text
[Step 1: Public Seam] -> [Step 2: Red Test] -> [Step 3: Green Code] -> [Step 4: Refactor] -> [Step 5: Full Gate]
```

### Step 1: Public Seam Agreement
- Before writing any code, locate or define the confirmed public contract or interface seam.
- Identify the exact module boundary: input parameters, return types, and failure states.

### Step 2: Red (Failing Test First)
- Write the narrowest deterministic, isolated unit test in `<name>.test.ts` directly colocated beside the target file.
- Execute the test immediately (`bun test <path>`).
- **Hard Gate:** Observe and verify the test fails with the expected assertion failure or compile diagnostic. MUST NOT proceed to implementation without observing an actual failure.

### Step 3: Green (Minimal Implementation)
- Write the minimal production code necessary to turn the failing test green.
- MUST NOT introduce speculative features, unsolicited abstractions, extra configuration flags, or unused helpers.
- Execute the test immediately (`bun test <path>`).
- Verify the test passes cleanly (0 failures).

### Step 4: Refactor & Clean Cutover
- Clean up duplication, improve readability, and adhere to project idioms.
- Default to clean cutover: migrate all callers, remove obsolete code, delete temporary shims.
- Re-run the colocated test to confirm it remains green.

### Step 5: Full Monorepo Check Gate
- Execute the repository's full check gate:
  ```bash
  bun run check
  ```
- Verify formatting, linting, TypeScript compilation, complete test suite, and design tokens all pass.

## Git Commit Protocol
- When asked to commit, use atomic conventional commits (`type(scope): subject`, <= 72 chars, imperative mood).
- Commit scope MUST match the touched subsystem (`feat(core): ...`, `test(gateway): ...`, `docs: ...`).
