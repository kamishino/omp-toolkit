import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type GatewayCommand =
  | "doctor"
  | "start"
  | "stop"
  | "restart"
  | "status"
  | "accounts"
  | "clients"
  | "models"
  | "clients-add"
  | "clients-revoke"
  | "pool"
  | "block"
  | "unblock"
  | "drain"
  | "undrain"
  | "drain-all"
  | "unblock-all"
  | "policy"
  | "recipe"
  | "connect"
  | "remote-pack"
  | "remote-pair"
  | "autostart-install"
  | "autostart-remove"
  | "autostart-status"
  | "help";

const COMMANDS: readonly string[] = [
  "doctor",
  "start",
  "stop",
  "restart",
  "status",
  "accounts",
  "clients",
  "models",
  "clients-add",
  "clients-revoke",
  "pool",
  "block",
  "unblock",
  "drain",
  "undrain",
  "drain-all",
  "unblock-all",
  "policy",
  "recipe",
  "connect",
  "remote-pack",
  "remote-pair",
  "autostart-install",
  "autostart-remove",
  "autostart-status",
  "help",
];

export interface GatewayCtlConfig {
  command: GatewayCommand;
  json: boolean;
  ompBin: string;
  brokerBind: string;
  gatewayBind: string;
  clientsPath: string;
  runDir: string;
  logsDir: string;
  brokerTokenPath: string;
  gatewayTokenPath: string;
  agentDbPath: string;
  historyDbPath: string;
  machinePath: string;
  provider: string;
  /** First positional after the command (client name or credential id). */
  target: string | null;
  positionals: string[];
  models: string[] | null;
  accountIds: number[];
  durationSeconds: number | null;
  priority: number | null;
  reservePct: number | null;
  force: boolean;
  /** Manage the cloudflared tunnel alongside broker/gateway (start/stop/status). */
  withTunnel: boolean;
  cloudflaredBin: string;
  tunnelConfigPath: string;
  tunnelMetricsBind: string;
  /** Recipe base URL override (remote access); defaults to the loopback gateway. */
  baseUrl: string | null;
  recipeModel: string | null;
  cfClientId: string | null;
  cfClientSecret: string | null;
  /** Client token rendered into remote packs (flag or OMP_GATEWAY_TOKEN env). */
  packGatewayToken: string | null;
  gatewayToken: string | null;
  remote: boolean;
  unknown: string[];
}

export function bindToBaseUrl(bind: string): string {
  return `http://${bind}`;
}

export function portOfBind(bind: string): number {
  const port = Number(bind.slice(bind.lastIndexOf(":") + 1));
  return Number.isFinite(port) ? port : 0;
}

function flagValue(argv: string[], name: string): string | undefined {
  const arg = argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : undefined;
}

function flagValues(argv: string[], name: string): string[] {
  return argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
}

function numberFlag(argv: string[], name: string): number | null {
  const raw = flagValue(argv, name);
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * CLI/env configuration for the gateway control plane (ADR-0010; S2 views +
 * lifecycle, S3 audited writes).
 */
export function parseGatewayCtlConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): GatewayCtlConfig {
  const isHelp =
    argv.includes("--help") ||
    argv.includes("-h") ||
    argv[0] === "help" ||
    argv.find((a) => !a.startsWith("--")) === "help";
  const rawCommand = argv.find((a) => !a.startsWith("--"));
  const command: GatewayCommand = isHelp
    ? "help"
    : rawCommand && COMMANDS.includes(rawCommand)
      ? (rawCommand as GatewayCommand)
      : "help";
  const ompDir = env.OMP_CTL_HOME ?? path.join(home, ".omp");
  const cfAccessFile = path.join(ompDir, "cf-access.json");
  let cfDisk: { clientId?: string; clientSecret?: string; domain?: string } | null = null;
  try {
    if (fs.existsSync(cfAccessFile)) {
      const raw = fs.readFileSync(cfAccessFile, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        cfDisk = parsed as { clientId?: string; clientSecret?: string; domain?: string };
      }
    }
  } catch {}

  const knownPrefixes = [
    "--broker-bind=",
    "--gateway-bind=",
    "--clients=",
    "--run-dir=",
    "--omp-bin=",
    "--models=",
    "--account-id=",
    "--seconds=",
    "--minutes=",
    "--priority=",
    "--reserve-pct=",
    "--cloudflared-bin=",
    "--tunnel-config=",
    "--tunnel-metrics-bind=",
    "--base-url=",
    "--model=",
    "--cf-client-id=",
    "--cf-client-secret=",
    "--gateway-token=",
  ];
  const unknown = isHelp
    ? []
    : argv.filter(
        (a) =>
          a.startsWith("--") &&
          a !== "--json" &&
          a !== "--force" &&
          a !== "--with-tunnel" &&
          a !== "--remote" &&
          a !== "--help" &&
          a !== "-h" &&
          !knownPrefixes.some((p) => a.startsWith(p)),
      );
  const positionals = argv.filter((a) => !a.startsWith("--")).slice(1);
  const seconds = numberFlag(argv, "seconds");
  const minutes = numberFlag(argv, "minutes");

  return {
    command,
    json: argv.includes("--json"),
    ompBin: flagValue(argv, "omp-bin") ?? env.OMP_BIN ?? "omp",
    brokerBind: flagValue(argv, "broker-bind") ?? "127.0.0.1:8765",
    gatewayBind: flagValue(argv, "gateway-bind") ?? "127.0.0.1:4000",
    clientsPath: flagValue(argv, "clients") ?? path.join(ompDir, "gateway-clients.json"),
    runDir: flagValue(argv, "run-dir") ?? path.join(ompDir, "run"),
    logsDir: path.join(ompDir, "logs"),
    brokerTokenPath: path.join(ompDir, "auth-broker.token"),
    gatewayTokenPath: path.join(ompDir, "auth-gateway.token"),
    agentDbPath: path.join(ompDir, "agent", "agent.db"),
    historyDbPath:
      env.OMP_TOOLKIT_HISTORY_DB ?? path.join(ompDir, "agent", "omp-toolkit-history.db"),
    machinePath: path.join(ompDir, "agent", "omp-toolkit-machine.json"),
    provider: "google-antigravity",
    target: positionals[0] ?? null,
    positionals,
    models: (() => {
      const raw = flagValue(argv, "models");
      return raw === undefined
        ? null
        : raw
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean);
    })(),
    accountIds: flagValues(argv, "account-id")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0),
    durationSeconds: seconds ?? (minutes !== null ? minutes * 60 : null),
    priority: numberFlag(argv, "priority"),
    reservePct: numberFlag(argv, "reserve-pct"),
    force: argv.includes("--force"),
    withTunnel: argv.includes("--with-tunnel") || env.OMP_WITH_TUNNEL === "1",
    cloudflaredBin: flagValue(argv, "cloudflared-bin") ?? env.OMP_CLOUDFLARED_BIN ?? "cloudflared",
    tunnelConfigPath:
      flagValue(argv, "tunnel-config") ??
      env.OMP_TUNNEL_CONFIG ??
      path.join(ompDir, "cloudflared", "config.yml"),
    tunnelMetricsBind: flagValue(argv, "tunnel-metrics-bind") ?? "127.0.0.1:48333",
    baseUrl:
      flagValue(argv, "base-url") ??
      env.OMP_GATEWAY_URL ??
      env.ANTHROPIC_BASE_URL ??
      env.OPENAI_BASE_URL ??
      (cfDisk?.domain ? `https://${cfDisk.domain}` : null),
    recipeModel: flagValue(argv, "model") ?? null,
    cfClientId:
      flagValue(argv, "cf-client-id") ??
      env.OMP_CF_CLIENT_ID ??
      env.CF_ACCESS_CLIENT_ID ??
      cfDisk?.clientId ??
      null,
    cfClientSecret:
      flagValue(argv, "cf-client-secret") ??
      env.OMP_CF_CLIENT_SECRET ??
      env.CF_ACCESS_CLIENT_SECRET ??
      cfDisk?.clientSecret ??
      null,
    gatewayToken:
      flagValue(argv, "gateway-token") ??
      env.OMP_GATEWAY_TOKEN ??
      env.ANTHROPIC_API_KEY ??
      env.OPENAI_API_KEY ??
      null,
    packGatewayToken: flagValue(argv, "gateway-token") ?? env.OMP_GATEWAY_TOKEN ?? null,
    remote: argv.includes("--remote"),
    unknown,
  };
}

export const GATEWAY_USAGE = `omp-toolkit gateway control plane (ADR-0010)

Usage: gateway:ctl <command> [target] [--json]
       [--broker-bind=127.0.0.1:8765] [--gateway-bind=127.0.0.1:4000]
       [--clients=<gateway-clients.json>] [--run-dir=<dir>] [--omp-bin=<path>]
       [--with-tunnel] [--tunnel-config=<config.yml>] [--cloudflared-bin=<path>]
       (env: OMP_WITH_TUNNEL=1 OMP_TUNNEL_CONFIG=<config.yml> OMP_CLOUDFLARED_BIN=<path>)

Read commands:
  doctor    Fail-closed compatibility checks (binary, version, capabilities,
            token files, health, running-gateway drift, tunnel when requested)
  start     Start broker then gateway (doctor-gated, idempotent);
            --with-tunnel also starts the cloudflared remote-access tunnel
  stop      Stop only daemon-manager-recorded processes
  restart   Stop then start managed processes
  status    Per-process lifecycle state
  accounts  Antigravity accounts: check status, blocks, policies, quota (masked)
  clients   Scoped gateway clients (digests shown as fingerprints only)
  models    Served model ids from the gateway (/v1/models; --json for array)
  pool      Pool summary: availability, earliest reset, pin distribution
  recipe [claude-code|codex|opencode|pi|cline|aider|goose|crush|qwen-code|hermes|dsh|curl|...]
            Client setup snippet (placeholder token; default: harnesses).
            Remote: --base-url=https://<host> [--model=<id>]
            [--cf-client-id=<id>] [--cf-client-secret=<secret>]
            (or OMP_CF_CLIENT_ID / OMP_CF_CLIENT_SECRET env)
  remote-pack dsh --base-url=https://<host> [--gateway-token=<tok> | OMP_GATEWAY_TOKEN]
            One copy-paste block for a remote PC (env commands + patch).
            Prints secrets: transmit the output securely, never commit it.
            Prefer env over flags: flag values land in shell history
  autostart-install|autostart-remove|autostart-status
            Windows Startup-folder entry that runs start at sign-in

Write & Onboarding commands (audited to History; blocks always expire):
  connect <platform> [name] [--force]
            1-step onboarding: registers client token and prints the exact
            copy-pasteable setup snippet (claude-code, opencode, cline, ...)
  remote-pair <platform> [name] [--base-url=<url>]
            1-click secondary PC setup script (PowerShell & Bash 1-liners)
  clients-add <name> [--models=p/*,...] [--account-id=<id> ...] [--force]
  clients-revoke <name>
  block <account-id> [--seconds=900]
  unblock <account-id>
  drain-all [--seconds=900]          Block every account (emergency)
  unblock-all                        Clear operator blocks on every account
  drain <account-id>                 Set reservePct=100 policy
  undrain <account-id>               Restore the pre-drain policy from audit
  policy <account-id> [--priority=<n>] [--reserve-pct=<0..100>]`;
