import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UsageReport } from "@omp-toolkit/core";
import { recordAndLoadPacingSamples } from "./pacing-store";

describe("provider-usage pacing-store", () => {
  function createTestFixture() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-pu-pacing-"));
    const filePath = path.join(tmpDir, "pacing-samples.json");
    return {
      tmpDir,
      filePath,
      cleanup: () => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      },
    };
  }

  test("records muse sample, thins unchanged within 15m, appends on change, ignores non-muse", () => {
    const fixture = createTestFixture();
    try {
      const now = 1_000_000_000_000;
      const resetsAt = now + 400_000_000;

      const nonMuseReport: UsageReport[] = [
        {
          provider: "google-antigravity",
          metadata: { email: "anti@example.com" },
          limits: [
            {
              label: "Weekly",
              window: { label: "Weekly", resetsAt },
              amount: { usedFraction: 0.1 },
            },
          ],
        },
      ];

      // 1. Non-muse writes nothing
      const emptyRes = recordAndLoadPacingSamples(nonMuseReport, {
        now,
        filePath: fixture.filePath,
      });
      expect(emptyRes).toEqual({});
      expect(fs.existsSync(fixture.filePath)).toBe(false);

      // 2. Muse report records sample
      const museReport: UsageReport[] = [
        {
          provider: "muse-code",
          metadata: { email: "muse@example.com" },
          limits: [
            {
              label: "Weekly",
              window: { label: "Weekly", resetsAt },
              amount: { usedFraction: 0.25 },
            },
          ],
        },
      ];

      const res1 = recordAndLoadPacingSamples(museReport, {
        now,
        filePath: fixture.filePath,
      });
      expect(res1["muse@example.com"]).toHaveLength(1);
      expect(res1["muse@example.com"][0]).toEqual({
        at: now,
        resetsAt,
        usedFraction: 0.25,
      });
      expect(fs.existsSync(fixture.filePath)).toBe(true);

      // 3. Second identical call within 15m does not append
      const res2 = recordAndLoadPacingSamples(museReport, {
        now: now + 500_000, // +8.3 min < 15 min
        filePath: fixture.filePath,
      });
      expect(res2["muse@example.com"]).toHaveLength(1);

      // 4. Changed fraction appends even within 15m
      const museReportChanged: UsageReport[] = [
        {
          provider: "muse-code",
          metadata: { email: "muse@example.com" },
          limits: [
            {
              label: "Weekly",
              window: { label: "Weekly", resetsAt },
              amount: { usedFraction: 0.3 },
            },
          ],
        },
      ];
      const res3 = recordAndLoadPacingSamples(museReportChanged, {
        now: now + 600_000,
        filePath: fixture.filePath,
      });
      expect(res3["muse@example.com"]).toHaveLength(2);
      expect(res3["muse@example.com"][1].usedFraction).toBe(0.3);
    } finally {
      fixture.cleanup();
    }
  });

  test("corrupt file is tolerated and overwritten", () => {
    const fixture = createTestFixture();
    try {
      fs.writeFileSync(fixture.filePath, "{ bad json");
      const now = 1_000_000_000_000;
      const resetsAt = now + 400_000_000;

      const museReport: UsageReport[] = [
        {
          provider: "muse-code",
          metadata: { email: "muse@example.com" },
          limits: [
            {
              label: "Weekly",
              window: { label: "Weekly", resetsAt },
              amount: { usedFraction: 0.2 },
            },
          ],
        },
      ];

      const res = recordAndLoadPacingSamples(museReport, {
        now,
        filePath: fixture.filePath,
      });
      expect(res["muse@example.com"]).toHaveLength(1);
      expect(res["muse@example.com"][0].usedFraction).toBe(0.2);

      const content = fs.readFileSync(fixture.filePath, "utf8");
      expect(content).toContain('"version": 1');
    } finally {
      fixture.cleanup();
    }
  });
});
