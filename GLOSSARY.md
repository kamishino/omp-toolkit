# Glossary

## Account
A credential identity within a provider, identified by email, account id, or
project id.

## Provider
An upstream model service registered in OMP, such as Google Antigravity,
OpenAI Codex, Muse Code, or DeepSeek.

## Route
The provider -> account -> model path used for one request.

## Route health
The result of a route probe: OK, HANG, ERR, AUTH, or MODEL.

## Route stall
A route that emits no first SSE event within the probe timeout, or that fails
with a qualifying retryable error.

## Snapshot
The latest recorded route-health result for every probed account.

## Managed exclusion
A routing exclusion written by the toolkit. Managed exclusions are eligible for
automatic restore.

## Manual exclusion
A routing exclusion that was not written by the toolkit. Manual exclusions are
never restored automatically unless the account opts in.

## Opt-in auto-restore
Per-account permission for a manual exclusion to be removed automatically after
the required healthy-check streak.

## Recovery sweep
A conditional probe run that happens only while at least one restorable
exclusion exists.

## Manual intervention
An operator action that manually changes exclusions or forces recovery: enabling
an excluded account, running a manual heal, or manually restoring policies.
## Incident
A state where every account fails, or where automatic recovery cannot restore
service and the operator must act.

## Machine
One host with its own OMP agent directory and its own toolkit state.

## Monitor
The Orca Floating Workspace tab that renders the provider-usage view.

## History
The 30-day local record of route checks, policy changes, manual interventions,
incidents, and monitor heartbeats.

## Experimental feature
A feature published for feedback without compatibility or support guarantees.

## Maintainer
The person who sets project direction and merges contributions.

## Public release
A tagged source snapshot published on GitHub. The project does not publish npm
packages.

## Supported platform
A platform covered by CI and documented installation, build, and CLI support.

## Best-effort platform
A platform where installation and CLI are expected to work, but
integration-specific behavior may be untested.

## Balance alert
A red `LOW` state shown when a provider balance is at or below the configured
threshold for its currency.

## Route column
The per-account `ROUTE` cell. It is shown for every provider section when the
snapshot contains route health for any account.
