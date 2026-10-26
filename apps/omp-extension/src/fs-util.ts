import fs from "node:fs";
import path from "node:path";

export function short(error: unknown, maxLength = 180): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, maxLength);
}

export function writeFileAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, content);
  try {
    fs.renameSync(temp, file);
  } catch {
    fs.writeFileSync(file, content);
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Best-effort temp cleanup
    }
  }
}
