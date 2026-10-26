import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import type { Account, ProbeResult, Status } from "@omp-toolkit/core";
import { short } from "./fs-util";

const execFileAsync = promisify(execFile);

export const DEFAULT_PROVIDER = "google-antigravity";
export const DEFAULT_MODEL_WIRE = "gemini-3.8-flash-high";
export const DEFAULT_PROBE_TIMEOUT_MS = 15_000;
export const DEFAULT_PROBE_PROMPT = "Reply with exactly: OK";
export const DEFAULT_CONFIRM_DELAY_MS = 1_000;
export const DEFAULT_ENDPOINT =
  "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";

const UA_VERSION = process.env.PI_AI_ANTIGRAVITY_VERSION ?? "2.24.0";
export const DEFAULT_USER_AGENT = `antigravity/hub/${UA_VERSION} (aidev_client; os_type=darwin; arch=arm64; cl=963137146)`;

export const DEFAULT_EXEC_OPTS = {
  encoding: "utf8" as const,
  timeout: 25_000,
  windowsHide: true,
  maxBuffer: 2 * 1024 * 1024,
};

export interface ProbeClientOptions {
  endpoint?: string;
  userAgent?: string;
  modelWire?: string;
  probeTimeoutMs?: number;
  confirmDelayMs?: number;
  provider?: string;
  ompBin?: string | (() => string);
  execFileFn?: (
    file: string,
    args: string[],
    options: typeof DEFAULT_EXEC_OPTS,
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
  private readonly endpoint: string;
  private readonly userAgent: string;
  private readonly modelWire: string;
  private readonly probeTimeoutMs: number;
  private readonly confirmDelayMs: number;
  private readonly provider: string;
  private readonly ompBinResolver: () => string;
  private readonly execFile: (
    file: string,
    args: string[],
    options: typeof DEFAULT_EXEC_OPTS,
  ) => Promise<{ stdout: string | Buffer }>;
  private readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  private readonly tokenCache = new Map<number, { token: string; at: number }>();

  constructor(options: ProbeClientOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.modelWire = options.modelWire ?? DEFAULT_MODEL_WIRE;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.confirmDelayMs = options.confirmDelayMs ?? DEFAULT_CONFIRM_DELAY_MS;
    this.provider = options.provider ?? DEFAULT_PROVIDER;

    const bin = options.ompBin ?? process.env.OMP_BIN ?? "omp";
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
      if (match) map.set(match[2], Number(match[1]));
    }
    return map;
  }

  async loadAccounts(): Promise<Account[]> {
    const [{ stdout }, indexByEmail] = await Promise.all([
      this.execFile(
        this.getOmpBin(),
        ["usage", "--provider", this.provider, "--json"],
        DEFAULT_EXEC_OPTS,
      ),
      this.tokenList(),
    ]);
    const parsed = JSON.parse(String(stdout));
    const reports = Array.isArray(parsed?.reports) ? parsed.reports : [];
    const accounts: Account[] = [];
    for (const report of reports) {
      const email = report?.metadata?.email;
      const project = report?.metadata?.projectId;
      const index = typeof email === "string" ? indexByEmail.get(email) : undefined;
      if (typeof email === "string" && typeof project === "string" && index) {
        accounts.push({ index, email, project });
      }
    }
    return accounts.sort((a, b) => a.index - b.index);
  }

  async getToken(index: number): Promise<string> {
    const cached = this.tokenCache.get(index);
    if (cached && Date.now() - cached.at < 30 * 60_000) return cached.token;
    const { stdout } = await this.execFile(
      this.getOmpBin(),
      ["token", this.provider, "-a", String(index), "--raw"],
      DEFAULT_EXEC_OPTS,
    );
    const token = String(stdout).trim();
    if (!token) throw new Error(`empty token for account ${index}`);
    this.tokenCache.set(index, { token, at: Date.now() });
    return token;
  }

  async probe(account: Account): Promise<ProbeResult> {
    const started = performance.now();
    let token: string;
    try {
      token = await this.getToken(account.index);
    } catch (error) {
      return { ...account, status: "auth", ms: 0, detail: short(error) };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs);
    try {
      const response = await this.fetch(this.endpoint, {
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

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) {
          this.tokenCache.delete(account.index);
        }
        const status: Status =
          response.status === 401 || response.status === 403
            ? "auth"
            : response.status === 404
              ? "model-error"
              : "error";
        return {
          ...account,
          status,
          ms: Math.round(performance.now() - started),
          detail: `${response.status} ${body.replace(/\s+/g, " ").slice(0, 150)}`.trim(),
        };
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return {
          ...account,
          status: "error",
          ms: Math.round(performance.now() - started),
          detail: "empty response body",
        };
      }

      try {
        const decoder = new TextDecoder();
        for (let i = 0; i < 4; i += 1) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          if (text.includes("data:")) {
            return {
              ...account,
              status: "ok",
              ms: Math.round(performance.now() - started),
            };
          }
        }
        return {
          ...account,
          status: "error",
          ms: Math.round(performance.now() - started),
          detail: "stream closed without data",
        };
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch (error) {
      const name = (error as { name?: string })?.name ?? "";
      const timeout =
        name === "AbortError" ||
        name === "TimeoutError" ||
        /abort|timeout|timed out/i.test(String(error));
      return {
        ...account,
        status: timeout ? "hang" : "error",
        ms: Math.round(performance.now() - started),
        detail: timeout ? `no first event in ${this.probeTimeoutMs / 1000}s` : short(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async checkAll(confirm = false): Promise<ProbeResult[]> {
    const accounts = await this.loadAccounts();
    if (accounts.length === 0) return [];
    const results = await Promise.all(accounts.map((acc) => this.probe(acc)));
    if (!confirm) return results;

    const suspects = results.filter(
      (result) => result.status === "hang" || result.status === "error",
    );
    await Promise.all(
      suspects.map(async (result) => {
        await sleep(this.confirmDelayMs);
        const again = await this.probe(result);
        if (again.status === "ok") {
          result.status = "ok";
          result.ms = again.ms;
          result.detail = "recovered on retry";
        } else {
          result.detail = `${result.detail ?? ""}${result.detail ? " · " : ""}confirmed`;
        }
      }),
    );
    return results;
  }
}
