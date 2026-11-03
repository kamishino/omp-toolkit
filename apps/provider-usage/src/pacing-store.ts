import fs from "node:fs";
import {
  type PacingSample,
  parsePacingSamplesFile,
  resolvePacingSamplesPath,
  serializePacingSamplesFile,
  type UsageReport,
  updatePacingSamples,
} from "@omp-toolkit/core";
import { writeFileAtomic } from "./fs-util";

export interface PacingStoreOptions {
  agentDir?: string;
  env?: Record<string, string | undefined>;
  now?: number;
  filePath?: string;
}

export function recordAndLoadPacingSamples(
  reports: UsageReport[],
  options?: PacingStoreOptions,
): Record<string, PacingSample[]> {
  const now = options?.now ?? Date.now();
  const env =
    options?.env ?? (options?.agentDir ? { PI_CODING_AGENT_DIR: options.agentDir } : process.env);
  const filePath = options?.filePath ?? resolvePacingSamplesPath(env);

  let raw = "";
  let accounts: Record<string, PacingSample[]> = {};

  try {
    if (fs.existsSync(filePath)) {
      raw = fs.readFileSync(filePath, "utf8");
      accounts = parsePacingSamplesFile(raw);
    }
  } catch {
    accounts = {};
  }

  try {
    const { accounts: updated, modified } = updatePacingSamples(accounts, reports, now);
    accounts = updated;

    const serialized = serializePacingSamplesFile(accounts);
    if (modified || (raw.length === 0 && Object.keys(accounts).length > 0)) {
      writeFileAtomic(filePath, serialized);
    }
  } catch {
    // Best effort: never throw from sampler
  }

  return accounts;
}
