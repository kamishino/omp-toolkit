import { describe, expect, test } from "bun:test";
import { appleScriptString, commandLine, orcaInvocation, terminalInvocations } from "./open";

describe("open-commands helpers", () => {
  test("appleScriptString escapes quotes and backslashes in double-quoted strings", () => {
    expect(appleScriptString('echo "hello\\world"')).toBe('"echo \\"hello\\\\world\\""');
  });
  test("appleScriptString escapes newlines and carriage returns to prevent AppleScript injection", () => {
    const payload = 'echo "hello\ntell application \\"Finder\\" to activate\r"';
    const escaped = appleScriptString(payload);
    expect(escaped).not.toContain("\n");
    expect(escaped).not.toContain("\r");
    expect(escaped).toContain("\\n");
    expect(escaped).toContain("\\r");
  });

  test("commandLine quotes arguments with spaces on Windows and POSIX-quotes elsewhere", () => {
    const cmd = ["C:\\Program Files\\bun.exe", "run", "--flag"];
    expect(commandLine("win32", cmd)).toBe('"C:\\Program Files\\bun.exe" run --flag');
    expect(commandLine("linux", ["bun", "/path/with space/script.js", "$HOME"])).toBe(
      "bun '/path/with space/script.js' \\$HOME",
    );
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
