import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Policy } from "@omp-toolkit/core";

const execFileAsync = promisify(execFile);

export const DEFAULT_POLICY_CONFIG_KEY = "auth.accountPolicies";

export const DEFAULT_EXEC_OPTS = {
  encoding: "utf8" as const,
  timeout: 25_000,
  windowsHide: true,
  maxBuffer: 2 * 1024 * 1024,
};

export interface PolicyStoreOptions {
  configKey?: string;
  ompBin?: string | (() => string);
  execFileFn?: (
    file: string,
    args: string[],
    options: typeof DEFAULT_EXEC_OPTS,
  ) => Promise<{ stdout: string | Buffer }>;
}

/**
 * Deep module encapsulating OMP routing policy persistence,
 * serialization, atomic updates, and temporary exclusions.
 */
export class RoutingPolicyStore {
  private readonly configKey: string;
  private readonly ompBinResolver: () => string;
  private readonly execFile: (
    file: string,
    args: string[],
    options: typeof DEFAULT_EXEC_OPTS,
  ) => Promise<{ stdout: string | Buffer }>;

  constructor(options: PolicyStoreOptions = {}) {
    this.configKey = options.configKey ?? DEFAULT_POLICY_CONFIG_KEY;
    const bin = options.ompBin ?? process.env.OMP_BIN ?? "omp";
    this.ompBinResolver = typeof bin === "function" ? bin : () => bin;
    this.execFile =
      options.execFileFn ??
      ((file, args, opts) => execFileAsync(file, args, opts) as Promise<{ stdout: string }>);
  }

  getOmpBin(): string {
    return this.ompBinResolver();
  }

  private async fetchPolicies(strict: boolean): Promise<Policy[]> {
    try {
      const { stdout } = await this.execFile(
        this.getOmpBin(),
        ["config", "get", this.configKey],
        DEFAULT_EXEC_OPTS,
      );
      const trimmed = String(stdout).trim();
      const parsed = JSON.parse(trimmed || "[]");
      if (!Array.isArray(parsed)) {
        if (strict) {
          throw new Error("auth.accountPolicies is not an array");
        }
        return [];
      }
      return parsed as Policy[];
    } catch (error) {
      if (strict) {
        throw error;
      }
      return [];
    }
  }

  async readPolicies(): Promise<Policy[]> {
    return this.fetchPolicies(false);
  }

  async readPoliciesStrict(): Promise<Policy[]> {
    return this.fetchPolicies(true);
  }

  async writePolicies(policies: Policy[]): Promise<void> {
    await this.execFile(
      this.getOmpBin(),
      ["config", "set", this.configKey, JSON.stringify(policies)],
      DEFAULT_EXEC_OPTS,
    );
  }
}
