# ADR-0002: Opt-in auto-restore for manual exclusions

- Status: Accepted
- Date: 2026-10-21

## Context

The v0.1.0 extension restores only exclusions it created itself. Manual
`reservePct: 100` policies are never removed. That invariant protects an
operator's explicit decision, but it conflicts with the 30-day goal of zero
manual route fixes: a manual exclusion can stay stuck after the account has
recovered.

Global auto-restore would remove that safety boundary for every manual policy.
Keeping manual policies permanent would make the reliability goal impossible.

## Decision

Manual exclusions opt in per account through a sidecar file
`~/.omp/agent/gemini-health-auto-restore.json`:

```json
{ "enabled": ["user@example.com"] }
```

The extension exposes `/gemini-auto-restore <email-or-local-part>` and
`/gemini-auto-restore off <email-or-local-part>`. Managed exclusions continue
to restore without opt-in. A manual exclusion restores only when its account is
present in the sidecar, its healthy streak meets the existing threshold, and
the restore path removes the policy through the existing policy writer.

## Consequences

- `restorableEmails` gains an opted-in set and a manually-excluded set.
- The extension gains one sidecar file, two commands, and a strict read path.
- Manual policies remain safe by default; opting in is an explicit, auditable
  action.
- The operator runs one opt-in command before the 30-day proof begins; that
  setup action is not a manual route fix.
