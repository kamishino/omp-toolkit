import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WarmUpReport } from "@omp-toolkit/core";
import { fetchWarmUp, parseWarmUpReport, summarizeWarmUp, warmUpFailureMessage } from "./warmup";

describe("warmup desktop helpers", () => {
  const validReport: WarmUpReport = {
    action: "warm",
    provider: "google-antigravity",
    checkedAt: 123456,
    results: [
      {
        account: "alpha@example.com",
        status: "ok",
        ms: 150,
        checkedAt: 123456,
      },
    ],
    skipped: [{ account: "bravo@example.com", status: "hang", reason: "non-ok" }],
  };

  test("parseWarmUpReport parses valid JSON report", () => {
    const raw = JSON.stringify(validReport);
    expect(parseWarmUpReport(raw)).toEqual(validReport);
  });

  test("parseWarmUpReport throws on invalid JSON or schema", () => {
    expect(() => parseWarmUpReport("not json")).toThrow("warmup returned invalid JSON");
    expect(() => parseWarmUpReport(JSON.stringify({ action: "invalid" }))).toThrow(
      "warmup returned an invalid report",
    );
  });

  test("summarizeWarmUp formats bulk and check summaries", () => {
    expect(summarizeWarmUp(validReport)).toBe("Warmed 1 account(s) · skipped 1 non-OK");

    const checkReport: WarmUpReport = {
      action: "check",
      provider: "google-antigravity",
      checkedAt: 123456,
      results: [
        {
          account: "chinmotdesign@gmail.com",
          status: "hang",
          ms: 15000,
          checkedAt: 123456,
        },
      ],
      skipped: [],
    };
    expect(summarizeWarmUp(checkReport)).toBe("Checked chinmotdesign: HANG (15000ms)");
  });
  test("warmUpFailureMessage prioritizes stderr", () => {
    expect(warmUpFailureMessage({ stderr: "lock active", code: 1 })).toBe("lock active");
  });

  test("warmUpFailureMessage shows install hint on old health payload", () => {
    const oldPayload = JSON.stringify({
      results: [{ email: "alpha@example.com", status: "ok", ms: 100 }],
      policies: [],
      restored: [],
    });
    const msg = warmUpFailureMessage({ stdout: oldPayload, code: 1 });
    expect(msg).toContain('Run "bun run install:omp" to update it.');
  });

  test("warmUpFailureMessage formats non-JSON stdout with exit code", () => {
    const msg = warmUpFailureMessage({
      stdout: "Fatal unexpected error in script",
      code: 2,
    });
    expect(msg).toBe("health script exited with code 2: Fatal unexpected error in script");
  });

  test("fetchWarmUp accepts valid report from stdout even if process exited nonzero", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-fetch-warmup-"));
    const scriptFile = path.join(tmpDir, "dummy-warmup.ts");
    fs.writeFileSync(
      scriptFile,
      `console.log(${JSON.stringify(JSON.stringify(validReport))}); process.exit(1);`,
      "utf8",
    );

    try {
      const res = await fetchWarmUp(
        { bun: process.execPath, script: scriptFile },
        { provider: "google-antigravity", action: "warm", all: true },
      );
      expect(res).toEqual(validReport);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
