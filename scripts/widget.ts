import { spawn } from "node:child_process";
import path from "node:path";

if (import.meta.main) {
  const widgetScript = path.join(import.meta.dir, "desktop", "widget.ts");
  const child = spawn(process.execPath, [widgetScript, ...process.argv.slice(2)], {
    stdio: "inherit",
  });

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      child.kill(sig);
    });
  }

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}
