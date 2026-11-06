# Glossary

## Account

A credential identity within a provider, identified by email, account id, or
project id.

## Account order

The ordering of accounts inside one provider section. `weekly-reset` places the
account whose weekly window resets soonest first and expired windows last;
`weekly-usage` places the most-used account first. Route severity always
outranks the configured order.

## Locally authenticated provider

A provider for which this Machine holds a live credential. A provider reported
only from cached history on a Machine with no credential for it is not locally
authenticated, and its section is hidden.

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

## Route circuit breaker

The automatic exclusion of a provider account whose route stalls, plus guarded
restoration after consecutive healthy checks.

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
exclusion exists, at most every 300 seconds, and only when the agent is idle.

## Manual intervention

An operator action that manually changes exclusions or forces recovery: enabling
an excluded account, running a manual heal, or manually restoring policies.

## Incident

A state where every account fails, or where automatic recovery cannot restore
service and the operator must act.

## Machine

One host with its own OMP agent directory and its own toolkit state.

## Monitor

A live provider-usage view. It runs in any terminal, or in an Orca Floating
Workspace tab when Orca is the chosen host.

## Monitor host

The terminal, desktop widget, or Orca Floating Workspace tab that runs the
monitor.

## Desktop widget

A cross-platform tray host for the monitor: a tray icon plus a compact panel
showing the same provider-usage dashboard. It is separate from the OMP
`/gemini-health-widget` TUI toggle and is not a Windows 11 Widgets-board widget.
_Avoid_: Tray widget, menu bar app

## Tray icon

The OS notification-area (Windows/Linux) or menu-bar (macOS) icon that indicates
status and toggles the desktop widget panel.

## Panel

The compact, always-on-top window owned by the desktop widget.

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

## Warm-up

A deliberate minimal model request to one provider account that establishes or
verifies the account's model route before use. Warm-up is route readiness, not a
quota-window control: whether the provider starts a 5-hour window on that request
is not modeled. Warm-up does not change the OMP account pin, policy, or exclusion
state.

## Warm-up eligible

An account whose latest route status is OK or unknown. Known non-OK accounts are
skipped by provider-wide warm-up and require an Unhang check.

## Unhang check

A single-account route probe for a known non-OK account, used to see whether the
account has recovered. It updates route health but does not immediately restore
an exclusion.

## Time window policy

An authoritative specification of recurring peak and off-peak intervals, reference
timezone, and token rate multipliers for an upstream model provider.

## Peak window

A recurring time interval during which standard (full-price) rates apply for a
provider's model usage.

## Off-peak window

A recurring time interval during which a discounted rate (e.g. 50% discount)
applies for a provider's model usage.

## Reference timezone

The canonical IANA timezone used by a provider's pricing specification (such as
UTC or China Standard Time) against which recurring hours are evaluated.

## Window evaluation

A point-in-time calculation determining the current pricing window, active rate
multiplier, discount percentage, and duration until the next schedule transition.

## Context-aware advisory

A non-blocking visibility cue (such as a dashboard badge or countdown timer)
informing the operator of the active pricing window and cost implications.

## Gateway client

A harness or machine authorized to call the gateway under one scoped token,
with its own model and account allowlists. A gateway client is not an Account.
_Avoid_: Gateway account, gateway user

## Account pin

The durable binding of one gateway client (or OMP session) to one account of a
provider, held until that account becomes ineligible.

## Credential block

A temporary marker that makes one account ineligible for a scope until a stated
time. A credential block is not a Managed exclusion: it may originate upstream
from quota or auth outcomes and expires on its own.

## Gateway host

The Machine that holds the credential vault and serves the gateway to gateway
clients. Other machines hold no provider credentials.
_Avoid_: Vault PC, server

## Control plane

The toolkit's gateway management layer: lifecycle, compatibility checks,
visibility, and policy writes. It carries no model traffic.

## Data plane

The OMP gateway request path that carries model traffic between gateway
clients and providers. The toolkit does not implement a data plane
(ADR-0010).

## Collapsible provider card

An expandable container for a provider section. When collapsed, the card folds
its accounts table and displays summary badges (account count, worst route
health, and maximum quota used) in its header. Collapsed states persist across
reloads in local storage.

## Status metric chip

An interactive filter pill in the desktop header displaying aggregate account
counts by operational state (`All`, `OK`, `≥80%`, `Issues`). Activating a chip
filters the visible provider rows and hides empty provider cards.

## Account micro-action

A row-level shortcut triggered directly on a table element: clicking an account
identifier copies it to the clipboard, and clicking a degraded route badge
(`HANG`, `ERR`) triggers an unhang check probe.

## Filter scope

The active subset of provider rows rendered in the panel based on selected
status metric chips.

## Gateway control drawer

An expandable container beneath the desktop Gateway strip exposing 1-click
daemon lifecycle controls (Start, Stop, Restart, Doctor), endpoint clipboard
copying, and a quick harness recipe selector.

## Harness connect flow

A unified 1-step onboarding command (`gateway:ctl connect <platform>` or
`/gateway connect <platform>`) that provisions a scoped client token and outputs
the exact configuration snippet for external tools (Claude Code, Cursor, Cline,
OpenCode, Aider).

## Autonomous quota cooldown

A temporary credential block automatically applied to an account that reaches
$\ge 99\%$ quota on any limit window, expiring dynamically at `resetsAt`.

## Surviving account invariant

The safety constraint ensuring the control plane will never block the last
remaining unblocked account in a provider pool, preventing complete routing
paralysis.

## Quota transition notification

A debounced desktop notification triggered when an account crosses the $\ge 90\%$
warning threshold, when an account quota resets, or when total pool capacity
exhausts.

## Remote pairing payload

A self-contained 1-line deployment script (PowerShell or Bash) configuring
Cloudflare Access credentials, gateway bearer token, and connectivity
verification on a secondary workstation.

## Remote client doctor

A client-side diagnostic probe (`gateway:ctl doctor --remote`) that tests base URL
configuration, Cloudflare Access token headers, public tunnel reachability, and
gateway bearer authentication from secondary workstations with actionable repair
hints.

## Nerd font family

A release archive of patched developer fonts published by upstream Nerd Fonts
(e.g. `JetBrainsMono`, `CascadiaCode`, `FiraCode`, `Meslo`, `Hack`, `GeistMono`).

## User font store

The per-user operating system directory where fonts are installed without
administrator elevation (`%LOCALAPPDATA%\Microsoft\Windows\Fonts`,
`~/Library/Fonts`, or `~/.local/share/fonts/NerdFonts`).

## Font registration

The operating system mechanism that activates installed font files for all
running desktop applications (registry entries and `WM_FONTCHANGE` on Windows,
filesystem monitoring on macOS, `fc-cache` on Linux).

## Terminal font binding

An automated configuration change that updates a developer terminal profile
(e.g. Windows Terminal `profiles.defaults.font.face`) to use an installed font
family.

## Prompt cache invalidation penalty

The cost inflation ($4\times\text{--}10\times$) and time-to-first-token latency
penalty incurred when literal per-request round-robin scatters sequential
conversational turns across distinct accounts, destroying upstream prefix
KV-cache reuse (resulting in a 0% cache hit rate).

## Session-sticky failover pooling

A gateway routing architecture that pins consecutive requests in a coding
session to one provider account to preserve prompt-cache warmth, rotating to
sibling accounts only upon quota exhaustion (`429`), cooldown blocks, or route
errors.

## SSOT gateway host

The single primary workstation holding all upstream OAuth credentials in its
vault, running the gateway proxy, cooldown engine, and Cloudflare tunnel.

## Thin client workstation

A secondary workstation (PC2, PC3) holding zero upstream provider credentials,
routing all agent requests to the SSOT gateway host through the tunnel.

## Universal custom provider pattern

The standardized 3-tuple configuration (`Base URL`, `API Key`, `Model ID`)
allowing any developer AI tool with custom endpoint support to reuse pooled
accounts without local OAuth authorization.

## Inverted context layout

A prompt layout pattern that positions bulky reference material, file slices,
and error logs at the top (`<context>`) and imperative directives and boundaries
at the bottom (`<task>`, `<invariants>`), exploiting recency attention to
prevent positional attention decay across 1M+ token context windows.

## Anti-suppression procedural stance

A third-person operational framing that suppresses reflective internal
monologues under System 2 reasoning, ensuring autonomous agents do not drop or
suppress self-initiated tool calls.

## Pre-tool chatter redirection

A prompt constraint that compels language models to emit tool call arguments
immediately without conversational preambles or setup phrases ("I will now...",
"Let me check...").

## Paired negative bounding

An RFC 2119 constraint formulation that pairs every negative prohibition
(`MUST NOT touch X`) with an explicit positive operational target
(`MUST touch ONLY Y`), eliminating scope drift and initiative hallucinations.
