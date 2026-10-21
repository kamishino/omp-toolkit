import { describe, expect, test } from "bun:test";
import {
  appleScriptString,
  commandLine,
  orcaInvocation,
  shQuote,
  shQuoteCommand,
  terminalInvocations,
} from "./open-commands";

describe("open-commands helpers", () => {
  test("shQuote wraps string in single quotes and escapes single quotes", () => {
    expect(shQuote("/path/with space")).toBe("'/path/with space'");
    expect(shQuote("it's cool")).toBe("'it'\\''s cool'");
  });

  test("shQuoteCommand joins quoted arguments with spaces", () => {
    expect(shQuoteCommand(["bun", "/path/script.js", "--watch"])).toBe(
      "'bun' '/path/script.js' '--watch'",
    );
  });

  test("appleScriptString escapes quotes and backslashes in double-quoted strings", () => {
    expect(appleScriptString('echo "hello\\world"')).toBe('"echo \\"hello\\\\world\\""');
  });

  test("commandLine quotes arguments with spaces on Windows and POSIX-quotes elsewhere", () => {
    const cmd = ["C:\\Program Files\\bun.exe", "run", "--flag"];
    expect(commandLine("win32", cmd)).toBe('"C:\\Program Files\\bun.exe" run --flag');
    expect(commandLine("linux", cmd)).toBe("'C:\\Program Files\\bun.exe' 'run' '--flag'");
  });

  test("terminalInvocations provides cmd.exe start on win32", () => {
    const inv = terminalInvocations("win32", ["bun", "monitor.js"]);
    expect(inv.length).toBe(1);
    expect(inv[0].file).toBe("cmd.exe");
    expect(inv[0].args).toEqual(["/c", "start", "", "bun", "monitor.js"]);
  });

  test("terminalInvocations provides osascript on darwin", () => {
    const inv = terminalInvocations("darwin", ["bun", "monitor.js"]);
    expect(inv.length).toBe(1);
    expect(inv[0].file).toBe("osascript");
    expect(inv[0].args[0]).toBe("-e");
    expect(inv[0].args[1]).toContain('tell application "Terminal"');
  });

  test("terminalInvocations provides candidate emulators on linux", () => {
    const inv = terminalInvocations("linux", ["bun", "monitor.js"]);
    expect(inv.length).toBe(4);
    expect(inv[0].file).toBe("x-terminal-emulator");
    expect(inv[1].file).toBe("gnome-terminal");
    expect(inv[2].file).toBe("konsole");
    expect(inv[3].file).toBe("xterm");
  });

  test("orcaInvocation constructs proper command", () => {
    const cmd = orcaInvocation("/checkout/root", "bun");
    expect(cmd).toEqual({
      file: "bun",
      args: ["run", "monitor:orca", "--restart"],
      cwd: "/checkout/root",
    });
  });
});
