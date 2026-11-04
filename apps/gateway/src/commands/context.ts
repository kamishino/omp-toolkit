import fs from "node:fs";
import type { AccountPolicyLike } from "@omp-toolkit/core";
import { type BrokerClient, createBrokerClient } from "../broker-client";
import type { GatewayCtlConfig } from "../config";
import type { DoctorDependencies } from "../doctor";
import { createOmpAdapter, type OmpAdapter } from "../omp-adapter";
import type { ViewsDependencies } from "../views";

export const POLICY_KEY = "auth.accountPolicies";

export interface CommandContext {
  config: GatewayCtlConfig;
  adapter: OmpAdapter;
  client: BrokerClient;
  doctorDeps: DoctorDependencies;
  viewsDeps: ViewsDependencies;
  readPoliciesRaw(): Promise<string>;
}

export function createCommandContext(config: GatewayCtlConfig): CommandContext {
  const adapter = createOmpAdapter(config.ompBin);
  const client = createBrokerClient(config);
  const doctorDeps = { adapter, client, config };
  const readPoliciesRaw = async (): Promise<string> => {
    const out = await adapter.runOmpText(["config", "get", POLICY_KEY]);
    if (out === null) throw new Error("omp config get auth.accountPolicies failed");
    return out;
  };
  const getPolicies = async (): Promise<AccountPolicyLike[]> => {
    const parsed: unknown = JSON.parse((await readPoliciesRaw()).trim() || "[]");
    return Array.isArray(parsed) ? (parsed as AccountPolicyLike[]) : [];
  };
  const viewsDeps: ViewsDependencies = {
    client,
    readTextFile: (p) => fs.readFileSync(p, "utf-8"),
    fileExists: fs.existsSync,
    clientsPath: config.clientsPath,
    provider: config.provider,
    getPolicies,
  };
  return { config, adapter, client, doctorDeps, viewsDeps, readPoliciesRaw };
}
