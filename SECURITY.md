# Security Policy

## Supported versions

The latest 0.1.x release is supported with best-effort fixes.

## Reporting a vulnerability

Do not open a public issue with exploit details, tokens, credentials, or
provider payloads. Use GitHub's private vulnerability reporting for this
repository (Security tab → Report a vulnerability). If that form is unavailable,
open a minimal public issue asking for a private channel and include no
technical details.

## Scope

- API-key and OMP credential handling.
- Writes to `~/.omp/agent` config, state, history, and snapshot files.
- The SQLite history database and report script.
- Orca CLI invocation and command-string construction.
- Desktop widget IPC surface, sandbox and context isolation, CSP policy, and terminal command construction.

## What this project does not do

It has no telemetry and no remote upload path. It calls OMP, the configured
model providers, and, when enabled, the DeepSeek balance endpoint.
