# ADR-0011: Isolated credential recovery and standby profile

## Status

Accepted.

## Context

ADR-0010 established that secondary workstations run as credential-free thin clients, routing inference requests through the primary gateway host so OAuth refresh tokens are never copied across machines. However, if the primary workstation experiences hardware, network, or tunnel failures, secondary workstations cannot function unless they can operate autonomously.

Providing an autonomous fallback requires transferring stored provider credentials to a secondary machine. Unrestricted credential cloning causes token invalidation loops under rotating refresh tokens (RTR), while unencrypted cloud storage risks leaking API keys and OAuth tokens.

## Decision

- Provide an explicit disaster-recovery capability (`apps/backup`, `scripts/backup/`) as a strictly scoped exception to ADR-0010's thin-client rule.
- Backups are captured as manual, passphrase-encrypted archives (`.enc`) using AES-256-GCM and scrypt key derivation. They are never synchronized continuously or stored in plaintext.
- Restoration is isolated to a dedicated `omp-portable` profile on the recovery workstation, leaving normal OMP profiles and gateway settings untouched.
- The recovery workflow assumes a one-active-workstation handoff model: the secondary machine assumes active execution while the primary machine is offline. Stale or rotated tokens trigger standard re-authentication rather than automated multi-machine synchronization.
- Recovery workstations remain direct inference consumers; they do not assume the role of gateway host or re-export credentials to other clients.

## Consequences

- Secondary workstations can maintain work continuity during primary gateway outages without depending on running gateway daemons or Cloudflare tunnels.
- Normal thin-client workstations continue to operate with zero local credentials under standard gateway operation.
- Encrypted backup archives, databases, and local credentials remain private operational artifacts and must never enter Git history.
