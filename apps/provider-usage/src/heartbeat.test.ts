import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { heartbeatPath, writeHeartbeat } from "./heartbeat";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-heartbeat-test-"));
  process.env.PI_CODING_AGENT_DIR = tempDir;
});

afterEach(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup.
  }
});

describe("monitor heartbeat", () => {
  test("writes heartbeat file with current timestamp, hostname, and pid", () => {
    writeHeartbeat();

    const file = heartbeatPath();
    expect(fs.existsSync(file)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      at?: number;
      hostname?: string;
      pid?: number;
    };

    expect(typeof parsed.at).toBe("number");
    expect(Number.isFinite(parsed.at)).toBe(true);
    expect(parsed.hostname).toBe(os.hostname());
    expect(parsed.pid).toBe(process.pid);
  });
});
