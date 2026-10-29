import { describe, expect, test } from "bun:test";
import type { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearToastCooldownsForTest, dispatchToast, TOAST_COOLDOWN_MS } from "./toast";

describe("dispatchToast helper", () => {
  test("throttles notifications per kind within cooldown window", () => {
    clearToastCooldownsForTest();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toast-test-"));
    const scriptPath = path.join(tempDir, "windows-toast.ps1");
    fs.writeFileSync(scriptPath, "# dummy", "utf8");

    try {
      let callCount = 0;
      const fakeExec = ((
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?: ((error: Error | null) => void) | null,
      ) => {
        callCount++;
        cb?.(null);
        return {} as unknown;
      }) as unknown as typeof execFile;

      const now = 1_000_000;
      // First call -> dispatches
      const first = dispatchToast("all-failed", "All failed", {
        scriptPath,
        now,
        execFileFn: fakeExec,
      });
      expect(first).toBe(true);
      expect(callCount).toBe(1);

      // Second call at +1 minute -> throttled
      const second = dispatchToast("all-failed", "Still failed", {
        scriptPath,
        now: now + 60_000,
        execFileFn: fakeExec,
      });
      expect(second).toBe(false);
      expect(callCount).toBe(1);

      // Different kind at +1 minute -> dispatches
      const other = dispatchToast("lock-timeout", "Timed out", {
        scriptPath,
        now: now + 60_000,
        execFileFn: fakeExec,
      });
      expect(other).toBe(true);
      expect(callCount).toBe(2);

      // First kind after cooldown -> dispatches
      const afterCooldown = dispatchToast("all-failed", "Failed again", {
        scriptPath,
        now: now + TOAST_COOLDOWN_MS + 1000,
        execFileFn: fakeExec,
      });
      expect(afterCooldown).toBe(true);
      expect(callCount).toBe(3);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("silently returns false if script does not exist", () => {
    clearToastCooldownsForTest();
    const result = dispatchToast("test", "msg", {
      scriptPath: "/nonexistent/toast.ps1",
    });
    expect(result).toBe(false);
  });
  test("dispatches via osascript on macOS and notify-send on Linux", () => {
    clearToastCooldownsForTest();
    const commandsRun: string[] = [];
    const argsRun: (readonly string[] | null | undefined)[] = [];
    const fakeExec = ((
      cmd: string,
      args: readonly string[] | null | undefined,
      _opts: unknown,
      cb?: ((error: Error | null) => void) | null,
    ) => {
      commandsRun.push(cmd);
      argsRun.push(args);
      cb?.(null);
      return {} as unknown;
    }) as unknown as typeof execFile;

    // macOS
    const macRes = dispatchToast("mac-kind", "Mac error", {
      platform: "darwin",
      execFileFn: fakeExec,
    });
    expect(macRes).toBe(true);
    expect(commandsRun[0]).toBe("osascript");
    expect(argsRun[0]?.[1]).toContain("Mac error");

    // Linux
    const linuxRes = dispatchToast("linux-kind", "Linux error", {
      platform: "linux",
      execFileFn: fakeExec,
    });
    expect(linuxRes).toBe(true);
    expect(commandsRun[1]).toBe("notify-send");
    expect(argsRun[1]?.[1]).toBe("Linux error");
  });
});
