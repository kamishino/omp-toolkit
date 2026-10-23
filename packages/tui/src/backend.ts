import type { Backend, Cell, Color, Position, Size } from "terminui";

function formatColorSgr(color: Color | undefined): string {
  if (!color) return "";
  if (color.type === "indexed") {
    return `\x1b[38;5;${color.index}m`;
  }
  if (color.type === "rgb") {
    return `\x1b[38;2;${color.r};${color.g};${color.b}m`;
  }
  return "";
}

/**
 * Creates an ANSI terminal stdout backend for terminui's double-buffered Terminal.
 * Flushes only modified cell coordinates via batched ANSI cursor positioning.
 * Features:
 * - Contiguous cursor batching (suppresses cursor repositioning for horizontal cell sequences)
 * - SGR style caching (avoids per-cell reset churn)
 * - Atomic synchronized updates (DEC Mode 2026 \x1b[?2026h ... \x1b[?2026l)
 */
export function createStdoutBackend(stream: NodeJS.WriteStream = process.stdout): Backend {
  let cursor: Position = { x: 0, y: 0 };
  let buffer = "";

  return {
    size: (): Size => ({
      width: stream.columns || 86,
      height: stream.rows || 28,
    }),
    draw: (
      content: readonly {
        readonly x: number;
        readonly y: number;
        readonly cell: Cell;
      }[],
    ): void => {
      if (content.length === 0) return;

      // Begin atomic synchronized update frame
      buffer += "\x1b[?2026h";

      let lastX = -1;
      let lastY = -1;
      let currentFg = "";
      let currentModifier = 0;

      for (const { x, y, cell } of content) {
        // Only jump cursor if not contiguous on the same row
        if (y !== lastY || x !== lastX) {
          buffer += `\x1b[${y + 1};${x + 1}H`;
        }
        lastX = x + 1;
        lastY = y;

        // Optimize color SGR: emit change only when color or modifier differs
        const fg = formatColorSgr(cell.fg);
        const mod = cell.modifier || 0;

        if (fg !== currentFg || mod !== currentModifier) {
          if (currentFg || currentModifier) {
            buffer += "\x1b[0m";
          }
          if (fg) buffer += fg;
          if (mod) buffer += "\x1b[1m";
          currentFg = fg;
          currentModifier = mod;
        }

        buffer += cell.symbol;
      }

      // Reset any active color/modifier at end of draw pass
      if (currentFg || currentModifier) {
        buffer += "\x1b[0m";
      }

      // End atomic synchronized update frame
      buffer += "\x1b[?2026l";
    },
    flush: (): void => {
      if (buffer.length > 0) {
        stream.write(buffer);
        buffer = "";
      }
    },
    hideCursor: (): void => {
      stream.write("\x1b[?25l");
    },
    showCursor: (): void => {
      stream.write("\x1b[?25h");
    },
    getCursorPosition: (): Position => cursor,
    setCursorPosition: (pos: Position): void => {
      cursor = pos;
      stream.write(`\x1b[${pos.y + 1};${pos.x + 1}H`);
    },
    clear: (): void => {
      stream.write("\x1b[2J\x1b[H");
    },
  };
}
