import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UsageReport } from "@omp-toolkit/core";
import { recordAndLoadPacingSamples } from "./pacing-store";

describe("desktop pacing-store", () => {
  function createTestFixture() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-desktop-pacing-"));
    const filePath = path.join(tmpDir, "pacing-samples.json");
    return {
      tmpDir,
      filePath,
      cleanup: () => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      },
    };
  }

  test("records muse sample, appends when fraction changes, and survives corrupt files", () => {
    const fixture = createTestFixture();
    try {
      const now = 1_000_000_000_000;
      const resetsAt = now + 400_000_000;

      const museReport: UsageReport[] = [
        {
          provider: "muse-code",
          metadata: { email: "desktop-muse@example.com" },
          limits: [
            {
              label: "Weekly",
              window: { label: "Weekly", resetsAt },
              amount: { usedFraction: 0.2 },
            },
          ],
        },
      ];

      // 1. Initial write
      const res1 = recordAndLoadPacingSamples(museReport, {
        now,
        filePath: fixture.filePath,
      });
      expect(res1["desktop-muse@example.com"]).toHaveLength(1);
      expect(res1["desktop-muse@example.com"][0].usedFraction).toBe(0.2);

      // 2. Corrupt file is tolerated
      fs.writeFileSync(fixture.filePath, "invalid json");
      const res2 = recordAndLoadPacingSamples(museReport, {
        now: now + 60_000,
        filePath: fixture.filePath,
      });
      expect(res2["desktop-muse@example.com"]).toHaveLength(1);
      expect(fs.readFileSync(fixture.filePath, "utf8")).toContain('"version": 1');
    } finally {
      fixture.cleanup();
    }
  });
});
