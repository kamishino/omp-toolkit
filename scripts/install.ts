import { spawn } from "node:child_process";
import path from "node:path";

if (import.meta.main) {
  const installScript = path.join(import.meta.dir, "install", "install.ts");
  const child = spawn(process.execPath, [installScript, ...process.argv.slice(2)], {
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}
