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

  async readPolicies(): Promise<Policy[]> {
    try {
      const { stdout } = await this.execFile(
        this.getOmpBin(),
        ["config", "get", this.configKey],
        DEFAULT_EXEC_OPTS,
      );
      const parsed = JSON.parse(String(stdout).trim() || "[]");
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed as Policy[];
    } catch {
      return [];
    }
  }

  async writePolicies(policies: Policy[]): Promise<void> {
    await this.execFile(
      this.getOmpBin(),
      ["config", "set", this.configKey, JSON.stringify(policies)],
      DEFAULT_EXEC_OPTS,
    );
  }

  async addExclusion(
    provider: string,
    email: string,
    reservePct = 100,
  ): Promise<{ changed: boolean; policies: Policy[] }> {
    const policies = await this.readPolicies();
    const existing = policies.find(
      (p) => p?.provider === provider && p?.account?.email?.toLowerCase() === email.toLowerCase(),
    );

    if (existing) {
      if (existing.reservePct === reservePct) {
        return { changed: false, policies };
      }
      existing.reservePct = reservePct;
      await this.writePolicies(policies);
      return { changed: true, policies };
    }

    policies.push({
      provider,
      account: { email },
      reservePct,
    });
    await this.writePolicies(policies);
    return { changed: true, policies };
  }

  async removeExclusions(
    provider: string,
    emails: Set<string>,
  ): Promise<{ removed: string[]; policies: Policy[] }> {
    const policies = await this.readPolicies();
    const removed: string[] = [];

    const next = policies.filter((policy) => {
      if (
        policy?.provider === provider &&
        typeof policy?.account?.email === "string" &&
        emails.has(policy.account.email)
      ) {
        removed.push(policy.account.email);
        return false;
      }
      return true;
    });

    if (removed.length > 0) {
      await this.writePolicies(next);
    }
    return { removed, policies: next };
  }
}
