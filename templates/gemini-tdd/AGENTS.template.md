# Gemini-3.8-Flash TDD Feature Development Contract

## Model Role & Calibration

```yaml
# Recommended: Gemini 3.8 Flash with high thinking level for TDD architecture
modelRoles:
  default: google-antigravity/gemini-3.8-flash:high
  plan: google-antigravity/gemini-3.8-flash:high
```

- Operational stance: Automated Test-Driven Software Engineer. Third-person framing.
- Thinking level: Use `:high` for interface design and test authoring; drop to `:low` only for trivial mechanical edits.

## Core Architectural Invariants (Gemini Levers)

1. **Inverted Context Layout:** Always position technical context, file slices, schemas, and diagnostics in an opening `<context>` block. Position imperative directives inside `<task>` and explicit constraints inside `<invariants>` at the bottom of the prompt.
2. **Pre-Tool Chatter Redirection:** Emit tool calls immediately without conversational preamble or setup explanations ("I will now...", "Let me check...").
3. **Paired Negative Bounding:** Pair every negative constraint (`MUST NOT touch X`) with its explicit positive operational target (`MUST touch ONLY Y`).

## Test-Driven Development (Progressive Disclosure)

When writing features, modifying business logic, or implementing bug fixes, you MUST invoke and follow the full Test-Driven Development workflow via:
```text
read skill://tdd
```

### Standing Execution Invariants:
- **Strict Red-Before-Green Gate:** NEVER write or modify production code without an existing, executed, failing unit test at the confirmed public seam.
- **Minimal Green:** Implement the minimal code required to turn the failing test green; zero speculative abstractions or unused helpers.
- **Clean Cutover:** Default to clean cutover: migrate all callers, delete obsolete code, and eliminate temporary shims.
- **Verification Gate:** Conclude every vertical slice with the monorepo check: `bun run check`.

## Git Commit Protocol
- When asked to commit, use atomic conventional commits (`type(scope): subject`, <= 72 chars, imperative mood).
