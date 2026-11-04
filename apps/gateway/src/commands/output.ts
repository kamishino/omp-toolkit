import fs from "node:fs";
import path from "node:path";
import type { GatewayCtlConfig } from "../config";

export function print(config: GatewayCtlConfig, payload: unknown, lines: string[]): void {
  if (config.json) console.log(JSON.stringify(payload, null, 2));
  else for (const line of lines) console.log(line);
}

export function writeTextFileAtomic(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, filePath);
}
