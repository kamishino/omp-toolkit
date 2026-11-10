import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OMP_VERSION_CHECKPOINT } from "./ipc";
import { createOmpBuildReader } from "./omp-build";

const CHECKPOINT_SHA = OMP_VERSION_CHECKPOINT.sha256;
const OTHER_SHA = "0".repeat(64);

function createFakeExecutable(): { dir: string; file: string; restore: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-build-test-"));
  const file = path.join(dir, "omp.exe");
  fs.writeFileSync(file, "fake executable");
  return {
    dir,
    file,
    restore: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function createReader(
  file: string,
  options: {
    versionOutput?: string;
    digest?: string;
    onHash?: () => void;
    hashCount?: { value: number };
    execCount?: { value: number };
    env?: Record<string, string>;
  } = {},
) {
  const versionOutput = options.versionOutput ?? "omp/18.18.6\n";
  const digest = options.digest ?? CHECKPOINT_SHA;
  return createOmpBuildReader({
    env: { OMP_BIN: file, ...options.env },
    execFn: async () => {
      if (options.execCount) options.execCount.value += 1;
      return { stdout: versionOutput };
    },
    hashFileFn: async () => {
      if (options.hashCount) options.hashCount.value += 1;
      options.onHash?.();
      return digest;
    },
  });
}

describe("createOmpBuildReader", () => {
  test("reports the exact checkpoint pair as the documented pause", async () => {
    const fixture = createFakeExecutable();
    try {
      const view = await createReader(fixture.file)();
      expect(view.version).toBe("18.18.6");
      expect(view.sha256).toBe(CHECKPOINT_SHA);
      expect(view.comparison).toBe("same");
      expect(view.builtInAntigravityPolicy).toBe("documented-pause");
      expect(view.healthProbesEnabled).toBe(false);
      expect(view.inspectionError).toBeNull();
    } finally {
      fixture.restore();
    }
  });

  test("treats a different digest or version as changed and unverified", async () => {
    const fixture = createFakeExecutable();
    try {
      const differentDigest = await createReader(fixture.file, { digest: OTHER_SHA })();
      expect(differentDigest.comparison).toBe("changed");
      expect(differentDigest.builtInAntigravityPolicy).toBe("unverified");
      expect(differentDigest.inspectionError).toBeNull();

      const differentVersion = await createReader(fixture.file, {
        versionOutput: "omp/18.18.7\n",
      })();
      expect(differentVersion.version).toBe("18.18.7");
      expect(differentVersion.comparison).toBe("changed");
      expect(differentVersion.builtInAntigravityPolicy).toBe("unverified");
    } finally {
      fixture.restore();
    }
  });

  test("passes the independent health-probe state through", async () => {
    const fixture = createFakeExecutable();
    try {
      const view = await createReader(fixture.file, {
        env: { GEMINI_HEALTH_ENABLED: "1" },
      })();
      expect(view.healthProbesEnabled).toBe(true);
    } finally {
      fixture.restore();
    }
  });

  test("caches an unchanged executable instead of rehashing it", async () => {
    const fixture = createFakeExecutable();
    try {
      const hashCount = { value: 0 };
      const execCount = { value: 0 };
      const read = createReader(fixture.file, { hashCount, execCount });

      await read();
      await read();

      expect(hashCount.value).toBe(1);
      expect(execCount.value).toBe(1);
    } finally {
      fixture.restore();
    }
  });

  test("invalidates the cache when the executable changes", async () => {
    const fixture = createFakeExecutable();
    try {
      const hashCount = { value: 0 };
      const read = createReader(fixture.file, { hashCount });

      const first = await read();
      expect(first.comparison).toBe("same");

      fs.writeFileSync(fixture.file, "fake executable replacement of a different size");
      const second = await read();
      expect(hashCount.value).toBe(2);
      expect(second.comparison).toBe("same");
    } finally {
      fixture.restore();
    }
  });

  test("returns unknown evidence when the configured executable is missing", async () => {
    const fixture = createFakeExecutable();
    try {
      const missing = path.join(fixture.dir, "missing.exe");
      const view = await createReader(missing)();
      expect(view.version).toBeNull();
      expect(view.sha256).toBeNull();
      expect(view.comparison).toBe("unknown");
      expect(view.builtInAntigravityPolicy).toBe("unverified");
      expect(view.inspectionError).toBe("OMP build information is unavailable.");
    } finally {
      fixture.restore();
    }
  });

  test("returns unknown evidence when version inspection fails", async () => {
    const fixture = createFakeExecutable();
    try {
      const read = createOmpBuildReader({
        env: { OMP_BIN: fixture.file },
        execFn: async () => {
          throw new Error("spawn failed");
        },
        hashFileFn: async () => CHECKPOINT_SHA,
      });
      const view = await read();
      expect(view.comparison).toBe("unknown");
      expect(view.inspectionError).toBe("OMP build information is unavailable.");
    } finally {
      fixture.restore();
    }
  });

  test("does not report a match when the executable changes mid-inspection", async () => {
    const fixture = createFakeExecutable();
    try {
      const read = createReader(fixture.file, {
        digest: CHECKPOINT_SHA,
        onHash: () => {
          fs.writeFileSync(fixture.file, "changed while hashing with a larger payload");
        },
      });
      const view = await read();
      expect(view.version).toBeNull();
      expect(view.sha256).toBeNull();
      expect(view.comparison).toBe("unknown");
      expect(view.inspectionError).toBe("OMP changed during inspection; refresh to compare.");
    } finally {
      fixture.restore();
    }
  });
});
