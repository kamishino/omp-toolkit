# ADR-0008: TerminUI terminal UI refactoring

- Status: Accepted
- Date: 2026-10-23

## Context

The terminal UI in `packages/tui` previously built ASCII frames via manual string
concatenation and padding, repainting the entire terminal screen on each watch
interval using raw escape sequences (`\x1b[?1049h\x1b[25l`, `\x1b[H...`). This
caused visible screen flicker during frequent refreshes and lacked interactive
keyboard controls.

We evaluated three potential terminal UI frameworks:
1. **`@opentui/core`**: High-performance Zig native rendering core with Bun FFI
   bindings. While extremely fast, it introduces compiled native binaries
   (`.dll`, `.so`, `.dylib`) and FFI complexity across Windows, macOS, and Linux
   CI environments, violating our zero-binary portability rule (ADR-0003/0004).
2. **`ink`**: React reconciler for the terminal using Yoga Flexbox. While mature,
   it introduces React 18/19 Virtual DOM reconciliation, Yoga WASM/C++ bindings,
   and a heavy dependency footprint into a lightweight CLI monitor.
3. **`terminui`**: Pure functional TypeScript toolkit inspired by Rust's
   Ratatui. It provides constraint-based layout (`Length`, `Percentage`,
   `Ratio`, `Min`, `Max`), double-buffered cell diffing (flushing only modified
   terminal cells), in-memory test backends, and zero native binary dependencies.

## Decision

- Adopt **`terminui`** as the terminal presentation engine in `packages/tui`.
- Maintain the strict monorepo seam:
  - `packages/tui` remains a pure presentation package with zero I/O, drawing
    into `terminui` frame buffers and providing test-backend string renderers.
  - `apps/provider-usage` owns process TTY streams, raw-mode keyboard inputs
    (`q` to quit, `r` to refresh, `s`/`Tab` to switch views), and the watch loop.
- All styles and colors MUST bind strictly to `design/tokens.json` via ANSI
  color indices (zero raw hex or RGB literals).
- Automatic fallback: when running in non-TTY, pipe, or CI environments, render a
  clean static string frame without terminal raw mode or alternate screen jumps.

## Consequences

- Full screen redraw flicker is eliminated through cell-level diffing.
- The repository remains 100% portable TypeScript without compiled native FFI
  binaries or C++ compiler toolchains.
- Testing remains fast, deterministic, and isolated in `bun test` via
  `terminui`'s in-memory `createTestBackend`.
