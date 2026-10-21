export interface Command {
  file: string;
  args: string[];
  cwd?: string;
}

export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function shQuoteCommand(command: string[]): string {
  return command.map(shQuote).join(" ");
}

export function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function commandLine(platform: NodeJS.Platform, command: string[]): string {
  if (platform === "win32") {
    return command
      .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
      .join(" ");
  }
  return shQuoteCommand(command);
}

export function terminalInvocations(platform: NodeJS.Platform, command: string[]): Command[] {
  if (platform === "win32") {
    return [
      {
        file: "cmd.exe",
        args: ["/c", "start", "", ...command],
      },
    ];
  }

  if (platform === "darwin") {
    const shellCmd = shQuoteCommand(command);
    return [
      {
        file: "osascript",
        args: [
          "-e",
          'tell application "Terminal" to activate',
          "-e",
          `tell application "Terminal" to do script ${appleScriptString(shellCmd)}`,
        ],
      },
    ];
  }

  // Linux candidates
  return [
    { file: "x-terminal-emulator", args: ["-e", ...command] },
    { file: "gnome-terminal", args: ["--", ...command] },
    { file: "konsole", args: ["-e", ...command] },
    { file: "xterm", args: ["-e", ...command] },
  ];
}

export function orcaInvocation(checkout: string, bun: string): Command {
  return {
    file: bun,
    args: ["run", "monitor:orca", "--restart"],
    cwd: checkout,
  };
}
