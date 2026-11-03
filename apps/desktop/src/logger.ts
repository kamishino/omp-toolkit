import fs from "node:fs";
import path from "node:path";
import { errorLogPath } from "./paths";

export function logLine(line: string, filePath = errorLogPath()): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, line, "utf8");
  } catch {
    // Logging must not crash the widget
  }
}

export function logError(error: unknown, filePath = errorLogPath()): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  logLine(`[${new Date().toISOString()}] ${message}\n`, filePath);
}
