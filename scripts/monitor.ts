import { spawn } from "node:child_process";
import { monitorCommandArgs, parseMonitorArgs, resolveMonitorScript } from "./monitor-target";

const USAGE = "usage: bun run monitor [--interval=<seconds>] [--no-health] [--no-alt-screen]";

function main(): void {
  const options = parseMonitorArgs(process.argv.slice(2));
  if (options.unknown.length > 0) {
    console.error(`unknown option: ${options.unknown.join(", ")}`);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const script = resolveMonitorScript();
  const child = spawn(process.execPath, monitorCommandArgs(script, options), {
    stdio: "inherit",
    env: process.env,
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on("error", (error) => {
    console.error(`monitor: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

if (import.meta.main) main();
