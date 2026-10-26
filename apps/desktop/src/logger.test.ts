import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logError } from "./logger";

describe("logError", () => {
  test("appends formatted error message with timestamp", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-logger-test-"));
    const logFile = path.join(tmpDir, "error.log");

    try {
      const err = new Error("Test error message");
      logError(err, logFile);

      expect(fs.existsSync(logFile)).toBe(true);
      const content = fs.readFileSync(logFile, "utf8");
      expect(content).toContain("Test error message");
      expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("handles non-Error objects gracefully", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-logger-test-"));
    const logFile = path.join(tmpDir, "error.log");

    try {
      logError("Raw string error", logFile);
      const content = fs.readFileSync(logFile, "utf8");
      expect(content).toContain("Raw string error");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("does not throw on file write failure", () => {
    // Passing an invalid path that cannot be created as a file
    const invalidPath =
      process.platform === "win32" ? "Z:\\invalid\\log.txt" : "/invalid_proc/log.txt";
    expect(() => logError(new Error("fail"), invalidPath)).not.toThrow();
  });
});
