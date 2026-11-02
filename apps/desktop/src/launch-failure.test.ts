import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { consumeLaunchFailure, launchFailurePath, recordLaunchFailure } from "./launch-failure";

function tempAgentDir(): string {
  return fs.mkdtempSync(path.join(import.meta.dir, ".tmp-launch-failure-"));
}

describe("launch failure persistence", () => {
  test("record then consume returns the failure once, then null", () => {
    const dir = tempAgentDir();
    try {
      recordLaunchFailure(dir, new Error("spawn ENOENT"), 1_700_000_000_000);
      const failure = consumeLaunchFailure(dir);
      expect(failure).toEqual({ at: 1_700_000_000_000, message: "spawn ENOENT" });
      expect(fs.existsSync(launchFailurePath(dir))).toBe(false);
      expect(consumeLaunchFailure(dir)).toBeNull();

      const log = fs.readFileSync(path.join(dir, "desktop-widget-error.log"), "utf8");
      expect(log).toContain("LAUNCH FAILED: spawn ENOENT");
      expect(log).toContain(new Date(1_700_000_000_000).toISOString());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("corrupt marker is cleared and surfaces nothing", () => {
    const dir = tempAgentDir();
    try {
      fs.writeFileSync(launchFailurePath(dir), "not json", "utf8");
      expect(consumeLaunchFailure(dir)).toBeNull();
      expect(fs.existsSync(launchFailurePath(dir))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing marker consumes to null", () => {
    const dir = tempAgentDir();
    try {
      expect(consumeLaunchFailure(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
