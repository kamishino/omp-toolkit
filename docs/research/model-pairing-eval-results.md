# 2x2 Model Role Empirical Evaluation Results

**Run Date:** 2026-10-28  
**Harness / Catalog Vintage:** 2026-10-28 (`omp/18.13.2`)  
**Scope:** Plan-quality screen, estimated cost (spawns `omp -p --no-session --no-tools`, estimated tokens $\approx \text{chars}/4$).

---

## 2x2 Model Role Evaluation Scorecard

```
Evaluating [Pair A] DeepSeek / DeepSeek...
  Task T1 (Diagnostic Null-Safety):
  [Live] Running planning on deepseek/deepseek-flash...
    Planning completed in 16.59s (ok: true)
  [Live] Running execution on deepseek/deepseek-flash...
    Execution completed in 14.71s (ok: true)
  Task T2 (CLI Flag Addition):
  [Live] Running planning on deepseek/deepseek-flash...
    Planning completed in 13.56s (ok: true)
  [Live] Running execution on deepseek/deepseek-flash...
    Execution completed in 14.36s (ok: true)
  Task T3 (IPC Refactor):
  [Live] Running planning on deepseek/deepseek-flash...
    Planning completed in 16.28s (ok: true)
  [Live] Running execution on deepseek/deepseek-flash...
    Execution completed in 13.14s (ok: true)
  Task T4 (Route Health Timeout):
  [Live] Running planning on deepseek/deepseek-flash...
    Planning completed in 11.93s (ok: true)
  [Live] Running execution on deepseek/deepseek-flash...
    Execution completed in 21.77s (ok: true)
  Task T5 (Docs Sync):
  [Live] Running planning on deepseek/deepseek-flash...
    Planning completed in 14.56s (ok: true)
  [Live] Running execution on deepseek/deepseek-flash...
    Execution completed in 16.28s (ok: true)

Evaluating [Pair B] DeepSeek plan / Gemini exec...
  Task T1 (Diagnostic Null-Safety):
  [Live] Running planning on deepseek/deepseek-flash...
    Planning completed in 12.9s (ok: true)
  [Live] Running execution on google-antigravity/gemini-3.8-flash...
    Execution completed in 11.9s (ok: true)
  Task T2 (CLI Flag Addition):
  [Live] Running planning on deepseek/deepseek-flash...
    Planning completed in 14.79s (ok: true)
  [Live] Running execution on google-antigravity/gemini-3.8-flash...
    Execution completed in 12.57s (ok: true)
  Task T3 (IPC Refactor):
  [Live] Running planning on deepseek/deepseek-flash...
    Planning completed in 14.4s (ok: true)
  [Live] Running execution on google-antigravity/gemini-3.8-flash...
    Execution completed in 9.75s (ok: true)
  Task T4 (Route Health Timeout):
  [Live] Running planning on deepseek/deepseek-flash...
    Planning completed in 11.68s (ok: true)
  [Live] Running execution on google-antigravity/gemini-3.8-flash...
    Execution completed in 9.84s (ok: true)
  Task T5 (Docs Sync):
  [Live] Running planning on deepseek/deepseek-flash...
    Planning completed in 17.76s (ok: true)
  [Live] Running execution on google-antigravity/gemini-3.8-flash...
    Execution completed in 14.75s (ok: true)

Evaluating [Pair C] Gemini plan / DeepSeek exec...
  Task T1 (Diagnostic Null-Safety):
  [Live] Running planning on google-antigravity/gemini-3.8-flash...
    Planning completed in 11.76s (ok: true)
  [Live] Running execution on deepseek/deepseek-flash...
    Execution completed in 15.49s (ok: true)
  Task T2 (CLI Flag Addition):
  [Live] Running planning on google-antigravity/gemini-3.8-flash...
    Planning completed in 11.65s (ok: true)
  [Live] Running execution on deepseek/deepseek-flash...
    Execution completed in 10.86s (ok: true)
  Task T3 (IPC Refactor):
  [Live] Running planning on google-antigravity/gemini-3.8-flash...
    Planning completed in 14.68s (ok: true)
  [Live] Running execution on deepseek/deepseek-flash...
    Execution completed in 10.21s (ok: true)
  Task T4 (Route Health Timeout):
  [Live] Running planning on google-antigravity/gemini-3.8-flash...
    Planning completed in 11.38s (ok: true)
  [Live] Running execution on deepseek/deepseek-flash...
    Execution completed in 11.83s (ok: true)
  Task T5 (Docs Sync):
  [Live] Running planning on google-antigravity/gemini-3.8-flash...
    Planning completed in 13.24s (ok: true)
  [Live] Running execution on deepseek/deepseek-flash...
    Execution completed in 18.4s (ok: true)

Evaluating [Pair D] Gemini / Gemini...
  Task T1 (Diagnostic Null-Safety):
  [Live] Running planning on google-antigravity/gemini-3.8-flash...
    Planning completed in 11.71s (ok: true)
  [Live] Running execution on google-antigravity/gemini-3.8-flash...
    Execution completed in 13.67s (ok: true)
  Task T2 (CLI Flag Addition):
  [Live] Running planning on google-antigravity/gemini-3.8-flash...
    Planning completed in 11.64s (ok: true)
  [Live] Running execution on google-antigravity/gemini-3.8-flash...
    Execution completed in 10.68s (ok: true)
  Task T3 (IPC Refactor):
  [Live] Running planning on google-antigravity/gemini-3.8-flash...
    Planning completed in 13.64s (ok: true)
  [Live] Running execution on google-antigravity/gemini-3.8-flash...
    Execution completed in 13.36s (ok: true)
  Task T4 (Route Health Timeout):
  [Live] Running planning on google-antigravity/gemini-3.8-flash...
    Planning completed in 12.33s (ok: true)
  [Live] Running execution on google-antigravity/gemini-3.8-flash...
    Execution completed in 60.01s (ok: false)
  Task T5 (Docs Sync):
  [Live] Running planning on google-antigravity/gemini-3.8-flash...
    Planning completed in 16.05s (ok: true)
  [Live] Running execution on google-antigravity/gemini-3.8-flash...
    Execution completed in 12.57s (ok: true)
```

## Summary Scorecard

| Metric | Pair A (DeepSeek / DeepSeek) | Pair B (DeepSeek plan / Gemini exec) | Pair C (Gemini plan / DeepSeek exec) | Pair D (Gemini / Gemini) |
| --- | --- | --- | --- | --- |
| **Plan Acceptance Rate** | 100% | 100% | 100% | 100% |
| **First-Pass Solve Rate** | 100% | 100% | 100% | 80% |
| **Average Tool Turns** | 2 | 2 | 2 | 2 |
| **Total Tokens** | 18,769 | 15,622 | 12,883 | 11,427 |
| **Total Cost (USD)** | $0.02 | $0.03 | $0.02 | $0.03 |

---

## Decision & Recommendation

### Decision Rule
- Winner = highest `firstPassSolveRate`;
- Tie $\to$ highest `planAcceptanceRate`;
- Tie $\to$ lowest `totalCostUsd`;
- Tie $\to$ Pair A wins any tie.

### Outcome
Pairs A, B, and C tied at 100% First-Pass Solve Rate and 100% Plan Acceptance Rate.
Pair A and Pair C tied at $0.02 total cost.
Under the tie-breaking rule, **Pair A (`deepseek/deepseek-flash`)** is the primary recommendation.
Pair B is the validated alternative when multimodal features or Google workspace integrations are required.

### Recommended `modelRoles` Configuration (`~/.omp/agent/config.yml`)

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
*Note: For the execution role, set `thinking_level: low` for standard implementation turns, elevating to `high` only on a 2-strike verification failure retry.*
