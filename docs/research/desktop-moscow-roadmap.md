# Desktop MoSCoW Roadmap — `apps/desktop` + launch/build

> **Date:** 2026-11-02
> **Scope:** Desktop only — Electron tray/panel (`apps/desktop`), launch/shortcut (`scripts/desktop`), desktop bundling (`scripts/build`), and desktop design tokens (`design/tokens.json` → `apps/desktop/src/renderer/tokens.ts`). Out of scope: TUI, extension, gateway, providers.
> **Beneficiary:** Solo operator, primary Windows workstation, ~5 h/week, strictly one item at a time.
> **Method:** Same rubric as [`moscow-feature-prioritization.md`](moscow-feature-prioritization.md) — reused, not reinvented. Current-state claims below cite `file:line`; ranking in §3 is analysis.

## Method (reused rubric)

- **Impact 1–5:** 5 = metric validity / daily operation fails · 4 = measurable `errorEndedRate`/`costProxy` gain · 3 = weekly time saved · 2 = occasional convenience · 1 = cosmetic.
- **Effort:** S <2 h · M 2–8 h · L >8 h.
- **Evidence:** `Measured` (local test/benchmark) · `Asserted` (analysis/vendor spec, no local run) · `Refuted` (tested, failed).
- **Tiers:** Must = daily operation or metric validity fails without it · Should = Impact ≥3 + Measured, or approved · Could = Impact ≤2 / Asserted-only / trigger-contingent · Won't = refuted, invariant/ADR-violating, or superseded.
- **Tie-break:** Measured > Asserted; defect > feature; smaller effort first.

**Invariants checked for every candidate**

| Invariant | Source |
| --- | --- |
| Zero idle tokens — passive file reads only, no idle probes | ADR-0001 |
| Source-only, no packaging/npm/signed binaries | ADR-0003, roadmap `C17` |
| Cross-platform Electron widget, source-run via Bun | ADR-0005 |
| No standalone web dashboard | roadmap `C18` |
| Providers locked to 4 (Antigravity, Codex, Muse, DeepSeek) | roadmap `C20` |
| Windows-primary; macOS/Linux best-effort | roadmap `C21`, ADR-0004 |
| Local-first SQLite, no sync/cloud | roadmap North Star |
| `packages/core` zero I/O / network / process | roadmap North Star |

Desktop items already closed in the parent register: `C06` (pacing-store dedup), `C12` (cross-platform toast), `C13` (`muse-code` logo) — see [`../roadmap.md`](../roadmap.md) Completed. They are not re-ranked here.

---

## 1. Desktop current-state inventory

Facts only. Each row cites the primary source read for this audit.

### 1.1 Main process & panel window

| Area | What exists today | Evidence |
| --- | --- | --- |
| App identity | `app.setName("OMP Provider Usage")`; Win32 AppUserModelId `dev.omp-toolkit.desktop-widget`; single-instance lock, second instance shows panel | [`apps/desktop/src/main.ts:13-23`](../../apps/desktop/src/main.ts:13), [`main.ts:276-277`](../../apps/desktop/src/main.ts:276) |
| Panel window | Frameless, `alwaysOnTop`, `skipTaskbar`, non-resizable, `contextIsolation` + `sandbox`, navigation/context-menu denied; size from tokens (700×720 DIP) clamped to work area, 12 px margin | [`apps/desktop/src/panel.ts:29-65`](../../apps/desktop/src/panel.ts:29), [`design/tokens.json`](../../design/tokens.json) `desktop.size`, [`docs/design.md:69`](../design.md:69) |
| Show/hide | Tray-bounds-aware placement via `placePanel`; blur auto-hides; `Escape` hides via `before-input-event`; 300 ms toggle debounce after hide | [`panel.ts:67-79`](../../apps/desktop/src/panel.ts:67), [`panel.ts:84-163`](../../apps/desktop/src/panel.ts:84) |
| Dynamic height | Renderer measures header/summary/banner/content/footer and IPC-resizes (`omp:resize`, clamped 220–max) | [`renderer.ts:250-308`](../../apps/desktop/src/renderer/renderer.ts:250), [`panel.ts:111-144`](../../apps/desktop/src/panel.ts:111) |
| Error surface | `uncaughtException` → log + `dialog.showErrorBox` + quit; `unhandledRejection` → log only | [`main.ts:35-48`](../../apps/desktop/src/main.ts:35) |

### 1.2 Tray, runtime, settings, login item

| Area | What exists today | Evidence |
| --- | --- | --- |
| Tray icon | 16×16 (+@2x 32×32) per theme × severity (`ok/warn/hot/critical/unknown`), 1 px ring; tooltip truncated to 63 chars; click/double-click toggles panel, right-click pops menu | [`tray.ts:8-41`](../../apps/desktop/src/tray.ts:8), [`tray.ts:119-133`](../../apps/desktop/src/tray.ts:119), [`docs/design.md:86`](../design.md:86) |
| Tray menu | Status line, gateway line, Refresh, Show/Minimize, Settings…, Open terminal, Open Orca, Start-at-login checkbox, Exit; Linux uses `setContextMenu`, others `popUpContextMenu` on right-click | [`tray-menu.ts:27-102`](../../apps/desktop/src/tray-menu.ts:27), [`tray.ts:85-88`](../../apps/desktop/src/tray.ts:85) |
| Gateway indicator | `GET http://127.0.0.1:4000/healthz` (1 s timeout) on every runtime state change, result shown as disabled menu item | [`main.ts:181-206`](../../apps/desktop/src/main.ts:181) |
| Runtime loop | `DesktopRuntime` owns settings, dashboard cache, refresh guard, warm-up state, `setInterval` poll (default 300 s, 30–3600 s), `powerMonitor` resume/unlock refresh; subscribers notified reactively | [`runtime.ts:80-191`](../../apps/desktop/src/runtime.ts:80), [`runtime.ts:357-378`](../../apps/desktop/src/runtime.ts:357), [`main.ts:253-266`](../../apps/desktop/src/main.ts:253) |
| Data seam | Installed monitor CLI (`omp-provider-usage.js --json --health`, schema-2) via `fetchDashboard`; health snapshot read passively from file — no probing from the widget (ADR-0001 held) | [`data.ts:73-90`](../../apps/desktop/src/data.ts:73), [`paths.ts:62-80`](../../apps/desktop/src/paths.ts:62) |
| Settings model | `intervalSeconds`, `balanceAlert{cny,usd}`, `theme(system/light/dark)`, `openAtLogin`; validated, atomically persisted to `settings.json` in `userData`; env overrides (`OMP_WIDGET_INTERVAL_SECONDS`, `DEEPSEEK_BALANCE_ALERT_*`) | [`settings.ts:6-18`](../../apps/desktop/src/settings.ts:6), [`settings.ts:59-130`](../../apps/desktop/src/settings.ts:59) |
| Settings UI | Cog button in panel header toggles dashboard/settings; form with Timing & Appearance, Low-Balance Alerts, System (Start at login toggle); live validation, `Esc` cancels, theme previews live and reverts on cancel | [`renderer.ts:89-99`](../../apps/desktop/src/renderer/renderer.ts:89), [`settings-view.ts:47-133`](../../apps/desktop/src/renderer/settings-view.ts:47), [`settings-view.ts:204-247`](../../apps/desktop/src/renderer/settings-view.ts:204), [`settings-view.ts:267-331`](../../apps/desktop/src/renderer/settings-view.ts:267) |
| Login item | Win32 `setLoginItemSettings`, macOS LaunchAgent plist + `launchctl`, Linux `~/.config/autostart/*.desktop`; all pass `--hidden`; opt-in only | [`login-item.ts:87-179`](../../apps/desktop/src/login-item.ts:87), [`login-item.ts:42-69`](../../apps/desktop/src/login-item.ts:42) |
| Logging | Append-only `desktop-widget-error.log` under the OMP agent dir; logging failures swallowed so the widget never crashes on log I/O | [`logger.ts:1-13`](../../apps/desktop/src/logger.ts:1), [`paths.ts:104-106`](../../apps/desktop/src/paths.ts:104) |
| IPC | Typed channels `omp:state/refresh/hide/open-terminal/open-orca/ready/warmup/save-settings/resize/open-settings`; preload exposes `window.omp` via `contextBridge` only | [`ipc.ts:4-15`](../../apps/desktop/src/ipc.ts:4), [`preload.ts:1-50`](../../apps/desktop/src/preload.ts:1) |

### 1.3 Renderer, tokens, logos

| Area | What exists today | Evidence |
| --- | --- | --- |
| Theming | `design/tokens.json` `desktop.color.light/dark` (OKLCH), `desktop.space/font/size` injected as CSS vars; `prefers-color-scheme` live + user override (`system/light/dark`); APCA \|Lc\| ≥60 gate in `scripts/tokens/check-tokens.ts` | [`tokens.ts:8-38`](../../apps/desktop/src/renderer/tokens.ts:8), [`tokens.ts:49-94`](../../apps/desktop/src/renderer/tokens.ts:49), [`docs/design.md:70-74`](../design.md:70) |
| Header/summary | `OMP PROVIDER USAGE`, `aria-live=polite` subtitle (`updated HH:mm` / `Refreshing…` / `Refresh failed`), Refresh/Minimize/Close icon buttons with `aria-label` + `title`; summary line from `summaryText` | [`renderer.ts:44-123`](../../apps/desktop/src/renderer/renderer.ts:44), [`docs/design.md:76-77`](../design.md:76) |
| Provider cards | 24 px logo slot, title `Name · N accounts`, optional time-window badge, optional Warm up all; table `ACCOUNT` (full account on hover) / `ROUTE` badge (explains `HANG/AUTH/MODEL/ERR` via `title` + `aria-label`) / limit cells (`<progress>` + % + reset, `resets in …` for AT); fallback letter badge when no logo | [`card.ts:8-15`](../../apps/desktop/src/renderer/card.ts:8), [`card.ts:29-56`](../../apps/desktop/src/renderer/card.ts:29), [`card.ts:141-190`](../../apps/desktop/src/renderer/card.ts:141) |
| Incident & empty states | Incident <24 h → red `role=alert` banner (kind · age · detail), same rule as TUI; zero providers → sign-in guidance; error → message + Retry | [`renderer.ts:159-166`](../../apps/desktop/src/renderer/renderer.ts:159), [`renderer.ts:173-205`](../../apps/desktop/src/renderer/renderer.ts:173), [`docs/design.md:83`](../design.md:83) |
| UX explanations (shipped 2026-11-02) | Account hover, route/limit/pacing/`LOW` self-explanations, warm-up eligibility counts — commits `4bfeb54`, `2fd147e` | [`card.ts:141-163`](../../apps/desktop/src/renderer/card.ts:141), [`limit-cell.ts`](../../apps/desktop/src/renderer/limit-cell.ts) |
| Provider logos | Vendored offline from `@lobehub/icons-static-svg@1.102.0` (MIT, fetched 2026-11-02); 4 live providers + 12 future marks (Anthropic, Claude, Mistral, xAI, Grok, Meta, Cohere, Perplexity, Groq, Qwen, Ollama, OpenRouter); mono glyphs as `#000/#fff` light/dark pairs; `SOURCES.md` logs every file as `fallback` under an official-first rule; unknown id → `null` → letter badge | [`provider-logos.ts:6-30`](../../apps/desktop/src/renderer/provider-logos.ts:6), [`assets/providers/SOURCES.md`](../../apps/desktop/src/renderer/assets/providers/SOURCES.md) |
| Fonts/icons | Inter Variable + JetBrains Mono Variable self-hosted WOFF2; Material Design Icons (`@mdi/js`) inline SVG | [`styles.css:1-15`](../../apps/desktop/src/renderer/styles.css:1), [`build.ts:98-110`](../../scripts/build/build.ts:98) |

### 1.4 Launch chain & build

| Area | What exists today | Evidence |
| --- | --- | --- |
| Shortcut (Win) | Desktop `.lnk` → `wscript.exe` → `omp-widget-hidden.vbs` (window style 0, no console) → `omp-widget.cmd` → `bun run desktop:preview` → `widget.ts` | [`create-desktop-shortcut.ps1:20-39`](../../scripts/desktop/create-desktop-shortcut.ps1:20), [`omp-widget-hidden.vbs:1-4`](../../scripts/desktop/omp-widget-hidden.vbs:1), [`omp-widget.cmd:12`](../../omp-widget.cmd:12) — commit `4ab19e0` |
| Shortcut (mac/Linux) | `.app`/`.command` or `.desktop` entry → `omp-widget.sh` → `bun run desktop:preview`; Linux also installs `~/.local/share/applications` entry | [`create-desktop-shortcut.ts:91-157`](../../scripts/desktop/create-desktop-shortcut.ts:91), [`omp-widget.sh:12`](../../omp-widget.sh:12) |
| Detached launch (shipped 2026-11-02) | `buildIfNeeded()` → `findElectron()` → `spawn(detached, stdio:"ignore", windowsHide)` + `unref()` after `spawn`; Bun host exits immediately, tray survives terminal close — commit `c6f0aa4` | [`widget.ts:75-91`](../../scripts/desktop/widget.ts:75), [`widget.ts:93-115`](../../scripts/desktop/widget.ts:93) |
| Freshness guard | `buildIfNeeded` compares newest mtime of `apps/desktop/src`, `packages/core/src`, `design/tokens.json`, build/token scripts vs `dist/main.cjs`; rebuilds via `buildDesktop()` if any required artifact missing or stale | [`widget.ts:17-50`](../../scripts/desktop/widget.ts:17) |
| Desktop build | Bun builds `main.cjs`/`preload.cjs` (node/cjs, `electron` external) + `renderer.js` (browser/esm); copies HTML/CSS, provider SVGs, fonts; generates tray PNGs; asserts 6 artifacts + 20 tray PNGs exist or throws | [`build.ts:40-143`](../../scripts/build/build.ts:40) |
| Entry points | `bun run desktop` / `desktop:preview` / `desktop:once` / `desktop:shortcut` / `build:desktop`; `--once` runs headless CLI summary, `--selftest` verifies tray creation | [`package.json` scripts](../../package.json), [`widget.ts:94-102`](../../scripts/desktop/widget.ts:94), [`main.ts:173-179`](../../apps/desktop/src/main.ts:173) |

### 1.5 Spec/code gaps found in this audit

- **Stale spec:** [`docs/design.md:79`](../design.md:79) still says “Muse Code displays an empty slot”; code renders `muse-code.svg` and a letter-badge fallback for unknown providers ([`card.ts:50-56`](../../apps/desktop/src/renderer/card.ts:50), [`provider-logos.ts:13`](../../apps/desktop/src/renderer/provider-logos.ts:13)). Spec lags shipped `C13` + logo vendoring.
- **No `TODO`/`FIXME`/`HACK` in desktop sources** — `apps/desktop/src/**`, `scripts/desktop/*.ts`, `scripts/build/*.ts` grep clean on 2026-11-02. Polish candidates below come from behaviour gaps, not markers.
- **Keyboard surface is thin:** only `Escape` (panel + settings) and native button tabbing; `:focus-visible` outline exists, but no focus management on open, no arrow-key navigation, no shortcut to open Settings (see D07/D08).
- **Minimize ≡ Close:** both header buttons call `window.omp.hide()` ([`renderer.ts:101-121`](../../apps/desktop/src/renderer/renderer.ts:101)). Two affordances, one behaviour.
- **Detached = silent:** `stdio:"ignore"` means a post-spawn Electron crash leaves no console trace; only in-app `logError` (once Electron runs) writes to `desktop-widget-error.log`. Launcher-side failures before `spawn` reject, but nothing persists them (see D03).

---

## 2. Candidate register (desktop only)

`D`-IDs are local to this document and do not collide with the parent register `C01–C24`. “Conflict” flags any tension with [`../roadmap.md`](../roadmap.md); nothing here silently overrides it.

| ID | Candidate | Source citation | Type | Benefit claim | Evidence | Impact | Effort | Invariant risk / Conflict |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| D01 | Direct-Electron shortcut — `.lnk` targets `electron.exe apps/desktop` directly, skipping `wscript → .cmd → bun run` | [`widget.ts:75-115`](../../scripts/desktop/widget.ts:75), [`create-desktop-shortcut.ps1:26-27`](../../scripts/desktop/create-desktop-shortcut.ps1:26), [`omp-widget.cmd:12`](../../omp-widget.cmd:12) | Perf/UX | One less host process; faster cold start; no Bun on PATH needed at click time | Asserted | 2 | M | Low — but bypasses `buildIfNeeded` (D02) and `findElectron` checks; still source-run, so ADR-0005 held |
| D02 | Dist-freshness guard on launch — hash/mtime check (or version stamp) inside Electron/`main` so *any* entry point refuses or rebuilds stale `dist/` | [`widget.ts:29-50`](../../scripts/desktop/widget.ts:29), [`build.ts:112-141`](../../scripts/build/build.ts:112) | Defect prevention | Never run a silently stale panel after `git pull` without rebuild | Asserted | 3 | M | None; strengthens ADR-0005 source-run model |
| D03 | Detached-launch error visibility — persist launcher + early-Electron failures to `desktop-widget-error.log` (or a `--log` file) and surface “last launch failed” on next start | [`widget.ts:81-91`](../../scripts/desktop/widget.ts:81) (`stdio:"ignore"`), [`logger.ts:1-13`](../../apps/desktop/src/logger.ts:1), [`main.ts:35-48`](../../apps/desktop/src/main.ts:35) | Defect/ops | Silent no-show becomes diagnosable without a console | Asserted | 3 | S | None; local file only |
| D04 | Packaged Start-Menu app — electron-builder/installer producing a Start-Menu `.exe` | Requested evaluation vs `C17`; [`build.ts:40-143`](../../scripts/build/build.ts:40) is bundle-only today | DevOps | Native install, Start-Menu pinning, no checkout path | Asserted | 1 | L | **High — direct conflict: `C17` Won't + ADR-0003 + ADR-0005 (“no packaged binaries/installers”). Requires roadmap amendment + new ADR** |
| D05 | Wire future-provider logos to actual new providers — add usage adapters so Anthropic/Copilot/etc. appear and use the 12 vendored marks | [`provider-logos.ts:14-25`](../../apps/desktop/src/renderer/provider-logos.ts:14), [`SOURCES.md`](../../apps/desktop/src/renderer/assets/providers/SOURCES.md) | Feature | Vendored logos become live; broader coverage | Asserted | 1 | L | **High — direct conflict: `C20` Won't (providers locked to 4). Requires roadmap amendment** |
| D06 | Official-logo re-check cadence — scheduled/manual re-check of the 16 marks against vendor-official SVGs; bump pinned Lobe version, update `SOURCES.md` kinds | [`provider-logos.ts:6-8`](../../apps/desktop/src/renderer/provider-logos.ts:6), [`SOURCES.md`](../../apps/desktop/src/renderer/assets/providers/SOURCES.md) (“official-first… all logged fallback”, pinned `1.102.0`) | Maintenance | Correct marks if vendors publish official assets; bounded trademark hygiene | Asserted | 1 | S (per pass) | None; offline vendoring preserved |
| D07 | Panel keyboard navigation & focus — focus first control on show, visible focus ring everywhere, arrow/Tab order across cards/actions, `Esc` already present; return focus to tray on hide where OS allows | [`panel.ts:72-79`](../../apps/desktop/src/panel.ts:72), [`settings-view.ts:316-322`](../../apps/desktop/src/renderer/settings-view.ts:316), [`styles.css:118-120`](../../apps/desktop/src/renderer/styles.css:118) | A11y/UX | Full keyboard-only operation of a daily-glance widget | Asserted | 2 | M | None |
| D08 | Settings discoverability — surface Settings in panel footer/status, keyboard shortcut, and first-run hint; today only cog icon + tray “Settings…” | [`renderer.ts:89-99`](../../apps/desktop/src/renderer/renderer.ts:89), [`tray-menu.ts:62-71`](../../apps/desktop/src/tray-menu.ts:62) | UX | Operators find interval/theme/login controls without hunting | Asserted | 2 | S | None |
| D09 | Sync `docs/design.md` desktop spec with shipped code — `muse-code` logo + letter fallback, incident banner, gateway tray line, dynamic height | [`design.md:79`](../design.md:79) vs [`card.ts:29-56`](../../apps/desktop/src/renderer/card.ts:29), [`renderer.ts:159-166`](../../apps/desktop/src/renderer/renderer.ts:159) | Docs | Spec stops misleading the next change | Measured (diff read) | 1 | S | None |
| D10 | Disambiguate Minimize vs Close — differentiate (e.g. Close quits with confirm, or remove one) or document both as “hide to tray” | [`renderer.ts:101-121`](../../apps/desktop/src/renderer/renderer.ts:101) (both `hide()`) | UX polish | No false affordance in the header | Asserted | 1 | S | None; quitting must respect tray-resident expectation in [`main.ts:280-282`](../../apps/desktop/src/main.ts:280) |
| D11 | Gateway-status fetch hygiene — cache/debounce the `:4000/healthz` probe (currently on every state notify) and avoid tray-menu rebuild churn | [`main.ts:181-206`](../../apps/desktop/src/main.ts:181), [`tray.ts:103-117`](../../apps/desktop/src/tray.ts:103) | Perf polish | Fewer localhost fetches and menu rebuilds per refresh cycle | Asserted | 1 | S | None; localhost only, ADR-0001 untouched (not a provider probe) |
| D12 | Global hotkey to toggle panel (e.g. `Ctrl+Alt+O`) | Gap: only tray click / second-instance / `activate` show the panel ([`main.ts:276-277`](../../apps/desktop/src/main.ts:276), [`tray.ts:77-83`](../../apps/desktop/src/tray.ts:77)) | UX | Keyboard-first show/hide without reaching for the tray | Asserted | 2 | S | Low — must gracefully no-op if registration fails; no invariant impact |

---

## 3. MoSCoW ranking

*Analysis — my prioritisation under the reused rubric. Desktop is currently stable and maintain-only in the parent register, so no candidate meets the Must bar (“daily operation or metric validity fails without it”). Promote to Must only on a reproduced launch/data failure.*

### Must Have

*None.* The widget launches detached, auto-builds when stale via the Bun path, polls passively, and persists settings/login state. No desktop defect currently corrupts the north-star metric (`errorEndedRate`/`costProxy` are extension-side). If D02/D03 field failures reproduce (stale panel shown, silent no-launch), re-triage the implicated item to Must at that point.

### Should Have

| ID | Rationale |
| --- | --- |
| D02 — Dist-freshness guard | Impact 3: prevents the highest-cost desktop failure mode — trusting a stale panel after pulling changes — for every entry point, not just `bun run desktop`. Pairs with D01 (guard first, shortcut second). Effort M. |
| D03 — Detached-launch error visibility | Impact 3: the detached design (correct for tray survival) traded away diagnosability. A persisted launch log restores it for S effort and unblocks support for every future launch bug. Do before or with D01. |

### Could Have

*Ordered by tie-break (defect/ops before feature, smaller first). All are Asserted or Impact ≤2 — none blocks daily use.*

| ID | Rationale |
| --- | --- |
| D08 — Settings discoverability | S effort, Impact 2. Cheapest weekly-friction cut: interval, theme, and Start-at-login already exist but are one cog-icon deep. |
| D12 — Global hotkey | S effort, Impact 2, trigger-contingent on the operator actually wanting keyboard-first access; tray click already works. |
| D01 — Direct-Electron shortcut | Impact 2, Effort M. Real cold-start win, but only safe *after* D02 (freshness) and D03 (visibility) land; otherwise it removes the two safety nets the Bun host provides. |
| D07 — Keyboard navigation & focus | Impact 2, Effort M. Genuine a11y gap (focus is unmanaged today), but the panel is a glance-and-dismiss surface; sequence after the launch-hardening pair. |
| D06 — Official-logo re-check cadence | Impact 1, S per pass. Trigger-contingent: run when a vendor publishes an official mark or the pinned Lobe set revs — not on a fixed ritual (cf. roadmap “No scheduled rituals”). |
| D09 — Design-spec sync | Impact 1, S. Do opportunistically alongside the next renderer change; stale spec is a tax, not a blocker. |
| D10 — Minimize/Close disambiguation | Impact 1, S. Cosmetic affordance fix; bundle with D07/D08 header work to avoid repeated header churn. |
| D11 — Gateway fetch hygiene | Impact 1, S. Localhost-only optimisation; bundle with the next `main.ts` touch. Evidence is Asserted — measure menu-rebuild frequency before optimising further. |

### Won't Have (this backlog)

| ID | Verdict |
| --- | --- |
| D04 — Packaged Start-Menu app | **Won't — requires roadmap amendment.** Directly contradicts `C17` (public packaging/signed binaries excluded), ADR-0003 source-only distribution, and ADR-0005 (“no packaged binaries, installers, codesigning, auto-updaters… require a future ADR”). A private, unsigned local bundle is technically possible but buys a Start-Menu entry at the cost of the invariant that keeps this a zero-overhead source checkout. Revisit only via ADR + roadmap amendment, not as a desktop task. |
| D05 — Wire future-provider logos to new providers | **Won't — requires roadmap amendment.** The 12 extra marks in [`provider-logos.ts:14-25`](../../apps/desktop/src/renderer/provider-logos.ts:14) are inert assets, not providers: no usage adapter emits those IDs, and adding one contradicts `C20` (scope locked to the 4 active providers). Keeping the vendored files is harmless and reversible; wiring them is a scope decision for the parent roadmap, not this desktop backlog. |

> **Conflict flag (explicit):** D04 and D05 are the only candidates that contradict [`../roadmap.md`](../roadmap.md). Both are recorded as Won't here; landing either requires amending `C17`/`C20` and, for D04, a superseding ADR — they must not be smuggled in as “desktop polish.” No other candidate conflicts with ADR-0001 (the widget never probes providers; D11 touches only a localhost gateway check), ADR-0005, local-first, or `packages/core` purity (all candidates live in `apps/desktop` / `scripts/*`).

---

## 4. Recommended sequence

Strictly one at a time at ~5 h/week. Each step lists its done signal; do not start the next until it holds.

```
1. [Should] D03 error visibility (S) ──► 2. [Should] D02 freshness guard (M)
        ──► 3. [Could] D08 discoverability (S) ──► 4. [Could] D01 direct shortcut (M)
        ──► 5. [Could] D07 keyboard/focus (M) ──► 6. [Could] D12 hotkey (S)
        ──► opportunistic: D09 spec sync · D10 header affordance · D11 gateway hygiene
        ──► trigger-only: D06 logo re-check (on vendor/Lobe change)
```

| # | Item | Effort | Done signal |
| --- | --- | ---: | --- |
| 1 | D03 — persist launch/early errors to `desktop-widget-error.log`; show last-failure note on next successful start | S | Kill Electron pre-ready (or rename `dist/main.cjs` in a scratch copy), launch via shortcut, confirm a timestamped entry lands in the log and the next good launch surfaces it |
| 2 | D02 — freshness stamp/guard consulted by Electron main (rebuild prompt or hard message, never silent stale UI) | M | Touch a file under `apps/desktop/src`, launch via the *direct* path (no Bun host), confirm stale `dist` is detected; `bun run build:desktop` clears it; `bun run check` passes |
| 3 | D08 — Settings affordance in footer + shortcut + first-run hint | S | Fresh `settings.json` (rename it aside), launch, reach Settings within one visible action from first paint; existing cog/tray paths still work |
| 4 | D01 — direct-Electron `.lnk` (keeps hidden/no-console behaviour; retains Bun path as fallback) | M | Shortcut launches panel with no `bun`/`wscript` console host in the process tree; cold-start visibly faster; D02 guard still fires on stale `dist`; `scripts/desktop` tests updated and green |
| 5 | D07 — focus-on-show, full focus-visible coverage, logical Tab/arrow order, focus return on hide | M | Keyboard-only walkthrough: open via tray/hotkey, Tab through Refresh → Settings → card actions → footer, `Esc` dismisses, focus does not land behind the panel |
| 6 | D12 — global hotkey toggle (graceful failure if taken) | S | Hotkey shows/hides from another app; conflict with an existing binding degrades to tray-only with a logged note, no crash |
| — | D09 + D10 + D11 bundled polish | S each | `docs/design.md` matches code; header buttons no longer identical-or-documented; gateway fetch debounced with tray menu still live — land each with the next adjacent change, not as standalone projects |
| — | D06 logo re-check | S/pass | Only on trigger: `SOURCES.md` kinds/version updated, `bun run build:desktop` + logo tests pass, no runtime fetching introduced |

Won't items (D04, D05) have no sequence slot. If the operator wants either, the next step is a roadmap/ADR amendment discussion, not code.

---

## 5. Operational prerequisites (no development)

These need no code and should be done before judging any launch candidate — a stale shortcut or disabled login item masquerades as a product bug.

1. **Re-run the shortcut installer** so the Desktop `.lnk` picks up the hidden-launcher change (commit `4ab19e0`):
   ```powershell
   bun run desktop:shortcut
   ```
   Done when clicking “OMP Provider Usage” shows the panel with no console window flashing.
2. **Enable Start at login** (opt-in autostart, ADR-0005): tray menu → check **Start at login**, or panel → Settings (cog) → System → **Start at login**. Verify after a reboot/sign-in that the tray icon appears without launching anything by hand. Disable from the same checkbox if unwanted — no admin rights involved ([`login-item.ts:90-108`](../../apps/desktop/src/login-item.ts:90)).
3. **Sanity-check the data seam once:** `bun run desktop:once` prints the headless usage summary; if it errors with “monitor script not found,” run `bun run install:omp` first ([`once.ts:1-30`](../../apps/desktop/src/once.ts:1)). This separates “widget broken” from “monitor not installed” before filing desktop work.

---

## Sources

- Rubric & parent tiers: [`moscow-feature-prioritization.md`](moscow-feature-prioritization.md), [`../roadmap.md`](../roadmap.md) (`C06/C12/C13` done; `C17/C18/C20/C21` Won't).
- Desktop spec: [`../design.md`](../design.md:67) (§ Desktop panel, § Accessibility), [`../../design/tokens.json`](../../design/tokens.json).
- Invariants: [`../adr/0001-event-driven-health.md`](../adr/0001-event-driven-health.md), [`../adr/0003-public-release-scope.md`](../adr/0003-public-release-scope.md), [`../adr/0005-cross-platform-desktop-widget.md`](../adr/0005-cross-platform-desktop-widget.md).
- Code audited 2026-11-02: `apps/desktop/src/{main,panel,tray,tray-menu,runtime,settings,login-item,logger,paths,data,ipc,preload}.ts`, `apps/desktop/src/renderer/{renderer,card,settings-view,tokens,provider-logos,limit-cell}.ts` + `styles.css`, `scripts/desktop/{widget,create-desktop-shortcut}.ts`, `create-desktop-shortcut.ps1`, `omp-widget-hidden.vbs`, `scripts/build/build.ts`, `omp-widget.cmd`, `omp-widget.sh`.
- Recent shipped desktop work (2026-11-02): `4bfeb54` (limit explanations + incident banner), `2fd147e` (account/route explanations + letter badge), `67a7985` (Lobe logo vendoring incl. future-provider marks), `c6f0aa4` (detached hidden launch), `4ab19e0` (shortcut via hidden launcher).
