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
 * Flushes only modified cell coordinates via ANSI cursor positioning (\x1b[y;xH).
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
      for (const { x, y, cell } of content) {
        const fg = formatColorSgr(cell.fg);
        const bold = cell.modifier ? "\x1b[1m" : "";
        const reset = fg || bold ? "\x1b[0m" : "";
        buffer += `\x1b[${y + 1};${x + 1}H${fg}${bold}${cell.symbol}${reset}`;
      }
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
