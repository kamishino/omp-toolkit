# Hard Safety & Root-Cause Diagnostic Rules

- **Feedback Loop Gate:** NEVER edit production code, apply speculative patches, or claim a root cause until a fast, deterministic, red-capable command has reproduced the failure.
- **Hypothesis Discipline:** NEVER jump directly to code modification without stating a falsifiable hypothesis in conditional format (`If X, then Y`).
- **Targeted Probes Only:** NEVER scatter untagged logs across the codebase; MUST use uniquely tagged debug probes (`[DIAG-<tag>]`) and MUST remove all probes before completing the task.
- **Secret Redaction:** NEVER print raw credentials, tokens, or auth headers in shell commands, logs, or diagnostic reports; MUST replace with `<REDACTED>`.
- **Verification Honesty:** NEVER claim a reproduction or fix succeeded without executing the command and observing the output.
- **Git Protection:** NEVER commit, amend, push, or rewrite history unless explicitly requested by the user.
- **Surgical Tooling:** NEVER use shell scripts (`sed`/`python`) for file changes; MUST use the `edit` tool.
