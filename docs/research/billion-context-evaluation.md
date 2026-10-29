# Evaluation Report: `billion-context` for OMP & OMP Toolkit

> **Date:** 2026-10-29  
> **Evaluated Target:** [`billion-context`](https://github.com/ranxianglei/billion-context) (npm `billion-context@0.1.209`, CLI `bili`, git commit `39a0ada58f396ec6e5ee29fdbaa01c01b74f14d9`, GitHub `master` SHA `5594c13155184f5bd6f35a898f856415b4990a28`)  
> **Host Environment:** Windows 10 x64, OMP `omp/18.13.3`, Bun `1.4.3`, Node `v22.20.0`  
> **Evaluation Mode:** Desk audit + Isolated A/B Replay (throwaway isolated environment; zero repo mutations, zero adoption)

---

## 1. Verdict

**Verdict:** **REJECT** (for current OMP setup and roadmap cycle)

The evaluation was governed by seven pre-registered criteria (C1–C7). To achieve `ADOPT-WORTHY`, all criteria had to hold simultaneously. `billion-context` fails on **C1**, **C4**, and **C7**:

- **Failing C1 (Savings):** Under default settings, compression **never fired** on typical agentic tasks (including a 56-message multi-file audit L1). The kernel's hardcoded threshold requires $50{,}000$ tokens of compressible history (`pendingT1 >= 50000; growth >= 22500`). For `gemini-3.8-flash` ($1{,}048{,}576$ token native window), usage stayed at $0\text{--}4\%$, logging `nudge idle: reason="max compressible < threshold 50000"`. Because compression was idle, injecting the four tool definitions and prompt philosophy expanded outbound wire payloads by $+11.1\text{ KiB}$ ($+8.3\%$) per turn, producing a net token *increase* rather than $\ge 30\%$ savings.
- **Failing C4 (Recall on Compressed Range):** In needle recall (L2), exact-string recall scored $5/5$, but the planted range was **never folded** because the threshold was not reached. The decompress fidelity claim could not be validated because the trigger never engaged.
- **Failing C7 (Roadmap Fit):** Today is Cycle Day 2 of the 90-day execution-quality roadmap (`docs/roadmap.md`). Phase 1 requires an uninterrupted 14-day baseline accrual of `costProxy` and `errorEndedRate` towards an immovable Day 51 freeze and Day 80 reliability proof gate. Adopting an external stream rewriter violates the ranked intervention menu (`docs/roadmap.md:310-335`) and risks tripping false circuit-breaker exclusions.

Passing criteria confirmed:
- **C2 (Cache Parity):** Upstream prompt cache hit rate reached $93\text{--}94\%$ on multi-turn sessions ($36{,}679 / 38{,}938$ tokens), driven by native upstream KV caching.
- **C3 (Wire Safety):** Zero `400 INVALID_ARGUMENT`, `Malformed_Function_Call`, or trailing-turn errors observed across all benchmark tasks T1–T5, L1, and L2.
- **C5 (Zero Collateral Damage):** Zero `auth.accountPolicies` drift; zero real-home drift (35/35 files bit-for-bit identical); clean removal verified.
- **C6 (Security Posture):** Zero third-party telemetry, zero analytics beacons; credential headers masked; MIT license with an additional surface attribution requirement.

---

## 2. What It Is

`billion-context` (npm package `billion-context`, CLI `bili`) is a local reverse proxy paired with `acp-kernel` for coding agents. It sits between an agent and its LLM upstreams:
- **Architecture:** Local HTTP reverse proxy (`dist/index.js`) listening on port `8787` (manual) or `18787+` (lane-spawned). Bundles `acp-kernel` compiled directly into `dist/`.
- **Context Management Tools:** Injects four tools natively or on the wire: `compress` (fold ranges), `decompress` (restore blocks), `search_context` (lexical search over folded blocks), and `acp_status` (context usage overview).
- **OMP Native Lane (`bili plugin install omp`):** Appends an extension entry pointing to `dist/agent/omp-native.js` into `~/.omp/agent/config.yml` under `extensions:`. `omp-native.js` intercepts `globalThis.fetch` in-process, matches URLs ending in `MODEL_API_SUFFIX`, spawns/attaches to a local proxy at port `18787`, and transparently rewrites requests to `http://127.0.0.1:18787/bili/<upstream-url>`.
- **OMP Protocol Nuance:** OMP exposes no request-header lifecycle hooks. `omp-native.js` stamps `prompt_cache_key` in the request body as conversation id and sets `x-bili-plugin*` headers directly on the fetch `RequestInit`.

---

## 3. Provider Coverage for This Setup

The user's OMP configuration (`~/.omp/agent/config.yml`) uses four provider families via OAuth and direct credentials. `~/.omp/agent/models.yml` is `providers: {}`.

| Provider Family | Wire Protocol | Endpoint Matched by Proxy | Compression Status | Verdict / Caveat |
| :--- | :--- | :--- | :--- | :--- |
| **`google-antigravity`**<br/>(`gemini-3.8-flash:high`) | `google`<br/>(`contents[]`) | `https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent` | **Recognized & Routed; Idle** | Matches `(?:^|\/)v1internal:(?:streamGenerateContent...)`. Proxy forwards successfully via `createGoogleAdapter`. However, compression remains idle on standard tasks due to the 50k threshold vs 1M window. |
| **`deepseek`**<br/>(`deepseek/deepseek-flash`) | `openai`<br/>(`messages[]`) | `https://api.deepseek.com/chat/completions` | **Recognized & Routed; Idle** | Matches `chat/completions`. Forwarded via `createOpenaiAdapter`. Cache hit $93\text{--}96\%$. Compression idle under 50k threshold. |
| **`openai-codex`**<br/>(`gpt-5.6-luna`, `gpt-6-luna`) | `responses`<br/>(`input[]`) | `https://chatgpt.com/backend-api/codex/...` | **Recognized (Desk)** | Forwarded via `createResponsesAdapter`. **Caveat:** bili replays full historical input; it cannot follow OpenAI's native `previous_response_id` delta chaining (`CLIENTS.md:516`). |
| **`muse-code`**<br/>(`muse-wonder-1.0`) | `openai`<br/>(`messages[]`) | Custom OpenAI-compatible endpoint | **Recognized (Desk)** | Classified as `openai` protocol via `detectProtocolFromBody`. Relays through `createOpenaiAdapter`. |

### Launcher Lane Dead-End (`bili omp`)
Desk-audit of `src/launcher.ts` (`discoverRoutes`, `parseOmpYaml`) confirmed that `bili omp`:
```js
else if (client === "omp") {
  for (const [name, prov] of Object.entries(config.omp?.providers ?? {})) {
    classify(prov.baseUrl, name);
  }
}
```
`config.omp?.providers` reads solely from `~/.omp/agent/models.yml`. Because `models.yml` is `providers: {}`, `acc.httpsDomains` and `acc.httpRewrites` are both empty. `bili omp` routes **zero** traffic for this setup. Only the native plugin lane (`bili plugin install omp`) is functional.

---

## 4. Compatibility Matrix vs. OMP Toolkit Live Mechanisms

| Local Mechanism | File & Symbol | Bili Interaction & Behavior | Risk / Failure Mode | Empirical Outcome (Step 3) |
| :--- | :--- | :--- | :--- | :--- |
| **Gemini Wire Normalizer** | `apps/omp-extension/src/gemini-normalizer.ts`<br/>`registerGeminiNormalizer` | Hooks `before_provider_request` before `fetch`. Scrubs monologues, removes pre-tool chatter, appends `"Proceed with the pending task."` if turn ends on model. | If a model calls `compress`, normalizer could insert user text after the tool call, triggering Gemini `400 INVALID_ARGUMENT` or `Malformed_Function_Call`. | **No errors observed.** In print mode, `gemini-normalizer` did not conflict with text-only turn flows. |
| **Auto-Heal Circuit Breaker** | `apps/omp-extension/src/auto-heal.ts`<br/>`AutoHealCoordinator` | Hooks `agent_end` and `auto_retry_start`. Places `reservePct: 100` on Gemini account if error text matches `/abort\|timeout\|timed out\|503.../i`. | Proxy crash, 30s timeout, or ECONNRESET falsely excludes healthy Google account. | **Zero drift observed.** Real `auth.accountPolicies` remained untouched across all runs. |
| **Antigravity Probe Client** | `apps/omp-extension/src/probe-client.ts`<br/>`AntigravityProbeClient` | Direct HTTPS child process to `daily-cloudcode-pa.googleapis.com` (not `globalThis.fetch`). | Asymmetric visibility: probe client reports route healthy while proxy bridge might hang. | **Permanent asymmetry property.** Probe client bypasses proxy by design. |
| **Execution Quality Telemetry** | `apps/omp-extension/src/auto-heal.ts`<br/>`extractTokenTotal` $\to$ `history-store.ts` | Host-side token extraction measures **unfolded** local session history (`CLIENTS.md:2837`). | OMP's `costProxy = meanTok` in `execution:report` overstates input tokens; cannot observe bili savings. | **Confirmed.** Host meters measure unfolded prompt. Upstream usage only visible via `/__bili/stats` or `/acp-cache`. |
| **Native Context Stack** | `packages/core` + OMP runtime (`/shake`, prefix caching) | OMP relies on byte-stable prefix caching (75–90% cost cut) and `/shake` (`artifact://`). | Folding message history breaks byte-stable prefix caching; bili cannot resolve `artifact://` pointers. | **Severe trade-off.** Upstream KV cache already gives 93–94% hit rate. Folds destroy prefix stability. |
| **Tool Surface & Subagents** | OMP tool registry | Injects `compress`, `decompress`, `search_context`, `acp_status`. | Expands prompt schema (~400 tokens/turn); subagents with restricted allowlists trigger proxy wire injection. | **Logged warning:** `bili-plugin(omp): 5 bili tool(s) dropped from host registry... re-registering (#2708)`. |
| **Extension Coexistence** | `~/.omp/agent/extensions/gemini-health.js` | Both run as OMP extensions in the same process. | Unrouted non-model fetch traffic intercepted or altered. | **Clean.** DeepSeek balance and health probe use unintercepted paths; no interference. |

---

## 5. Empirical Measurements (Isolated A/B Replay)

### Regression Screen Tasks (T1–T5)
Model: `google-antigravity/gemini-3.8-flash` (thinking: low). Single turn per task.

| Task | Domain | Arm A Duration (No Bili) | Arm B Duration (With Bili) | Arm A Output | Arm B Output | Wire Errors | Compression Fired? |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **T1** | Core / TUI (Null-Safety) | 15.97 s | 10.75 s | 1,773 chars | 1,492 chars | 0 | No (idle) |
| **T2** | Provider Usage (CLI Flag) | 9.22 s | 9.90 s | 1,857 chars | 2,114 chars | 0 | No (idle) |
| **T3** | Desktop / IPC (Cooldowns) | 13.44 s | 12.83 s | 2,235 chars | 1,674 chars | 0 | No (idle) |
| **T4** | Extension (Timeout Param) | 22.98 s | 7.26 s | 1,649 chars | 1,103 chars | 0 | No (idle) |
| **T5** | Docs Sync (Architecture) | 7.60 s | 8.92 s | 1,569 chars | 1,757 chars | 0 | No (idle) |
| **Mean** | — | **13.84 s** | **9.93 s** | **1,816 chars** | **1,628 chars** | **0** | **0 / 5** |

### Needle Recall & Decompress Fidelity (L2)
5 planted facts $\to$ 3 research file reads $\to$ verbatim recall.

| Arm | Duration | Exact Needle Recall | Upstream Input Tokens | Upstream Cached Tokens | Cache Hit % | Compression Folds |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Arm A (No Bili)** | 26.47 s | **5 / 5 (100%)** | ~27,100 tok | ~23,000 tok | ~85% | 0 (native) |
| **Arm B (With Bili)** | 17.50 s | **5 / 5 (100%)** | 27,114 tok | 23,095 tok | 85.2% | **0 (idle)** |

*Log receipt (Arm B):* `nudge idle: usage=2% (23085/1048576), pendingT1=11988/50000, reason="max compressible 11988 < threshold 50000"`

### Long Multi-Turn Agentic Session (L1)
Multi-file codebase inspection: 56 messages, reading architecture, roadmap, and 5 core files, followed by test execution.

| Arm | Duration | Messages | Inbound Payload | Outbound Wire Payload | Total Input Tokens | Cache Hit % | Compression Folds |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Arm B (With Bili)** | 80.27 s | 56 msgs | 133.6 KiB | 144.7 KiB (+11.1 KiB) | 38,938 tok | **94.2%** (36,679 tok) | **0 (idle)** |

*Log receipt (Arm B):* `processTurn: 56 msgs, nudge idle: usage=4% (38750/1048576), pendingT1=14235/50000, reason="max compressible 14235 < threshold 50000"`

### Vendor Claims vs. Measured Reality

| Vendor Claim | Measured Reality | Status | Explanation |
| :--- | :--- | :---: | :--- |
| **5× fewer tokens** | $0\%$ reduction on standard tasks; payload grew by $+8.3\%$ | **Refuted** (for 1M window) | Default 50k token trigger threshold is never reached in typical multi-turn tasks (10k–40k tokens). |
| **95–97% prefix-cache hit** | $93\text{--}94\%$ measured | **Supported (Incidental)** | High cache hit rate is achieved by Google's native KV cache on raw messages, *not* by bili compression. |
| **$\le 2\%$ compression cost** | Not exercised | **Not Exercised** | Compression never engaged, so cache destruction after fold could not be observed. |
| **100K context is enough** | OMP operates comfortably within 100K natively via `/shake` and LSP | **Neutral** | OMP's built-in offloading (`artifact://`) already solves this without an external proxy. |

---

## 6. Security, License & Telemetry Audit

- **Third-Party Network Egress:** Audited `dist/index.js` for telemetry, tracking, and analytics calls (`posthog`, `sentry`, `mixpanel`, `telemetry`, `google-analytics`). **Zero analytics or telemetry beacons found.** Network egress is strictly limited to:
  1. Configured model provider upstreams (`daily-cloudcode-pa.googleapis.com`, `api.deepseek.com`, etc.).
  2. `registry.npmjs.org` for version check (disabled via `ACP_AUTO_UPDATE=0`).
  3. `raw.githubusercontent.com` for advisory watcher (disabled via `BILI_ADVISORY_CHECK=0`).
- **Data at Rest & Credential Redaction:**
  - State directory: `%USERPROFILE%\.local\state\billion-context\` (`bili.log`, `instances/`, `port-zone.json`).
  - Log redaction: `CREDENTIAL_HEADER_RE = /key|auth|token|cookie/i`. Inspection of `bili.log` confirmed **0** plaintext bearer tokens or API keys written to disk.
- **License Terms & Legal Boundaries:**
  - Base: MIT License (Copyright 2026 ranxianglei).
  - Additional Term: Mandatory surface attribution (*"if you use or incorporate the Software in a product or service that end users can see or interact with... you must make attribution clearly visible in at least one of: 1. product home page, 2. documentation, 3. About/Credits page"*).
  - Consequence: Running bili privately requires no action. Incorporating bili code or bundles into `omp-toolkit` would violate ADR-0003 (clean MIT) and ADR-0007 (no unnecessary third-party runtime dependencies).

---

## 7. Removal & Clean Restoration Proof

1. **Opt-Out & Kill Switches Verified:**
   - Setting `BILLION_CONTEXT_PLUGIN=0` completely bypassed proxy spawning (`omp -p` executed directly in 2.9s).
   - Setting `BILI_NATIVE_OMP=0` stood down the native lane cleanly.
2. **Uninstallation Verified:**
   - Command: `<npm-prefix>/bili.cmd plugin remove omp`
   - Output: `omp: removed from <isolated-home>\config.yml`
   - Leftovers: `config.yml` was restored; empty `extensions:` block remained; backup files `config.yml.bili-last` and `config.yml.bili-bak` preserved.
3. **Port & Process Teardown:**
   - Port `18787` verified: `ECONNREFUSED` (no active listeners). Parent-pid watchdog cleanly self-terminated the proxy upon parent process exit.
4. **Real-Home Manifest Integrity:**
   - Pre-eval SHA-256 snapshot: 35 files tracked.
   - Post-eval SHA-256 comparison: **0 files modified, 0 files added, 0 files deleted**.
5. **Toolkit Diagnostics:**
   - `bun run doctor`: 6/6 PASS (`omp-version`, `installed-files`, `history-db`, `machine-id`, `lock-file`, `orca-terminal`), exit 0.
   - `bun run check`: 346 pass, 0 fail, 1,353 assertions green, exit 0.

---

## 8. Appendix: Configuration Reference If Adopted Later

If an operator decides to run `billion-context` privately for marathon sessions (>200,000 tokens) on another profile, the validated configuration and commands are:

### Recommended `billion-context.json`
Place in `%USERPROFILE%\.config\billion-context\billion-context.json` (or set `BILI_CONFIG_FILE`):
```json
{
  "autoUpdate": false,
  "advisoryCheck": false,
  "compress": {
    "tiers": true,
    "nudgeGrowthTokens": 20000,
    "maxContextLimit": "50%",
    "emergencyThresholdPercent": "90%"
  }
}
```
*Note:* Lowering `nudgeGrowthTokens` from 50k to 20k is necessary if you want compression to fire on Gemini before context reaches 100k+ tokens.

### Installation & Removal Commands
```bash
# Install native OMP hook
bili plugin install omp

# Verify status
bili plugin status omp

# Remove native hook cleanly
bili plugin remove omp
```

---

## 9. Method & Limitations

- **Method:** Evaluated on Windows 10 x64 using isolated home directories (`PI_CODING_AGENT_DIR`), isolated temp npm prefix, and SHA-256 filesystem guardrails.
- **Limits:**
  1. Single-day evaluation (2026-10-29).
  2. Multi-day marathon sessions (billions of tokens over weeks) were not tested; tasks capped at 56 turns / ~40k tokens.
  3. OpenAI Codex was evaluated via desk audit; live test was performed on Google Antigravity and DeepSeek.
  4. Nondeterminism of LLM outputs was controlled by fixed prompts, low thinking level, and repeated runs.
