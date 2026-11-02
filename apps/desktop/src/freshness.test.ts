import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { findStaleDist } from "./freshness";

function scratch(): string {
  return fs.mkdtempSync(path.join(import.meta.dir, ".tmp-freshness-"));
}

function write(file: string, mtimeMs: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x", "utf8");
  const t = new Date(mtimeMs);
  fs.utimesSync(file, t, t);
}

describe("dist freshness guard", () => {
  test("fresh when dist is newer than every source", () => {
    const dir = scratch();
    try {
      const src = path.join(dir, "src", "main.ts");
      const distMain = path.join(dir, "dist", "main.cjs");
      write(src, 1_000_000);
      write(distMain, 2_000_000);
      expect(findStaleDist(distMain, [path.join(dir, "src")])).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stale when a nested source is newer than dist, naming that source", () => {
    const dir = scratch();
    try {
      const nested = path.join(dir, "src", "renderer", "card.ts");
      const distMain = path.join(dir, "dist", "main.cjs");
      write(nested, 3_000_000);
      write(distMain, 2_000_000);
      expect(findStaleDist(distMain, [path.join(dir, "src")])).toBe(nested);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stale when dist is missing entirely", () => {
    const dir = scratch();
    try {
      const src = path.join(dir, "src");
      write(path.join(src, "main.ts"), 1_000_000);
      expect(findStaleDist(path.join(dir, "dist", "main.cjs"), [src])).toContain("main.cjs");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fresh when no source paths exist (bundled install without checkout)", () => {
    const dir = scratch();
    try {
      const distMain = path.join(dir, "dist", "main.cjs");
      write(distMain, 2_000_000);
      expect(findStaleDist(distMain, [path.join(dir, "src")])).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
