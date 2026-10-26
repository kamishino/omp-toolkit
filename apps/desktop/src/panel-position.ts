export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PanelPositionOptions {
  tray: Rect | null;
  workArea: Rect;
  panel: Size;
  platform: NodeJS.Platform;
  cursor?: Point;
  margin?: number;
}

export function placePanel(options: PanelPositionOptions): Rect {
  const margin = options.margin ?? 12;
  const workArea = options.workArea;

  const width = Math.min(options.panel.width, Math.max(10, workArea.width - 2 * margin));
  const height = Math.min(options.panel.height, Math.max(10, workArea.height - 2 * margin));

  const minX = workArea.x + margin;
  const maxX = Math.max(minX, workArea.x + workArea.width - width - margin);
  const minY = workArea.y + margin;
  const maxY = Math.max(minY, workArea.y + workArea.height - height - margin);

  const clampX = (x: number) => Math.max(minX, Math.min(maxX, x));
  const clampY = (y: number) => Math.max(minY, Math.min(maxY, y));

  const tray =
    options.tray && options.tray.width > 0 && options.tray.height > 0 ? options.tray : null;

  if (options.platform === "darwin" && tray) {
    const x = clampX(tray.x + tray.width / 2 - width / 2);
    const y = clampY(tray.y + tray.height + margin);
    return { x, y, width, height };
  }

  if (options.platform === "win32" && tray) {
    // Infer taskbar edge
    const isBottom = tray.y >= workArea.y + workArea.height - 1;
    const isTop = tray.y <= workArea.y + 1;
    const isRight = tray.x >= workArea.x + workArea.width - 1;
    const isLeft = tray.x <= workArea.x + 1;

    let targetX = maxX;
    let targetY = maxY;

    if (isBottom) {
      targetX = clampX(tray.x + tray.width / 2 - width / 2);
      targetY = workArea.y + workArea.height - height - margin;
    } else if (isTop) {
      targetX = clampX(tray.x + tray.width / 2 - width / 2);
      targetY = workArea.y + margin;
    } else if (isRight) {
      targetX = workArea.x + workArea.width - width - margin;
      targetY = clampY(tray.y + tray.height / 2 - height / 2);
    } else if (isLeft) {
      targetX = workArea.x + margin;
      targetY = clampY(tray.y + tray.height / 2 - height / 2);
    } else {
      // Fallback: bottom-right
      targetX = maxX;
      targetY = maxY;
    }

    return {
      x: clampX(targetX),
      y: clampY(targetY),
      width,
      height,
    };
  }

  // Linux or no tray
  return {
    x: maxX,
    y: maxY,
    width,
    height,
  };
}
