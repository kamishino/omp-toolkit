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
  | "help";

const COMMANDS: readonly string[] = [
  "doctor",
  "start",
  "stop",
  "restart",
  "status",
  "accounts",
  "clients",
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
  models: string[] | null;
  accountIds: number[];
  durationSeconds: number | null;
  priority: number | null;
  reservePct: number | null;
  force: boolean;
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
  const rawCommand = argv.find((a) => !a.startsWith("--"));
  const command: GatewayCommand =
    rawCommand && COMMANDS.includes(rawCommand) ? (rawCommand as GatewayCommand) : "help";

  const ompDir = env.OMP_CTL_HOME ?? path.join(home, ".omp");
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
  ];
  const unknown = argv.filter(
    (a) =>
      a.startsWith("--") &&
      a !== "--json" &&
      a !== "--force" &&
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
    unknown,
  };
}

export const GATEWAY_USAGE = `omp-toolkit gateway control plane (ADR-0010)

Usage: gateway:ctl <command> [target] [--json]
       [--broker-bind=127.0.0.1:8765] [--gateway-bind=127.0.0.1:4000]
       [--clients=<gateway-clients.json>] [--run-dir=<dir>] [--omp-bin=<path>]

Read commands:
  doctor    Fail-closed compatibility checks (binary, version, capabilities,
            token files, health, running-gateway drift)
  start     Start broker then gateway (doctor-gated, idempotent)
  stop      Stop only daemon-manager-recorded processes
  restart   Stop then start managed processes
  status    Per-process lifecycle state
  accounts  Antigravity accounts: check status, blocks, policies, quota (masked)
  clients   Scoped gateway clients (digests shown as fingerprints only)
  pool      Pool summary: availability, earliest reset, pin distribution
  recipe [claude-code|opencode|curl|python-openai|python-anthropic|vscode-continue]
            Loopback client setup snippet (placeholder token; default: harnesses)

Write commands (audited to History; blocks always expire):
  clients-add <name> [--models=p/*,...] [--account-id=<id> ...] [--force]
  clients-revoke <name>
  block <account-id> [--seconds=900]
  unblock <account-id>
  drain-all [--seconds=900]          Block every account (emergency)
  unblock-all                        Clear operator blocks on every account
  drain <account-id>                 Set reservePct=100 policy
  undrain <account-id>               Restore the pre-drain policy from audit
  policy <account-id> [--priority=<n>] [--reserve-pct=<0..100>]`;
