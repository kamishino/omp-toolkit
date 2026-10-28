import fs from "node:fs";
import path from "node:path";
import {
  appendPacingSample,
  extractPacingSamples,
  type PacingSample,
  parsePacingSamplesFile,
  prunePacingSamples,
  resolvePacingSamplesPath,
  serializePacingSamplesFile,
  type UsageReport,
} from "@omp-toolkit/core";

function writeFileAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, content);
  try {
    fs.renameSync(temp, file);
  } catch {
    fs.writeFileSync(file, content);
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Best effort
    }
  }
}

export function recordAndLoadPacingSamples(
  reports: UsageReport[],
  options?: {
    agentDir?: string;
    now?: number;
    filePath?: string;
  },
): Record<string, PacingSample[]> {
  const now = options?.now ?? Date.now();
  const filePath =
    options?.filePath ??
    resolvePacingSamplesPath(
      options?.agentDir ? { PI_CODING_AGENT_DIR: options.agentDir } : process.env,
    );

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
    const extracted = extractPacingSamples(reports, now);
    let modified = false;

    for (const [acc, list] of Object.entries(accounts)) {
      const pruned = prunePacingSamples(list, now);
      if (pruned.length !== list.length) {
        accounts[acc] = pruned;
        modified = true;
      }
    }

    for (const { account, sample } of extracted) {
      const existing = accounts[account] ?? [];
      const updated = appendPacingSample(existing, sample, now);
      if (
        updated.length !== existing.length ||
        (updated.length > 0 &&
          existing.length > 0 &&
          updated[updated.length - 1] !== existing[existing.length - 1])
      ) {
        accounts[account] = updated;
        modified = true;
      }
    }

    const serialized = serializePacingSamplesFile(accounts);
    if (modified || (raw.length === 0 && Object.keys(accounts).length > 0)) {
      writeFileAtomic(filePath, serialized);
    }
  } catch {
    // Best effort: never throw from sampler
  }

  return accounts;
}
