import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import {
  type Account,
  DEFAULT_MODEL_WIRE,
  isRetryableRouteFailure,
  type ProbeResult,
  type ProbeSweep,
} from "@omp-toolkit/core";
import { DEFAULT_EXEC_OPTS, PROVIDER, resolveOmpBin } from "./config";
import { short } from "./fs-util";
import { classifyHttpResponse, inspectProbeStream } from "./probe-stream";

const execFileAsync = promisify(execFile);

export const DEFAULT_PROVIDER = PROVIDER;
export const DEFAULT_PROBE_TIMEOUT_MS = 15_000;
export const DEFAULT_PROBE_PROMPT = "Reply with exactly: OK";
export const DEFAULT_CONFIRM_DELAY_MS = 1_000;
export const DEFAULT_ENDPOINT =
  "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";

const UA_VERSION = process.env.PI_AI_ANTIGRAVITY_VERSION ?? "2.24.0";
export const DEFAULT_USER_AGENT = `antigravity/hub/${UA_VERSION} (aidev_client; os_type=darwin; arch=arm64; cl=963137146)`;

export interface ProbeClientOptions {
  endpoint?: string;
  userAgent?: string;
  modelWire?: string;
  probeTimeoutMs?: number;
  confirmDelayMs?: number;
  provider?: string;
  ompBin?: string | (() => string);
  now?: () => number;
  execFileFn?: (
    file: string,
    args: string[],
    options: typeof DEFAULT_EXEC_OPTS & { signal?: AbortSignal },
  ) => Promise<{ stdout: string | Buffer }>;
  fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Deep module encapsulating the Google Antigravity OAuth token acquisition,
 * in-memory token cache lifecycle, and SSE streaming HTTP health probes.
 */
export class AntigravityProbeClient {
  readonly endpoint: string;
  readonly userAgent: string;
  readonly modelWire: string;
  readonly probeTimeoutMs: number;
  readonly confirmDelayMs: number;
  readonly provider: string;
  private readonly now: () => number;
  private readonly ompBinResolver: () => string;
  private readonly execFile: (
    file: string,
    args: string[],
    options: typeof DEFAULT_EXEC_OPTS & { signal?: AbortSignal },
  ) => Promise<{ stdout: string | Buffer }>;
  private readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  private readonly tokenCache = new Map<string, { token: string; at: number; index: number }>();

  constructor(options: ProbeClientOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.modelWire = options.modelWire ?? DEFAULT_MODEL_WIRE;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.confirmDelayMs = options.confirmDelayMs ?? DEFAULT_CONFIRM_DELAY_MS;
    this.provider = options.provider ?? DEFAULT_PROVIDER;
    this.now = options.now ?? (() => Date.now());

    const bin = options.ompBin ?? resolveOmpBin();
    this.ompBinResolver = typeof bin === "function" ? bin : () => bin;

    this.execFile =
      options.execFileFn ??
      ((file, args, opts) => execFileAsync(file, args, opts) as Promise<{ stdout: string }>);
    this.fetch = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  getOmpBin(): string {
    return this.ompBinResolver();
  }

  clearTokenCache(): void {
    this.tokenCache.clear();
  }

  getTokenCacheSize(): number {
    return this.tokenCache.size;
  }

  async tokenList(): Promise<Map<string, number>> {
    const { stdout } = await this.execFile(
      this.getOmpBin(),
      ["token", this.provider, "--list"],
      DEFAULT_EXEC_OPTS,
    );
    const map = new Map<string, number>();
    for (const line of String(stdout).split(/\r?\n/)) {
      const match = /^(\d+)\.\s+(\S+@\S+)\s*$/.exec(line.trim());
      if (match) map.set(match[2].toLowerCase(), Number(match[1]));
    }
    return map;
  }

  async loadAccounts(): Promise<Account[]> {
    const [tokenMap, { stdout }] = await Promise.all([
      this.tokenList(),
      this.execFile(
        this.getOmpBin(),
        ["usage", "--provider", this.provider, "--json"],
        DEFAULT_EXEC_OPTS,
      ),
    ]);
    if (tokenMap.size === 0) {
      return [];
    }

    const parsed = JSON.parse(String(stdout));
    const reports = Array.isArray(parsed?.reports) ? parsed.reports : [];

    const accountsByEmail = new Map<string, Account>();
    for (const report of reports) {
      const email =
        typeof report?.metadata?.email === "string" ? report.metadata.email.trim() : undefined;
      const project =
        typeof report?.metadata?.projectId === "string"
          ? report.metadata.projectId.trim()
          : undefined;
      if (!email) continue;
      const lower = email.toLowerCase();
      const index = tokenMap.get(lower);
      if (index !== undefined) {
        if (!project) {
          throw new Error(
            `account "${email}" has token credentials but missing required projectId metadata`,
          );
        }
        if (!accountsByEmail.has(lower)) {
          accountsByEmail.set(lower, { index, email, project });
        }
      }
    }

    for (const [tokenEmail, index] of tokenMap.entries()) {
      if (!accountsByEmail.has(tokenEmail)) {
        throw new Error(
          `account "${tokenEmail}" (index ${index}) is present in token list but missing usage metadata`,
        );
      }
    }

    return [...accountsByEmail.values()].sort((a, b) => a.index - b.index);
  }

  async getToken(
    accountOrIndex: Account | number,
    signal?: AbortSignal,
    timeoutMs: number = 25_000,
  ): Promise<string> {
    const isAccount = typeof accountOrIndex === "object" && accountOrIndex !== null;
    const index = isAccount ? accountOrIndex.index : accountOrIndex;
    const cacheKey = isAccount ? accountOrIndex.email.trim().toLowerCase() : String(index);

    const cached = this.tokenCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 30 * 60_000 && cached.index === index) {
      return cached.token;
    }

    const { stdout } = await this.execFile(
      this.getOmpBin(),
      ["token", this.provider, "-a", String(index), "--raw"],
      {
        ...DEFAULT_EXEC_OPTS,
        timeout: Math.max(1000, timeoutMs),
        signal,
      },
    );
    const token = String(stdout).trim();
    if (!token) throw new Error(`empty token for account ${index}`);
    this.tokenCache.set(cacheKey, { token, at: Date.now(), index });
    return token;
  }

  async probe(account: Account): Promise<ProbeResult> {
    const startedAt = this.now();
    const perfStart = performance.now();

    const controller = new AbortController();
    let timedOut = false;
    let headersReceived = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.probeTimeoutMs);

    try {
      let token: string;
      try {
        const remainingMs = Math.max(
          1000,
          this.probeTimeoutMs - Math.round(performance.now() - perfStart),
        );
        token = await this.getToken(account, controller.signal, remainingMs);
      } catch (error) {
        return {
          ...account,
          provider: "google-antigravity",
          model: this.modelWire,
          status: "auth",
          ms: Math.round(performance.now() - perfStart),
          startedAt,
          checkedAt: this.now(),
          failureKind: "credential",
          confirmed: false,
          detail: short(error),
        };
      }

      let response: Response;
      try {
        response = await this.fetch(this.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "User-Agent": this.userAgent,
          },
          body: JSON.stringify({
            project: account.project,
            requestId: `agent/${crypto.randomUUID()}/${Date.now()}/${crypto.randomUUID()}/0`,
            userAgent: "antigravity",
            model: this.modelWire,
            request: {
              contents: [{ role: "user", parts: [{ text: DEFAULT_PROBE_PROMPT }] }],
              generationConfig: { maxOutputTokens: 8 },
              sessionId: crypto.randomUUID(),
            },
          }),
          signal: controller.signal,
        });
        headersReceived = true;
      } catch (error) {
        if (timedOut) {
          return {
            ...account,
            provider: "google-antigravity",
            model: this.modelWire,
            status: "error",
            ms: Math.round(performance.now() - perfStart),
            startedAt,
            checkedAt: this.now(),
            failureKind: "network",
            confirmed: false,
            detail: `network timeout in ${this.probeTimeoutMs / 1000}s`,
          };
        }
        throw error;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const verdict = classifyHttpResponse(response.status, body);
        if (verdict.status === "auth") {
          this.tokenCache.delete(account.email.trim().toLowerCase());
        }
        return {
          ...account,
          provider: "google-antigravity",
          model: this.modelWire,
          status: verdict.status,
          ms: Math.round(performance.now() - perfStart),
          startedAt,
          checkedAt: this.now(),
          failureKind: verdict.failureKind,
          confirmed: false,
          detail: verdict.detail,
        };
      }

      if (!response.body) {
        return {
          ...account,
          provider: "google-antigravity",
          model: this.modelWire,
          status: "error",
          ms: Math.round(performance.now() - perfStart),
          startedAt,
          checkedAt: this.now(),
          failureKind: "protocol",
          confirmed: false,
          detail: "empty response body",
        };
      }

      const streamVerdict = await inspectProbeStream(response.body, controller.signal);
      if (streamVerdict.status === "auth") {
        this.tokenCache.delete(account.email.trim().toLowerCase());
      }
      return {
        ...account,
        provider: "google-antigravity",
        model: this.modelWire,
        status: streamVerdict.status,
        ms: Math.round(performance.now() - perfStart),
        startedAt,
        checkedAt: this.now(),
        failureKind: streamVerdict.failureKind,
        confirmed: false,
        ...(streamVerdict.detail ? { detail: streamVerdict.detail } : {}),
      };
    } catch (error) {
      const elapsed = Math.round(performance.now() - perfStart);
      if (timedOut) {
        const status = headersReceived ? "hang" : "error";
        const failureKind = headersReceived ? "timeout" : "network";
        const detail = headersReceived
          ? `no first event in ${this.probeTimeoutMs / 1000}s`
          : `network timeout in ${this.probeTimeoutMs / 1000}s`;
        return {
          ...account,
          provider: "google-antigravity",
          model: this.modelWire,
          status,
          ms: elapsed,
          startedAt,
          checkedAt: this.now(),
          failureKind,
          confirmed: false,
          detail,
        };
      }

      return {
        ...account,
        provider: "google-antigravity",
        model: this.modelWire,
        status: "error",
        ms: elapsed,
        startedAt,
        checkedAt: this.now(),
        failureKind: "network",
        confirmed: false,
        detail: short(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async checkAll(confirm = false): Promise<ProbeSweep> {
    const startedAt = this.now();
    const accounts = await this.loadAccounts();
    if (accounts.length === 0) {
      return { startedAt, results: [] };
    }

    const results = await Promise.all(accounts.map((acc) => this.probe(acc)));
    if (!confirm) {
      return { startedAt, results };
    }

    const suspects = results.filter((result) => isRetryableRouteFailure(result));
    await Promise.all(
      suspects.map(async (result) => {
        await sleep(this.confirmDelayMs);
        const again = await this.probe(result);
        if (isRetryableRouteFailure(again)) {
          result.status = again.status;
          result.failureKind = again.failureKind;
          result.ms = again.ms;
          result.startedAt = again.startedAt;
          result.checkedAt = again.checkedAt;
          result.detail = `${again.detail ?? ""}${again.detail ? " · " : ""}confirmed`;
          result.confirmed = true;
        } else {
          result.status = again.status;
          result.failureKind = again.failureKind;
          result.ms = again.ms;
          result.startedAt = again.startedAt;
          result.checkedAt = again.checkedAt;
          result.detail = again.status === "ok" ? "recovered on retry" : (again.detail ?? "");
          result.confirmed = false;
        }
      }),
    );

    return { startedAt, results };
  }
}
