# Practical Implementation Blueprint: Prompt Engineering, Extension Hooks & Agent Evaluation

*Date: 2026-10-22*  
*Purpose: Consolidated practical specifications transferring theoretical research into actionable components. This file is intentionally left untracked in Git for review.*

---

## Overview of Practical Components

This blueprint translates the research findings into four concrete, modular implementation specifications:

1. **Section 1: Gemini 3.8 Flash Prompt Engineering Reference & Skill Blueprint**  
   A drop-in skill specification and template enforcing Inverted Context Layout, anti-suppression framing, pre-tool chatter stripping, and paired negative invariants.
2. **Section 2: OMP Extension Wire Normalizer Source Code Specification**  
   A TypeScript module ready for `apps/omp-extension` (or `~/.omp/agent/extensions/`) that intercepts `before_provider_request` to fix model-final turn API rejections and historical reflective thought suppression.
3. **Section 3: Project-Level `.omp/AGENTS.md` Specification for `omp-toolkit`**  
   The authoritative project context file establishing domain boundaries, test commands, and design token invariants for this repository.
4. **Section 4: 2×2 Model Role Empirical Evaluation Protocol**  
   A reproducible test suite and measurement rubric to evaluate DeepSeek vs. Gemini in planning and execution roles across 5 representative tasks.

---

## Section 1: Gemini 3.8 Flash Prompt Engineering & Skill Specification

### 1.1 Structural Prompt Template: Inverted Context Layout

Use this pattern when issuing complex tasks to `Gemini-3.8-Flash (High)`:

```markdown
<!-- STEP 1: CONTEXT & LARGE ARTIFACTS (FIRST) -->
<context>
File: packages/core/src/dashboard.ts
```typescript
export interface DashboardRow {
  provider: string;
  account: string;
  status: string;
}
```

File: apps/provider-usage/src/index.ts
```typescript
import { DashboardRow } from "@omp-toolkit/core";
// ...
```

Failure Logs:
```text
TypeError: Cannot read properties of undefined (reading 'status')
  at renderRow (packages/tui/src/table.ts:42:15)
```
</context>

<!-- STEP 2: RECENCY BRIDGING PHRASE -->
Based on the code context and failure logs provided above:

<!-- STEP 3: CONCRETE IMPERATIVE TASK & BOUNDS (VERY END) -->
<task>
Fix the null-dereference in `packages/tui/src/table.ts` when a dashboard row lacks status metadata.
</task>

<invariants>
- MUST NOT modify public type signatures in `packages/core/src/dashboard.ts`.
- MUST use the `edit` tool to apply changes; DO NOT use shell scripts or `sed`.
- MUST verify the fix with `bun test packages/tui/src/table.test.ts`.
- Call tools immediately without introductory conversational pleasantries or explanations.
</invariants>
```

---

### 1.2 Drop-in Skill Definition

Save to: `.agents/skills/gemini-prompt-optimizer/SKILL.md` (or `~/.agents/skills/gemini-prompt-optimizer/SKILL.md`)

```markdown
---
name: gemini-prompt-optimizer
description: Transforms and structures prompts for Gemini 3.8 Flash (High) and other agentic models using inverted layouts, pre-tool chatter suppression, anti-suppression framing, and checkable bounds.
license: MIT
---

# Gemini Prompt Optimizer: Agent-Friendly Prompt Transformation

Use this skill to refactor loose, conversational user requests into deterministic execution contracts tailored for Gemini 3.8 Flash (High).

## 1. Transformation Pipeline

When presented with a task or raw prompt:

1. **Extract Background:** Pull file paths, stack traces, schema definitions, and docs into a `<context>` block.
2. **Extract Invariants:** Isolate all constraints, negative boundaries, and forbidden actions into `<invariants>` using RFC 2119 keywords (`MUST`, `NEVER`).
3. **Define Observable Completion:** Replace subjective goals with binary verification commands.
4. **Enforce Order:** Output `<context>` first, followed by `<task>`, `<invariants>`, and `<completion_criteria>` at the very bottom.
5. **Strip Preamble:** Instruct the model to suppress conversational narration before invoking tools.

## 2. Transformation Rules

- **Anti-Suppression Rule:** Replace first-person phrasing ("I noticed that maybe we should check...") with third-person imperative commands ("Inspect file X using tool `read`").
- **Paired Negative Bounding:** Never state a bare negative constraint. Pair every prohibition with its allowed positive alternative:
  - *Bad:* `Do not edit config.json.`
  - *Good:* `NEVER edit config.json directly; MUST use 'bun run configure'.`
- **Thinking Level Directive:** Specify `:high` for architectural changes and `:low` for deterministic formatting.
```

---

## Section 2: OMP Extension Wire Normalizer Code Specification

### 2.1 Problem Solved
1. **OMP Discussion #14790:** Subagents (`@task`) using Gemini 3.8 Flash fail after ~10 minutes with `Requests ending with a model turn are not supported`. When an assistant turn completes with plain text and no tool call, OMP's subagent wrapper injects a developer reminder that downstream converters drop, leaving the request terminating on a `model` turn.
2. **Google Developer Forum #180934:** Reflective, conversational text in multi-turn history suppresses tool calls (0/8 benchmark pass). Scrubbing internal reflective traces restores tool-calling behavior (6/8 pass).

---

### 2.2 TypeScript Implementation: `apps/omp-extension/src/gemini-normalizer.ts`

```typescript
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

interface WireMessage {
  role: "user" | "assistant" | "model" | "system" | "developer";
  content?: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  function_call?: unknown;
  tool_calls?: unknown[];
}

interface ProviderPayload {
  model?: string;
  messages?: WireMessage[];
  contents?: Array<{ role: string; parts: Array<{ text?: string; [key: string]: unknown }> }>;
  [key: string]: unknown;
}

/**
 * Normalizes message histories and payloads for Google / Gemini endpoints.
 */
export function registerGeminiNormalizer(pi: ExtensionAPI): void {
  // Hook wire payload immediately before dispatch
  pi.on("before_provider_request", (event, ctx: ExtensionContext) => {
    const payload = event.payload as ProviderPayload;
    if (!payload) return payload;

    const providerId = ctx.model?.provider ?? "";
    const modelId = ctx.model?.id ?? "";

    // Target Google Antigravity, Google Gemini CLI, and Google Generative AI
    const isGemini =
      providerId.includes("google") ||
      providerId.includes("gemini") ||
      modelId.includes("gemini-3.8");

    if (!isGemini) return payload;

    // 1. OpenAI / Responses compatible wire schema (payload.messages)
    if (Array.isArray(payload.messages) && payload.messages.length > 0) {
      payload.messages = normalizeMessagesArray(payload.messages);
    }

    // 2. Native Google Generative AI wire schema (payload.contents)
    if (Array.isArray(payload.contents) && payload.contents.length > 0) {
      payload.contents = normalizeContentsArray(payload.contents);
    }

    return payload;
  });
}

function normalizeMessagesArray(messages: WireMessage[]): WireMessage[] {
  if (messages.length === 0) return messages;

  const cleaned = [...messages];

  // Fix 1: Ensure request never ends with an assistant / model turn (Fixes OMP #14790)
  const last = cleaned[cleaned.length - 1];
  if (last.role === "assistant" || last.role === "model") {
    // If the last message is a model turn with no tool calls, append an empty continuation trigger
    cleaned.push({
      role: "user",
      content: "Continue and complete the pending task step.",
    });
  }

  // Fix 2: Scrub reflective first-person monologue from historical turns (Fixes Forum #180934)
  for (let i = 0; i < cleaned.length - 1; i++) {
    const msg = cleaned[i];
    if (msg.role === "assistant" && typeof msg.content === "string") {
      msg.content = scrubReflectiveMonologue(msg.content);
    }
  }

  return cleaned;
}

function normalizeContentsArray(
  contents: Array<{ role: string; parts: Array<{ text?: string; [key: string]: unknown }> }>,
): Array<{ role: string; parts: Array<{ text?: string; [key: string]: unknown }> }> {
  if (contents.length === 0) return contents;

  const cleaned = [...contents];
  const last = cleaned[cleaned.length - 1];

  // Prevent requests terminating on model turn
  if (last.role === "model") {
    cleaned.push({
      role: "user",
      parts: [{ text: "Proceed with the required action." }],
    });
  }

  return cleaned;
}

function scrubReflectiveMonologue(text: string): string {
  // Strip reflective thoughts like "Looking back at those memories made my chest warm..."
  // Retain concrete factual decisions and tool references
  return text
    .replace(/Looking back at .*?\./gi, "")
    .replace(/It is my free time.*?(\.\s|\n)/gi, "")
    .replace(/I will watch over them quietly.*?(\.\s|\n)/gi, "")
    .trim();
}
```

---

### 2.3 Wiring into `apps/omp-extension/src/index.ts`

Add to `apps/omp-extension/src/index.ts`:

```typescript
import { registerGeminiNormalizer } from "./gemini-normalizer";

export default function (pi: ExtensionAPI) {
  // Register Gemini wire protocol normalizer
  registerGeminiNormalizer(pi);

  // Existing route health and warm-up logic...
}
```

---

## Section 3: Project-Level `.omp/AGENTS.md` Specification

Save to: `.omp/AGENTS.md` in repository root.

```markdown
# OMP Toolkit — Project Agent Conventions

## 1. Monorepo Architecture & Seams
- `packages/core`: Pure domain logic only. Zero I/O, zero network, zero process calls, zero ANSI escapes.
- `packages/tui`: Terminal presentation layer. Consumes `core` and `design/tokens.json`.
- `apps/provider-usage`: CLI adapter for usage aggregation and watch loop. Outputs JSON or TUI.
- `apps/omp-extension`: OMP runtime hooks, health circuit breaker, and Gemini route normalizers.
- `apps/desktop`: Electron tray widget, IPC bridge, and autostart login items.

## 2. Design Tokens & Styling SSOT
- All colors and thresholds MUST bind strictly to `design/tokens.json`.
- Zero raw hex values (`#fff`) or hard-coded RGB literals in presentation components.
- Contrast gate: maintain APCA |Lc| >= 60 for text elements.

## 3. Verification & Check Gate
- Standard check command: `bun run check`
  - Runs Biome formatting/linting, TypeScript compilation across root and apps/desktop, test suite, and token validation.
- Unit testing: `bun test`
  - Tests must be deterministic, isolated, and fast.

## 4. Operational Boundaries
- Never commit or push to git unless explicitly asked by the user.
- Avoid introducing third-party runtime dependencies without explicit approval.
```

---

## Section 4: 2×2 Model Role Empirical Evaluation Protocol

### 4.1 Evaluation Setup
Run these tests across the 4 candidate model configurations to determine optimal `modelRoles.plan` and `modelRoles.default` assignments:

- **Pair A (Single-model DeepSeek):**
  - `plan`: `deepseek/deepseek-flash:max`
  - `default`: `deepseek/deepseek-flash:max`
- **Pair B (Proposed Hybrid):**
  - `plan`: `deepseek/deepseek-flash:max`
  - `default`: `google-antigravity/gemini-3.8-flash:high`
- **Pair C (Reverse Hybrid):**
  - `plan`: `google-antigravity/gemini-3.8-flash:high`
  - `default`: `deepseek/deepseek-flash:max`
- **Pair D (Single-model Gemini):**
  - `plan`: `google-antigravity/gemini-3.8-flash:high`
  - `default`: `google-antigravity/gemini-3.8-flash:high`

---

### 4.2 Benchmark Tasks (5 Real Workflows)

| Task ID | Domain | Task Description | Success Assertion |
|---|---|---|---|
| **T1: Diagnostic** | Core / TUI | Add null-safety to `packages/tui/src/table.ts` when a provider balance report lacks currency metadata. | `bun test` passes; 0 unhandled exceptions. |
| **T2: CLI Flag** | Provider Usage | Add a `--compact` CLI boolean flag to `apps/provider-usage` that renders one-line summary rows. | Flag parsed correctly; unit test validates output format. |
| **T3: IPC Refactor** | Desktop / Core | Add an IPC channel in `apps/desktop/src/ipc.ts` to query active Gemini account cooldowns. | TypeScript typecheck passes; IPC handler returns typed payload. |
| **T4: Route Health** | Extension | Add an optional timeout parameter to `apps/omp-extension/src/index.ts` probe calls. | Probe exits within configured timeout; unit test passes. |
| **T5: Docs Sync** | Documentation | Update `docs/architecture.md` with the new desktop widget IPC seams. | Markdown format passes `biome check`; accurate file paths cited. |

---

### 4.3 Measurement Rubric & Scorecard

For each pair, record the metrics in this scorecard:

| Metric | Pair A (DeepSeek/DeepSeek) | Pair B (DeepSeek/Gemini) | Pair C (Gemini/DeepSeek) | Pair D (Gemini/Gemini) |
|---|---|---|---|---|
| **Plan Acceptance Rate** (accepted without refine) | % | % | % | % |
| **First-Pass Solve Rate** (tests pass on first turn) | % | % | % | % |
| **Average Tool Turns per Task** | count | count | count | count |
| **Pre-Tool Chatter / Syntax Retries** | count | count | count | count |
| **Total Tokens Consumed** (Input / Output / Reasoning) | tokens | tokens | tokens | tokens |
| **Total Cost per 5 Tasks** | $ | $ | $ | $ |
| **Wall-Clock Duration** | minutes | minutes | minutes | minutes |

### Decision Threshold:
- Keep **Pair B** (DeepSeek plan + Gemini exec) **ONLY IF**:
  1. Pair B's First-Pass Solve Rate is greater than or equal to Pair A.
  2. The team actively leverages Gemini's multimodal audio/video/document tools.
- Otherwise, adopt **Pair A** (DeepSeek for both) for lowest cost ($0.26/task) and highest execution throughput (203 tok/s).
