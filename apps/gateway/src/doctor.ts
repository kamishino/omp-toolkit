import fs from "node:fs";
import {
  type DoctorCheck,
  type DoctorFacts,
  doctorPassed,
  evaluateDoctorChecks,
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

export function renderDoctorText(report: DoctorReport): string[] {
  const lines = report.checks.map((c) => `${c.status.toUpperCase()} ${c.id}: ${c.detail}`);
  lines.push(
    report.passed ? "doctor: PASS" : "doctor: FAIL (fix the FAIL items above; start is refused)",
  );
  return lines;
}
