import fs from "node:fs";
import {
  type DoctorCheck,
  type DoctorFacts,
  doctorPassed,
  evaluateDoctorChecks,
  evaluateRemoteDoctorChecks,
  type RemoteDoctorFacts,
} from "@omp-toolkit/core";
import type { BrokerClient } from "./broker-client";
import type { GatewayCtlConfig } from "./config";
import type { OmpAdapter } from "./omp-adapter";

export interface DoctorDependencies {
  adapter: OmpAdapter;
  client: BrokerClient;
  config: GatewayCtlConfig;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  passed: boolean;
  exitCode: 0 | 1;
}

export async function gatherDoctorFacts(
  deps: DoctorDependencies,
  requireRunning: boolean,
): Promise<DoctorFacts> {
  const { adapter, client, config } = deps;
  const [
    ompPath,
    versionText,
    brokerHelp,
    gatewayHelp,
    brokerOk,
    gatewayOk,
    cloudflaredPath,
    tunnelOk,
    processes,
  ] = await Promise.all([
    adapter.resolveOmpPath(),
    adapter.runOmpText(["--version"]),
    adapter.runOmpText(["auth-broker", "--help"]),
    adapter.runOmpText(["auth-gateway", "--help"]),
    client.brokerHealth(),
    client.gatewayHealth(),
    config.withTunnel ? adapter.resolveCloudflaredPath(config.cloudflaredBin) : null,
    config.withTunnel ? client.tunnelHealth() : false,
    adapter.listOmpProcesses(),
  ]);

  // Only a gateway bound to *our* target bind can drift against this
  // deployment; other binds (e.g. an operator's :4000) are somebody else's.
  const gatewayProcesses = processes.filter((p) => p.commandLine.includes("auth-gateway"));
  const exact = gatewayProcesses.find((p) =>
    p.commandLine.includes(`--bind=${config.gatewayBind}`),
  );

  return {
    ompPath,
    versionText,
    brokerHelp,
    gatewayHelp,
    brokerTokenPresent: client.tokenPresent("broker"),
    gatewayTokenPresent: client.tokenPresent("gateway"),
    brokerHealth: brokerOk ? "ok" : "down",
    gatewayHealth: gatewayOk ? "ok" : "down",
    gatewayArgv: exact?.commandLine ?? null,
    expectedGatewayBind: config.gatewayBind,
    expectedClientsPath: config.clientsPath,
    requireRunning,
    tunnelRequested: config.withTunnel,
    cloudflaredPath,
    tunnelConfigPath: config.tunnelConfigPath,
    tunnelConfigPresent: config.withTunnel ? fs.existsSync(config.tunnelConfigPath) : false,
    tunnelHealth: tunnelOk ? "ok" : "down",
  };
}

export async function runDoctorChecks(
  deps: DoctorDependencies,
  requireRunning: boolean,
): Promise<DoctorReport> {
  const checks = evaluateDoctorChecks(await gatherDoctorFacts(deps, requireRunning));
  const passed = doctorPassed(checks);
  return { checks, passed, exitCode: passed ? 0 : 1 };
}

export async function gatherRemoteDoctorFacts(
  config: GatewayCtlConfig,
  fetchFn: typeof fetch = fetch,
): Promise<RemoteDoctorFacts> {
  const baseUrl = config.baseUrl?.replace(/\/$/, "") ?? null;
  const cfClientId = config.cfClientId;
  const cfClientSecret = config.cfClientSecret;
  const gatewayToken = config.gatewayToken;

  if (!baseUrl) {
    return {
      baseUrl: null,
      cfClientId,
      cfClientSecret,
      gatewayToken,
      cfProbeStatus: null,
      cfProbeError: "No base URL configured",
      authProbeStatus: null,
      authProbeError: "No base URL configured",
      models: null,
    };
  }

  const cfHeaders: Record<string, string> = {};
  if (cfClientId) cfHeaders["CF-Access-Client-Id"] = cfClientId;
  if (cfClientSecret) cfHeaders["CF-Access-Client-Secret"] = cfClientSecret;

  let cfProbeStatus: number | null = null;
  let cfProbeError: string | null = null;
  try {
    const res = await fetchFn(`${baseUrl}/v1/models`, {
      method: "GET",
      headers: cfHeaders,
      signal: AbortSignal.timeout(10_000),
    });
    cfProbeStatus = res.status;
  } catch (err) {
    cfProbeError = err instanceof Error ? err.message : String(err);
  }

  let authProbeStatus: number | null = null;
  let authProbeError: string | null = null;
  let models: string[] | null = null;

  if (gatewayToken) {
    try {
      const authHeaders: Record<string, string> = {
        ...cfHeaders,
        Authorization: `Bearer ${gatewayToken}`,
      };
      const res = await fetchFn(`${baseUrl}/v1/models`, {
        method: "GET",
        headers: authHeaders,
        signal: AbortSignal.timeout(10_000),
      });
      authProbeStatus = res.status;
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id?: string }> };
        if (Array.isArray(data?.data)) {
          models = data.data.map((m) => m.id).filter((id): id is string => typeof id === "string");
        }
      }
    } catch (err) {
      authProbeError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    baseUrl,
    cfClientId,
    cfClientSecret,
    gatewayToken,
    cfProbeStatus,
    cfProbeError,
    authProbeStatus,
    authProbeError,
    models,
  };
}

export async function runRemoteDoctorChecks(
  deps: DoctorDependencies,
  fetchFn: typeof fetch = fetch,
): Promise<DoctorReport> {
  const facts = await gatherRemoteDoctorFacts(deps.config, fetchFn);
  const checks = evaluateRemoteDoctorChecks(facts);
  const passed = doctorPassed(checks);
  return { checks, passed, exitCode: passed ? 0 : 1 };
}

export function doctorFixHint(checkId: string): string | null {
  switch (checkId) {
    case "omp-binary":
      return "Install OMP or add it to PATH. Run: omp --version";
    case "omp-version":
      return "Upgrade OMP to at least v18.16.0. Run: omp update";
    case "broker-capabilities":
    case "gateway-capabilities":
      return "Installed OMP lacks required gateway capabilities. Upgrade OMP.";
    case "token-files":
      return "Run: omp auth-broker token > ~/.omp/auth-broker.token && omp auth-gateway token > ~/.omp/auth-gateway.token";
    case "broker-health":
    case "gateway-health":
      return "Run: bun run gateway:ctl start";
    case "gateway-argv":
      return "Running gateway argv drifted. Run: bun run gateway:ctl restart";
    case "tunnel":
      return "Check tunnel config at ~/.omp/cloudflared/config.yml or start without --with-tunnel";
    case "remote-base-url":
      return "Pass --base-url=https://<tunnel-domain> or set ANTHROPIC_BASE_URL.";
    case "remote-cf-credentials":
      return "Set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET or run gateway:ctl remote-pair on the host.";
    case "remote-tunnel":
      return "Verify cloudflared tunnel is active on host and DNS hostname resolves.";
    case "remote-auth":
      return "Provide a valid gateway client token via ANTHROPIC_API_KEY or --gateway-token=<token>.";
    case "remote-models":
      return "Verify client token has access to google-antigravity/* in gateway-clients.json.";
    default:
      return null;
  }
}

export function renderDoctorText(report: DoctorReport): string[] {
  const lines: string[] = [];
  for (const c of report.checks) {
    lines.push(`${c.status.toUpperCase()} ${c.id}: ${c.detail}`);
    if (c.status === "fail") {
      const hint = doctorFixHint(c.id);
      if (hint && !c.detail.includes("run:")) {
        lines.push(`  -> Fix: ${hint}`);
      }
    }
  }
  lines.push(
    report.passed ? "doctor: PASS" : "doctor: FAIL (fix the FAIL items above; start is refused)",
  );
  return lines;
}
