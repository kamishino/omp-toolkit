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
  drain: "drain",
  undrain: "undrain",
  "drain-all": "drain-all",
  "unblock-all": "unblock-all",
  block: "block",
  unblock: "unblock",
  policy: "policy",
  "remote-pack": "remote-pack",
  "remote-pair": "remote-pair",
  "autostart-install": "autostart-install",
  "autostart-remove": "autostart-remove",
  "autostart-status": "autostart-status",
};

const MANUAL_WRITE_ACTIONS: Record<string, true> = {
  "client-add": true,
  "client-revoke": true,
  block: true,
  unblock: true,
  drain: true,
  undrain: true,
  "drain-all": true,
  "unblock-all": true,
  policy: true,
};

export function formatGatewayOutput(action: string, res: GatewayCtlResult): string {
  const text = (res.stdout || res.stderr || "").trim();
  if (!text) {
    return res.exitCode === 0
      ? `✅ Gateway ${action} succeeded.`
      : `❌ Gateway ${action} failed (code ${res.exitCode}).`;
  }

  if (res.exitCode !== 0 && MANUAL_WRITE_ACTIONS[action]) {
    return `❌ Gateway ${action} did not complete cleanly (code ${res.exitCode}).\n\n${text}`;
  }

  if (action === "status") {
    const isUp = text.includes("running");
    return [
      `### 🌐 Gateway Status`,
      ``,
      isUp
        ? `> **State:** 🟢 Active (services running)`
        : `> **State:** 🔴 Inactive / Partially Down`,
      ``,
      "```",
      text,
      "```",
    ].join("\n");
  }

  if (action === "doctor") {
    const isPass = text.includes("doctor: PASS");
    return [
      `### 🩺 Gateway Compatibility Doctor`,
      ``,
      isPass
        ? `> **Result:** ✅ PASS — System ready for gateway operation.`
        : `> **Result:** ❌ FAIL — Some checks require attention.`,
      ``,
      "```",
      text,
      "```",
    ].join("\n");
  }

  if (action === "connect" || action === "recipe" || action === "remote-pair") {
    return [`### 🔌 Gateway Client Setup`, ``, "```bash", text, "```"].join("\n");
  }

  if (action === "accounts" || action === "clients" || action === "pool") {
    return [`### 📋 Gateway ${action.toUpperCase()}`, ``, "```", text, "```"].join("\n");
  }

  return text;
}
export async function handleGatewayCommand(
  rawArgs: string[],
  deps: GatewayCommandDependencies = {},
): Promise<string> {
  const run = deps.runCtl ?? defaultRunCtl;
  const action = (rawArgs[0] || "status").toLowerCase();
  const subArgs = rawArgs.slice(1);

  if (action === "connect") {
    const platform = (subArgs[0] || "claude-code").toLowerCase();
    const res = await run("connect", subArgs.length > 0 ? subArgs : [platform]);
    return formatGatewayOutput("connect", res);
  }

  if (action === "client-add") {
    const clientName = subArgs[0]?.trim();
    if (!clientName) {
      return "Usage: /gateway client-add <name> [--models=<provider/*,...>] [--account-id=<id>]";
    }
    const res = await run("clients-add", subArgs);
    return formatGatewayOutput("client-add", res);
  }

  if (action === "recipe") {
    const platform = (subArgs[0] || "claude-code").toLowerCase();
    const res = await run("recipe", [platform]);
    return formatGatewayOutput("recipe", res);
  }

  const mapped = PASSTHROUGH[action];
  if (mapped) {
    const res = await run(mapped, subArgs);
    return formatGatewayOutput(action, res);
  }

  return [
    "Usage: /gateway <action> [options]  (Bun gateway control plane)",
    "",
    "Actions:",
    "  /gateway status                 Broker/gateway lifecycle state",
    "  /gateway doctor                 Fail-closed compatibility checks",
    "  /gateway start|stop|restart     Manage broker + gateway (managed pids only)",
    "  /gateway connect <tool> [name]  1-step onboarding (Claude Code, Cursor, Cline, ...)",
    "  /gateway remote-pair <tool>     1-click secondary PC setup script",
    "  /gateway accounts               Antigravity accounts, blocks, policies (masked)",
    "  /gateway pool                   Pool availability + pin distribution",
    "  /gateway clients                Scoped client tokens (fingerprints only)",
    "  /gateway client-add <name>      Issue a scoped client token (shown once)",
    "  /gateway client-revoke <name>   Revoke a scoped client token",
    "  /gateway drain <account-id>     Set reservePct=100 policy",
    "  /gateway undrain <account-id>   Restore pre-drain policy",
    "  /gateway block <id> [--sec=900] Block account cooling period",
    "  /gateway unblock <id>           Clear operator block",
    "  /gateway recipe [platform]      Loopback setup snippet (claude-code, opencode, ...)",
  ].join("\n");
}
