import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import {
  filterActiveReports,
  type HealthSnapshot,
  UsageDataSource,
  type UsageDataSourceAdapter,
  type UsageReport,
} from "@omp-toolkit/core";

const execFileAsync = promisify(execFile);

export const defaultAdapter: UsageDataSourceAdapter = {
  execFile: async (file, args, options) => {
    return execFileAsync(file, args, {
      encoding: "utf8",
      timeout: options?.timeout,
      windowsHide: options?.windowsHide,
      maxBuffer: options?.maxBuffer,
      signal: options?.signal,
    });
  },
  readFile: (path) => fs.readFileSync(path, "utf8"),
};

export const defaultDataSource = new UsageDataSource(defaultAdapter);

export async function fetchUsage(): Promise<UsageReport[]> {
  const [reports, authenticated] = await Promise.all([
    defaultDataSource.fetchReports(),
    defaultDataSource.fetchAuthenticatedProviders(),
  ]);
  return filterActiveReports(reports, authenticated);
}

export function readSnapshot(): HealthSnapshot | null {
  return defaultDataSource.readSnapshot();
}
