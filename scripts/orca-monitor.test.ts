import { describe, expect, test } from "bun:test";
import {
  buildMonitorCommand,
  floatingShortcut,
  isOrcaAvailable,
  quoteArg,
  resolveOrcaBin,
} from "./orca-monitor";

describe("cross-platform Orca launcher", () => {
  test("resolves ORCA_BIN first", () => {
    expect(resolveOrcaBin({ ORCA_BIN: "/custom/orca", ORCA_CLI_COMMAND: "x" }, "linux")).toBe(
      "/custom/orca",
    );
  });

  test("resolves ORCA_CLI_COMMAND before platform defaults", () => {
    expect(resolveOrcaBin({ ORCA_CLI_COMMAND: "orca-managed" }, "linux")).toBe("orca-managed");
  });

  test("uses orca-dev for a dev checkout", () => {
    expect(resolveOrcaBin({ ORCA_DEV_REPO_ROOT: "/repo" }, "linux")).toBe("orca-dev");
  });

  test("uses orca-ide on Linux and orca elsewhere", () => {
    expect(resolveOrcaBin({}, "linux")).toBe("orca-ide");
    expect(resolveOrcaBin({}, "win32")).toBe("orca");
    expect(resolveOrcaBin({}, "darwin")).toBe("orca");
  });

  test("quotes for PowerShell and POSIX shells", () => {
    expect(quoteArg("C:\\Program Files\\bun.exe", "win32")).toBe('"C:\\Program Files\\bun.exe"');
    expect(quoteArg("/Users/me/bun", "darwin")).toBe("'/Users/me/bun'");
    expect(quoteArg("a'b", "linux")).toBe("'a'\\''b'");
  });

  test("uses the platform shortcut", () => {
    expect(floatingShortcut("darwin")).toBe("Cmd+Alt+A");
    expect(floatingShortcut("win32")).toBe("Ctrl+Alt+A");
    expect(floatingShortcut("linux")).toBe("Ctrl+Alt+A");
  });

  test("builds monitor command with platform specific syntax", () => {
    const winCmd = buildMonitorCommand(
      "monitor.ts",
      { interval: 5, health: true, altScreen: false, unknown: [] },
      "win32",
      "bun.exe",
    );
    expect(winCmd.startsWith("& ")).toBe(true);
    expect(winCmd).toContain('"bun.exe"');
    expect(winCmd).toContain('"--interval=5"');
    expect(winCmd).toContain('"--health"');

    const posixCmd = buildMonitorCommand(
      "monitor.ts",
      { interval: 10, health: false, altScreen: true, unknown: [] },
      "linux",
      "/usr/bin/bun",
    );
    expect(posixCmd.startsWith("& ")).toBe(false);
    expect(posixCmd).toContain("'/usr/bin/bun'");
    expect(posixCmd).toContain("'--interval=10'");
  });

  test("isOrcaAvailable returns false cleanly when binary missing", async () => {
    const available = await isOrcaAvailable(
      { ORCA_BIN: "definitely-nonexistent-orca-binary-12345" },
      "linux",
    );
    expect(available).toBe(false);
  });
});
