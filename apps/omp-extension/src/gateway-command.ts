import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveAgentDir } from "@omp-toolkit/core";

/**
 * Resolves the Bun gateway control-plane entry (ADR-0010):
 * 1. Installed copy under ~/.omp/agent/scripts/omp-gateway-ctl.js
 * 2. Checkout path via OMP_TOOLKIT_HOME (apps/gateway/dist/index.js)
 * 3. Relative development path from this file
 */
export function resolveGatewayCtlPath(
  env: Record<string, string | undefined> = process.env,
  agentDir?: string,
  fileExists: (p: string) => boolean = fs.existsSync,
): string {
  const dir = agentDir ?? resolveAgentDir(env);
  const installed = path.join(dir, "scripts", "omp-gateway-ctl.js");
  if (fileExists(installed)) return installed;

  const toolkitHome = env.OMP_TOOLKIT_HOME?.trim();
  if (toolkitHome) {
    const fromHome = path.join(toolkitHome, "apps", "gateway", "dist", "index.js");
    if (fileExists(fromHome)) return fromHome;
  }

  return path.resolve(__dirname, "../../../apps/gateway/dist/index.js");
}

export interface GatewayCtlResult {
  stdout: string;
  stderr?: string;
  exitCode: number;
}

export interface GatewayCommandDependencies {
  /** Runs `bun <gateway-ctl> <action> [...args]`. */
  runCtl?: (action: string, args?: string[]) => Promise<GatewayCtlResult>;
}

function defaultRunCtl(action: string, args: string[] = []): Promise<GatewayCtlResult> {
  const { promise, resolve } = Promise.withResolvers<GatewayCtlResult>();
  const ctlPath = resolveGatewayCtlPath();
  execFile(
    "bun",
    [ctlPath, action, ...args],
    { timeout: 120_000, windowsHide: true },
    (error, stdout, stderr) => {
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "number"
          ? error.code
          : error
            ? 1
            : 0;
      resolve({
        stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
        stderr: typeof stderr === "string" ? stderr : String(stderr ?? ""),
        exitCode: code,
      });
    },
  );
  return promise;
}

const PASSTHROUGH: Record<string, string> = {
  status: "status",
  start: "start",
  stop: "stop",
  restart: "restart",
  doctor: "doctor",
  accounts: "accounts",
  clients: "clients",
  pool: "pool",
  "client-revoke": "clients-revoke",
};

export async function handleGatewayCommand(
  rawArgs: string[],
  deps: GatewayCommandDependencies = {},
): Promise<string> {
  const run = deps.runCtl ?? defaultRunCtl;
  const action = (rawArgs[0] || "status").toLowerCase();
  const subArgs = rawArgs.slice(1);

  if (action === "client-add") {
    const clientName = subArgs[0]?.trim();
    if (!clientName) {
      return "Usage: /gateway client-add <name> [--models=<provider/*,...>] [--account-id=<id>]";
    }
    const res = await run("clients-add", subArgs);
    return res.stdout || res.stderr || `Client '${clientName}' configuration generated.`;
  }

  if (action === "recipe") {
    const platform = (subArgs[0] || "claude-code").toLowerCase();
    const res = await run("recipe", [platform]);
    return res.stdout || res.stderr || "No recipe output from gateway:ctl.";
  }

  const mapped = PASSTHROUGH[action];
  if (mapped) {
    const res = await run(mapped, subArgs);
    return res.stdout || res.stderr || `gateway:ctl ${mapped} finished with exit ${res.exitCode}.`;
  }

  return [
    "Usage: /gateway <action> [options]  (Bun gateway control plane)",
    "",
    "Actions:",
    "  /gateway status                 Broker/gateway lifecycle state",
    "  /gateway doctor                 Fail-closed compatibility checks",
    "  /gateway start|stop|restart     Manage broker + gateway (managed pids only)",
    "  /gateway accounts               Antigravity accounts, blocks, policies (masked)",
    "  /gateway pool                   Pool availability + pin distribution",
    "  /gateway clients                Scoped client tokens (fingerprints only)",
    "  /gateway client-add <name>      Issue a scoped client token (shown once)",
    "  /gateway client-revoke <name>   Revoke a scoped client token",
    "  /gateway recipe [platform]      Loopback setup snippet (claude-code, opencode, curl, ...)",
  ].join("\n");
}
