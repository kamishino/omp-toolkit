import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { short, writeFileAtomic } from "./fs-util";

describe("fs-util module", () => {
  test("short flattens whitespace and limits length", () => {
    const err = new Error("Line 1\n  Line 2   with   extra  spaces");
    expect(short(err)).toBe("Line 1 Line 2 with extra spaces");

    const longStr = "x".repeat(300);
    expect(short(longStr).length).toBe(180);
    expect(short(longStr, 50).length).toBe(50);
  });

  test("writeFileAtomic writes content atomically and creates directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-fs-util-"));
    const targetFile = path.join(tempDir, "nested", "sub", "test.json");

    try {
      writeFileAtomic(targetFile, '{"ok": true}\n');
      expect(fs.existsSync(targetFile)).toBe(true);
      expect(fs.readFileSync(targetFile, "utf8")).toBe('{"ok": true}\n');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
