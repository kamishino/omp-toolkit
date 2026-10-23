import fs from "node:fs";
import path from "node:path";
import { resolveAgentDir } from "../packages/core/src/environment";

const root = path.resolve(import.meta.dir, "..");
const agentDir = resolveAgentDir();
const extensionsDir = path.join(agentDir, "extensions");
const scriptsDir = path.join(agentDir, "scripts");
const backupDir = path.join(agentDir, "backups", new Date().toISOString().replace(/[:.]/g, "-"));
const dryRun = process.argv.includes("--dry-run");

function backup(target: string): void {
  if (!fs.existsSync(target)) return;
  fs.mkdirSync(backupDir, { recursive: true });
  const destination = path.join(backupDir, path.basename(target));
  fs.copyFileSync(target, destination);
  console.log(`backed up ${path.basename(target)} -> ${destination}`);
}

function install(source: string, destination: string): void {
  if (!fs.existsSync(source)) {
    throw new Error(`missing build artifact: ${source} (run bun run build)`);
  }
  if (dryRun) {
    console.log(`would install ${source} -> ${destination}`);
    return;
  }
  backup(destination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  console.log(`installed ${destination}`);
}

function removeLegacy(target: string): void {
  if (dryRun) {
    console.log(`would remove legacy ${target}`);
    return;
  }
  backup(target);
  fs.rmSync(target, { force: true });
  console.log(`removed legacy ${target}`);
}

install(
  path.join(root, "apps/omp-extension/dist/index.js"),
  path.join(extensionsDir, "gemini-health.js"),
);
install(
  path.join(root, "apps/provider-usage/dist/index.js"),
  path.join(scriptsDir, "omp-provider-usage.js"),
);

removeLegacy(path.join(extensionsDir, "gemini-health.ts"));
removeLegacy(path.join(scriptsDir, "omp-provider-usage.ts"));
removeLegacy(path.join(scriptsDir, "gemini-usage.ts"));

if (dryRun) {
  console.log("OMP toolkit install dry run complete.");
} else {
  console.log("OMP toolkit installed.");
  console.log(
    `Monitor in any terminal: bun "${path.join(agentDir, "scripts", "omp-provider-usage.js")}" --watch --health`,
  );
  console.log("Desktop widget: bun run widget");
  console.log("Orca tab (optional): bun run monitor:orca");
  console.log("OMP command: /gemini-health");
}
