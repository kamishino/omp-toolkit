import { describe, expect, test } from "bun:test";
import { floatingShortcut, quoteArg, resolveOrcaBin } from "./orca-monitor";

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
});
