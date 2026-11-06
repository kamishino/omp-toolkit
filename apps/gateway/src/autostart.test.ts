import { describe, expect, test } from "bun:test";
import { AUTOSTART_ENTRY_NAME, buildWindowsLauncher, createAutostart } from "./autostart";

describe("autostart", () => {
  test("launcher hides the window and runs ctl start", () => {
    const vbs = buildWindowsLauncher("C:/bun/bun.exe", "C:/ctl/index.js");
    expect(vbs).toContain('shell.Run """C:/bun/bun.exe"" ""C:/ctl/index.js"" start", 0, False');
  });

  test("launcher includes --with-tunnel flag when requested", () => {
    const vbs = buildWindowsLauncher("C:/bun/bun.exe", "C:/ctl/index.js", true);
    expect(vbs).toContain("start --with-tunnel");
  });

  test("install/status/remove round-trip through file ops", async () => {
    const store = new Map<string, string>();
    const auto = createAutostart({
      platform: "win32",
      startupDir: "C:/Startup",
      bunPath: "bun.exe",
      ctlScriptPath: "ctl.js",
      files: {
        exists: (p) => store.has(p),
        write: (p, text) => void store.set(p, text),
        remove: (p) => void store.delete(p),
      },
    });
    expect(auto.entryPath.endsWith(AUTOSTART_ENTRY_NAME)).toBe(true);
    expect((await auto.status()).lines.join("")).toContain("not installed");
    expect((await auto.install()).ok).toBe(true);
    expect((await auto.status()).lines.join("")).toContain("is installed");
    expect((await auto.remove()).ok).toBe(true);
    expect((await auto.status()).lines.join("")).toContain("not installed");
    expect((await auto.remove()).ok).toBe(false);
  });

  test("non-Windows platforms get an actionable unsupported result", async () => {
    const auto = createAutostart({ platform: "darwin" });
    const result = await auto.install();
    expect(result.ok).toBe(false);
    expect(result.lines.join("")).toContain("Windows");
  });
});
