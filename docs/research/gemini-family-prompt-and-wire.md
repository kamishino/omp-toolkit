# Gemini Family Research: Prompt Engineering Dynamics, Behavioral Quirks & Wire Protocols

*Date: 2026-10-22*  
*Scope: Family-wide investigation across Gemini 1.5, 2.0/2.5, 3.x, and 4.0 generations, comparing Flash-Lite, Flash, and Pro tiers on Problem 1 (Prompt Engineering & Quirks) and Problem 2 (Wire Protocol & Turn Constraints).*  
*Primary sources: Google DeepMind Model Cards, Google Cloud / Vertex AI Documentation, Google AI Studio Guides, Google AI Developer Forum, OMP Catalog & Upstream Architecture.*

---

## Executive Summary

1. **Family-Wide Tier Divergence (Flash vs. Pro vs. Flash-Lite):**  
   Prompt sensitivity is not uniform across Gemini. **Flash models** (1.5, 2.5, 3.7, 3.8) are optimized for high-throughput execution and low time-to-first-token; they exhibit aggressive autonomous initiative ("initiative hallucination"), struggle with conversational filler, and require **short, imperative, inverted prompt structures**. **Pro models** (1.5 Pro, 2.5 Pro, 3.1 Pro, 4.0 Argon) possess significantly denser latent world models and easily digest multi-paragraph system prompts and nested constraints, but require explicit length bounding to prevent verbose over-analysis. **Flash-Lite models** lack latent density and require few-shot demonstration examples to avoid format drift.
2. **Generational Evolution of Problem 1 (Prompting & Attention):**  
   - *Positional Decay:* Universal across all 1M–2M context Gemini models. While Pro handles needle retrieval better than Flash, all models exhibit recency bias; instructions placed at the prompt's conclusion achieve significantly higher compliance than instructions placed at the top or buried in the middle.
   - *Reflective Tool Suppression:* A generational side-effect of System 2 reasoning fine-tuning. Controlled benchmark tests prove `gemini-3.5-flash` was immune (8/8 tool calls), whereas `gemini-3.8-flash` dropped to 0/8 when presented with first-person conversational reflections.
3. **Universal Invariants of Problem 2 (Wire Protocol & Turn Sequencing):**  
   - The rejection `400 INVALID_ARGUMENT: Requests ending with a model turn are not supported` is **an API-wide structural invariant enforced across every Gemini generation and endpoint** (AI Studio, Vertex AI, and Cloud Code Assist). It occurs when tool execution fails to append a `FunctionResponse`, when client interruptions leave partial assistant text, when middleware drops developer reminders (OMP #14790), or when clients attempt model prefilling.
   - *Strict Turn Parity:* Every `FunctionCall` in a `model` turn MUST be followed immediately by a matching `FunctionResponse` in a `user` turn before another model generation can occur.
   - *Thinking Evolution:* Integer `thinking_budget` (tokens) used in 2.0/2.5 is deprecated in 3.x in favor of string enums `thinking_level: "LOW" | "MEDIUM" | "HIGH"`. Dropping thought signatures across turns causes verification failures on Google endpoints.

---

## 1. Gemini Family Taxonomy & Architectural Lineage

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             GEMINI MODEL FAMILY                                  │
├────────────────────┬────────────────────┬───────────────────┬────────────────────┤
│   Generation 1.5   │   Generation 2.x   │  Generation 3.x   │   Generation 4.x   │
├────────────────────┼────────────────────┼───────────────────┼────────────────────┤
│ • 1.5 Flash        │ • 2.0 Flash        │ • 3.1 Pro Preview │ • 4.0 Argon        │
│ • 1.5 Pro (2M ctx) │ • 2.0 Flash-Lite   │ • 3.5 Flash       │   (Frontier agent  │
│                    │ • 2.5 Flash        │ • 3.7 Flash       │    reasoning)      │
│                    │ • 2.5 Pro          │ • 3.8 Flash       │                    │
│                    │                    │ • 3.8 Flash Cyber │                    │
└────────────────────┴────────────────────┴───────────────────┴────────────────────┘
```

### Three Tier Archetypes:
1. **Pro Tier (Flagship / Deep Reasoning):**
   - High parameter density, deep analytical synthesis, multi-step hypothesis planning.
   - Best for: complex architecture planning, long-document cross-synthesis, ambiguous workflows.
2. **Flash Tier (Workhorse / Agentic Execution):**
   - Medium parameter MoE, optimized for low latency, rapid tool execution, and high token throughput.
   - Best for: deterministic code editing, command execution, tool dispatch, fast iteration.
3. **Flash-Lite Tier (Throughput / Low Cost):**
   - Smallest parameter footprint, optimized for ultra-low latency classification and high-frequency extraction.
   - Best for: session titling, routing classification, simple data extraction.

---

## 2. Problem 1 Extended: Prompt Engineering Dynamics Across the Gemini Family

### 2.1 Flash vs. Pro Behavioral Differences

| Operational Dimension | Gemini Flash Models (1.5, 2.5, 3.7, 3.8) | Gemini Pro Models (1.5 Pro, 2.5 Pro, 3.1 Pro, 4.0 Argon) |
|---|---|---|
| **Instruction Style** | **Short, direct, imperative.** Vague conversational phrasing causes the model to over-complicate or drift. | **Detailed, structured, context-rich.** Easily digests multi-paragraph constraints and deep criteria. |
| **Ambiguity Tolerance** | **Low.** Prone to "initiative hallucination" (taking unasked actions or refactoring adjacent code) when prompts lack rigid bounds. | **High.** Possesses denser latent priors; infers unstated context or asks clarifying questions before acting. |
| **Output Verbosity** | Naturally terse and direct. Must explicitly prompt for conversational styling if desired. | Naturally verbose and analytical. Requires strict length caps (e.g. `Answer in <= 2 sentences`) if brevity is needed. |
| **Tool Calling Stability** | Highly optimized for high-frequency tool loops, but sensitive to conversational text preceding the tool call. | Highly resilient to complex nested JSON schemas and multi-tool orchestration with minimal degradation. |
| **Thinking / Effort Tuning** | Requires deliberate `thinking_level` tuning (`low` for fast formatting, `high` for complex refactoring). | Automatically leverages deep reasoning paths; defaults to `HIGH` effort in 3.1 Pro / 4.0 Argon. |

### 2.2 Long-Context Positional Attention ("Lost in the Middle")

All Gemini models support massive context windows (1,048,576 to 2,097,152 tokens). However, empirical evaluations (e.g. *NoLiMa: Long-Context Beyond Literal Matching*, arXiv:2502.05167; *Lost in the Middle*, arXiv:2307.03172) demonstrate that attention is non-uniform across the context window:

1. **Primacy & Recency Asymmetry:**
   - Content placed in the first 5% (primacy) and the last 10% (recency) of the context window is recalled and adhered to with $\sim 95\%$ accuracy.
   - Content placed in the middle (between 15% and 85% depth) suffers compliance degradation, dropping to $60\%–75\%$ for complex constraints.
2. **The "Inverted Context Layout" Rule:**
   - Both Google AI Studio and Google Cloud Vertex documentation mandate the **Inverted Layout**:
     ```markdown
     [1. Context Package: Files, Diffs, Test Traces, Logs]
     (Consumes the bulky middle of the prompt)
     
     [2. Recency Anchor: "Based on the technical data above:"]
     
     [3. Imperative Task Directive]
     
     [4. Negative Invariants & Completion Bounds]
     (Placed at the absolute end to maximize recency attention)
     ```
   - While Pro models are more forgiving of scattered rules than Flash models, placing actionable instructions at the very bottom improves instruction-following consistency across all tiers.

### 2.3 The Reflective Tool Suppression Phenomenon

On the Google AI Developers Forum (`topic/180934`), a controlled evaluation uncovered a critical failure mode:
- **Test Setup:** Assistant decides whether to call a `save_note` tool.
- **Result:**
  - `gemini-3.5-flash`: Called the tool **8/8 times** across all prompt conditions.
  - `gemini-3.8-flash`: Called the tool **8/8 times** with concise context, but dropped to **0/8 times** as soon as the prompt included first-person reflective text (*"Looking back at those memories made my chest feel warm... I will keep quiet"*).
  - Explicit system instructions encouraging saving only partially recovered the behavior (**3/8**).
  - Scrubbing the model's own prior reflections restored behavior to **6/8**.

#### Why Does This Occur in Newer Models?
- Newer Gemini models (3.x and reasoning-tuned variants) incorporate heavy Reinforcement Learning on agentic dialogue traces.
- When the conversation history contains first-person reflective prose, the model's self-attention mimics the persona of a passive observer ("I'll just keep this to myself"), overriding the system prompt's tool-trigger instructions.
- **Family-Wide Mitigation:**
  1. Do not use conversational or reflective prompts for Gemini agents.
  2. Frame roles in third-person technical stance (*"System: Automated software execution agent. Next action: Execute tool 'read'"*).
  3. In multi-turn harnesses, scrub internal thought monologs from past assistant turns before sending history to the API.

---

## 3. Problem 2 Extended: Wire Protocol, Message Formatting & Turn Sequence Constraints

### 3.1 Endpoint Architectures & Provider Dialects

Gemini models are consumed across four primary API architectures, each with distinct wire requirements:

| Provider / Transport | Wire Format | Multi-Turn Key | Function Calling Key | Key Protocol Characteristic |
|---|---|---|---|---|
| **Google Generative AI** (AI Studio / `v1beta`) | Native Google REST / gRPC | `contents: [{ role, parts }]` | `functionCall` / `functionResponse` | Roles: `"user"`, `"model"`. Strict turn alternation enforced. |
| **Google Cloud Vertex AI** (`aiplatform.googleapis.com`) | Enterprise Google REST / gRPC | `contents: [{ role, parts }]` | `functionCall` / `functionResponse` | Enterprise security gates, region routing, strict schema enforcement. |
| **Google Cloud Code Assist** (`daily-cloudcode-pa` / Antigravity) | Internal SSE stream | `contents: [{ role, parts }]` | Native tool call dispatch | Fixed effort routing (`-low`, `-medium`, `-high`), OAuth account pinning. |
| **OpenAI-Compatible Proxies** (LiteLLM, OpenRouter, CLIProxyAPI) | OpenAI Chat Completions / Responses | `messages: [{ role, content, tool_calls }]` | `tool_calls` / `role: "tool"` | Proxy translates OpenAI schema to Gemini schema. Translation bugs frequently occur at turn boundaries. |

---

### 3.2 The Universal Invariant: "Requests ending with a model turn are not supported"

The error `400 INVALID_ARGUMENT: Requests ending with a model turn are not supported` is **universal across the entire Gemini family**. It is rejected by Google's gateway parser before any model weights are loaded.

#### Four Root Causes Across Agent Systems:

1. **Incomplete Tool Cycle:**
   ```json
   // ❌ INVALID: Model emitted a function call, but no tool response was appended
   "contents": [
     { "role": "user", "parts": [{ "text": "Check build status" }] },
     { "role": "model", "parts": [{ "functionCall": { "name": "check_build", "args": {} } }] }
   ]
   ```
   *Rule:* A `model` turn containing a `functionCall` MUST be followed by a `user` (or `function`) turn containing the `functionResponse` before another model call can be made.

2. **User Barge-In / Interruption:**
   In interactive agents, if a user interrupts an ongoing turn or an error aborts generation mid-stream, the partial assistant response must **not** be saved as the trailing turn. Either discard the aborted turn or append a user continuation message.

3. **Subagent Completion / Middleware Message Drops (OMP #14790):**
   In OMP's `@task` subagent runner, when a child agent completes work with text, OMP's runner injects a `developer` reminder to force another step. Downstream OpenAI-to-Gemini converters drop the unrecognized `developer` role, leaving the payload terminating with the preceding `assistant` message. Gemini receives a trailing `model` turn and throws `400`.

4. **Prefilled Assistant Turns:**
   Unlike some open-weights models that permit prefilling the assistant's response (e.g. injecting `{"role": "assistant", "content": "```json"}` to force formatting), **Gemini strictly forbids prefilled model turns**.

---

### 3.3 Strict `FunctionCall` and `FunctionResponse` Schema Rules

1. **Exact 1:1 Identity Matching:**
   - Every `functionCall` must have a corresponding `functionResponse` in the next turn.
   - The `name` field in `functionResponse` must match the `name` in `functionCall` character-for-character.
   - In newer Gemini versions (2.5, 3.x), the `id` (call ID) must also match exactly.
2. **Pre-Tool Text Formatting:**
   - Emitting raw explanatory prose before a tool call (e.g. `"I will now edit the file..."` followed by `FunctionCall`) can trigger `Malformed_Function_Call` errors on strict Vertex endpoints.
   - Google recommends passing pre-tool status updates inside a dedicated `update()` tool call or stripping leading text from the function call payload.

---

### 3.4 Thinking Levels & Parameter Deprecation

```text
Generation 2.0 / 2.5:  thinking_budget: 1024 (integer token count)
                                  │
                                  ▼
Generation 3.x / 4.x:  thinking_level: "LOW" | "MEDIUM" | "HIGH"
                       (integer thinking_budget deprecated)
```

1. **Thinking Level Semantics:**
   - `LOW`: Fast execution, reduced token overhead, minimal hypothesis exploration. Best for strict format extraction, linting, and short edits.
   - `MEDIUM`: Balanced default.
   - `HIGH`: Deep multi-step reasoning, extensive internal search. Best for complex code planning, multi-file refactoring, and math/logic analysis.
   - *Note:* In Gemini 3.8 Flash, `MINIMAL` is unsupported and will fail validation.
2. **Thought Signatures:**
   - In Gemini 2.x/3.x, responses generated with thinking include encrypted/signed thought tokens.
   - If an agent framework alters, truncates, or drops these thought signatures between multi-turn interactions, Google's backend rejects subsequent calls with signature verification errors.
3. **Deprecated Parameters on Reasoning Models:**
   - Passing `temperature`, `top_p`, or `top_k` on Gemini 3.x/4.x reasoning models is ignored by the backend.
   - Passing `frequency_penalty`, `presence_penalty`, or `candidate_count` on Gemini 3.8 throws active API validation errors.

---

## 4. Architectural Compatibility & Prompt Guidelines Matrix

| Model Tier / Version | Optimal Role | Best Prompt Pattern | Critical Invariant to Enforce | Primary Wire Watchout |
|---|---|---|---|---|
| **Gemini 1.5 Flash** | Fast Classification / Triage | Short prompt with 1–2 few-shot examples | Inverted layout; data first | Prone to pre-tool conversational commentary |
| **Gemini 1.5 Pro** | Long-Doc Analysis (2M context) | Detailed structured Markdown | Explicit length cap to prevent verbosity | High latency on large prompts |
| **Gemini 2.5 Flash** | Tool Execution / Fast Coding | Inverted layout + XML tags | Pair negative bounds with positive actions | Thought signatures must be preserved across turns |
| **Gemini 2.5 Pro** | Deep Planning / Analysis | Step-by-step hypothesis breakdown | Structured output schema | Integer `thinking_budget` tuning |
| **Gemini 3.5 Flash** | General Tool Use | Standard imperative prompt | Clean tool definitions | Highly stable tool use (immune to reflective suppression) |
| **Gemini 3.8 Flash** | Long-Horizon Coding & Agents | Inverted layout + Third-person framing | Suppress pre-tool chatter; no reflective history | Never terminate history on model turn; `thinking_level` string enum |
| **Gemini 4.0 Argon** | Complex Architecture Planning | Comprehensive RFC 2119 contract | Define checkable completion bounds | Deprecated sampling parameters throw active errors |

---

## 5. Sources

- [G1] Google DeepMind, *Gemini 3.8 Flash Model Card*, September 2026.  
  https://deepmind.google/models/model-cards/gemini-3-8-flash/
- [G2] Google Cloud, *Developer's Guide to Gemini 3.8 Flash*, October 2026.  
  https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash
- [G3] Google, *Introducing Gemini 3.8 Flash and 3.8 Flash Cyber*, September 2026.  
  https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/
- [G4] Google AI Developers Forum, *Gemini 3.8 Flash: tool calls are suppressed when the prompt contains reflective first-person text*, September 2026.  
  https://discuss.ai.google.dev/t/gemini-3-8-flash-tool-calls-are-suppressed-when-the-prompt-contains-reflective-first-person-text-regression-vs-3-5/180934
- [G5] Google, *Prompt Design Strategies for Gemini Models*, Google AI for Developers.  
  https://ai.google.dev/gemini-api/docs/prompting-strategies
- [G6] Google, *Generate Content API Overview & Gemini 3 Architecture*, Google AI for Developers.  
  https://ai.google.dev/gemini-api/docs/generate-content/gemini-3
- [G7] Google Cloud, *Expanding Gemini 2.5 Flash and Pro Capabilities*, Cloud Blog.  
  https://cloud.google.com/blog/products/ai-machine-learning/expanding-gemini-2-5-flash-and-pro-capabilities
- [O1] OMP Upstream, *Context Files Discovery & Hierarchy*, `docs/context-files.md`.  
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/context-files.md
- [O2] OMP Upstream, *System Prompt Customization & Block Assembly*, `docs/system-prompt-customization.md`.  
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/system-prompt-customization.md
- [O6] OMP GitHub Community, *Discussion #14790: Gemini 3.8 Flash High fails in subagents with "Requests ending with a model turn are not supported"*.  
  https://github.com/can1357/oh-my-pi/discussions/14790
- [O7] OMP Upstream, *Extensions Runtime Specification & Lifecycle Hooks*, `docs/extensions.md`.  
  https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extensions.md
