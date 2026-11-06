# OMP Global Settings Templates

OMP prompt templates allow you to save, version, and switch between named personas for your global OMP agent rules directly from inside an active OMP session. Templates snapshot the standing instructions in your global agent directory (`~/.omp/agent/`) into this repository under `templates/<name>/` as inert, git-trackable markdown files.

## File Mapping

Each template bundle manages the two primary file-driven prompt layers:

| Template File in Repository | Live Target in `~/.omp/agent/` | Purpose |
| :--- | :--- | :--- |
| `templates/<name>/AGENTS.template.md` | `~/.omp/agent/AGENTS.md` | Cross-project agent instructions (injected into `<repo-rules>`) |
| `templates/<name>/RULES.template.md` | `~/.omp/agent/RULES.md` | Standing hard constraints and rules injected into the prompt |

> **Note on Excluded Files:** `SYSTEM.md`, `APPEND_SYSTEM.md`, and `config.yml` are **not** managed by templates. OMP global settings in `config.yml` (model roles, authentication policies, themes) and machine-specific configs remain separate and are never overwritten or tracked by template operations.

## Commands

Template management runs through the `/template` slash command inside OMP:

- `/template save <name> [--force]`
  Snapshots the current live `AGENTS.md` and/or `RULES.md` into `templates/<name>/`. If the template already exists, `--force` is required to overwrite it.
- `/template apply <name>`
  Applies the template onto `~/.omp/agent/`, exactly restoring its saved files. If a live file exists but was absent from the template, it is deleted on apply (after backup). Always creates a timestamped backup before modifying live files. Attempts a settings reload; start `/new` to guarantee the new prompt is active.
- `/template list`
  Lists all available templates in this repository, showing their included files and highlighting the active template matching your live files (`*`).
- `/template show <name>`
  Displays a per-file comparison between the template and your live globals (identical, differs, will create, or will delete).
- `/template delete <name> --force`
  Deletes the template directory. Requires `--force` to prevent accidental deletion.
- `/template` (or `/template help`)
  Displays command usage and syntax.

## Template Name Pattern

Template names must be valid slugs matching:
```regex
^[a-z0-9][a-z0-9-_]{0,63}$
```
Names must be 1 to 64 lowercase alphanumeric characters, hyphens, or underscores, starting with a letter or digit (e.g. `work`, `deepseek-v3`, `strict_audit`). Uppercase characters, spaces, and path traversal characters (`/`, `\`, `..`) are rejected.

## Checkout Resolution Order

When running `/template` inside an OMP session, the extension determines which repository checkout to write templates to using the following search order:

1. `OMP_TOOLKIT_HOME` environment variable (if set, must point to a valid `omp-toolkit` checkout containing `scripts/monitor/orca-monitor.ts`).
2. Current working directory of the host process and its parent ancestors, nearest-first.
3. `~/.omp/omp-toolkit` default deployed clone under your user profile.

If none of these candidates contains a valid `omp-toolkit` checkout, the command fails with an error asking to set `OMP_TOOLKIT_HOME`.

## Automatic Backups

Before applying any template that overwrites or removes live files, the extension automatically copies all existing live files to a timestamped backup directory:
```text
~/.omp/agent/backups/templates/YYYY-MM-DDTHH-mm-ss-sssZ/
```
The 10 most recent template backups are retained; older template backups are pruned. Installer backups under `~/.omp/agent/backups/<timestamp>/` are never touched.

## Hand-Authoring Templates

You can author templates directly without running `/template save`:
1. Create a directory `templates/<name>/` using a valid slug name.
2. Add `AGENTS.template.md`, `RULES.template.md`, or both.
3. Any unrecognized files in the directory are ignored. A directory must contain at least one known template file to be recognized by `/template list` and `/template apply`.

## Public Repository Notice

This repository is public. Template bundles saved by `/template save` are ignored
by default (`templates/*/AGENTS.template.md`, `templates/*/RULES.template.md`),
so personal personas stay local.

To publish a template intentionally, review it for API keys, credentials, private
tokens, and confidential instructions, then force-add it:
`git add -f templates/<name>/AGENTS.template.md`. The tracked
`templates/plan-exec-handoff/` example stays public.

## Bundled Templates Catalog

The repository ships with four production-ready template bundles:

| Template Slug | Target Persona | Recommended Model Role | Core Architectural Levers |
| :--- | :--- | :--- | :--- |
| `gemini-tdd` | Test-Driven Feature Development | `google-antigravity/gemini-3.8-flash:high` | Strict Red-before-Green gate, inverted layout, pre-tool chatter redirection, paired negative bounding. |
| `gemini-diagnose` | Systematic Bug Isolation | `google-antigravity/gemini-3.8-flash:high` | 6-phase diagnostic discipline, feedback loop first gate, falsifiable hypotheses (`If X, then Y`), secret masking. |
| `gemini-speed` | High-Velocity Mechanical Work | `google-antigravity/gemini-3.8-flash:low` | Ranged reads (`:20-50`), single-turn batching, deferred verification check, zero conversational commentary. |
| `plan-exec-handoff` | Planner-to-Executor Handoff | `deepseek/deepseek-flash` (or hybrid) | Inviolable plan-to-execution contract with zero runtime invention and two-strike circuit breaker. |

### Switching Between Templates

Switch templates live in any active OMP session:
```bash
/template apply gemini-tdd      # Switch to primary TDD feature development persona
/template apply gemini-diagnose # Switch to deep root-cause bug investigation persona
/template apply gemini-speed    # Switch to high-speed mechanical execution persona
/template apply plan-exec-handoff # Switch to planner-executor handoff contract
```
Inspect the differences before applying:
```bash
/template show gemini-tdd
```

### Architecture: 3-Tier Progressive Disclosure

Prompt templates in OMP adhere to a **3-tier Information Hierarchy** to prevent "Lost in the Middle" attention degradation and preserve upstream provider KV prompt caching:

1. **Tier 1: Standing Context (`AGENTS.md` / `RULES.md`)**
   - Always in context (<100 lines).
   - Houses immutable invariants, repo verification commands (`bun run check`), model role calibrations, and pushy skill pointers.
2. **Tier 2: Disclosed Procedural Workflows (`skill://<name>`)**
   - Loaded into conversation history on-demand only when a task matches the trigger (e.g. `skill://tdd`, `skill://diagnosing-bugs`).
   - Houses multi-step procedural runbooks, edge-case trees, and algorithmic patterns.
3. **Tier 3: Externalized Resources (`docs/`, `scripts/`, `assets/`)**
   - Executable helpers and reference documentation inspected just-in-time via tools.

For in-depth theoretical analysis, empirical attention dynamics benchmarks, and KV cache impact studies, see [`docs/research/agent-skills-vs-agents-md-analysis.md`](../docs/research/agent-skills-vs-agents-md-analysis.md).
