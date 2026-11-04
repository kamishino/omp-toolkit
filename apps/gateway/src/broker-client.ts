import fs from "node:fs";
import type {
  CredentialCheckLike,
  SnapshotEntryLike,
  StickyRowLike,
  UsageReportLike,
} from "@omp-toolkit/core";
import { bindToBaseUrl, type GatewayCtlConfig } from "./config";

export interface BrokerClientDependencies {
  fetchFn?: typeof fetch;
  readTextFile?: (filePath: string) => string;
  fileExists?: (filePath: string) => boolean;
  readStickyRows?: (agentDbPath: string) => Promise<StickyRowLike[]>;
}

export interface BrokerClient {
  brokerHealth(): Promise<boolean>;
  gatewayHealth(): Promise<boolean>;
  tunnelHealth(): Promise<boolean>;
  getSnapshot(): Promise<SnapshotEntryLike[]>;
  getCredentialCheck(): Promise<CredentialCheckLike[]>;
  getUsage(): Promise<UsageReportLike[]>;
  readStickyRows(): Promise<StickyRowLike[]>;
  tokenPresent(kind: "broker" | "gateway"): boolean;
  readBrokerToken(): string | null;
  postBlock(
    credentialId: number,
    providerKey: string,
    blockScope: string,
    blockedUntilMs: number,
  ): Promise<void>;
  deleteBlock(credentialId: number, providerKey: string, blockScope: string): Promise<void>;
}

async function defaultReadStickyRows(agentDbPath: string): Promise<StickyRowLike[]> {
  try {
    if (!fs.existsSync(agentDbPath)) return [];
    // bun:sqlite is available under the Bun runtime this app ships on.
    const sqlite = (await import("bun:sqlite")) as {
      Database: new (
        path: string,
        options?: { readonly?: boolean },
      ) => {
        query: (sql: string) => { all: () => unknown[] };
        close: () => void;
      };
    };
    const db = new sqlite.Database(agentDbPath, { readonly: true });
    try {
      const rows = db
        .query("SELECT key AS k, value AS v FROM cache WHERE key LIKE 'session:sticky:%'")
        .all() as { k: string; v: string }[];
      return rows.map((r) => ({ key: String(r.k), value: String(r.v) }));
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export function createBrokerClient(
  config: GatewayCtlConfig,
  deps: BrokerClientDependencies = {},
): BrokerClient {
  const fetcher = deps.fetchFn ?? fetch;
  const readText = deps.readTextFile ?? ((p: string) => fs.readFileSync(p, "utf-8"));
  const exists = deps.fileExists ?? fs.existsSync;
  const brokerBase = bindToBaseUrl(config.brokerBind);
  const gatewayBase = bindToBaseUrl(config.gatewayBind);

  const readToken = (p: string): string | null => {
    try {
      return exists(p) ? readText(p).trim() : null;
    } catch {
      return null;
    }
  };

  async function getJson(url: string, tokenPath: string, timeoutMs = 30_000): Promise<unknown> {
    const token = readToken(tokenPath);
    const res = await fetcher(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`GET ${url} failed with HTTP ${res.status}`);
    return res.json();
  }

  async function health(url: string): Promise<boolean> {
    try {
      const res = await fetcher(url, { signal: AbortSignal.timeout(2_500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Tunnel health requires at least one registered edge connection, not just
   * a serving metrics listener: a process that lost the edge must read down.
   */
  async function tunnelHealth(url: string): Promise<boolean> {
    try {
      const res = await fetcher(url, { signal: AbortSignal.timeout(2_500) });
      if (!res.ok) return false;
      const match = /cloudflared_tunnel_ha_connections\s+(\d+)/.exec(await res.text());
      return match !== null && Number(match[1]) > 0;
    } catch {
      return false;
    }
  }

  // cloudflared --metrics serves Prometheus text at /metrics once the
  // tunnel process is up; edge registration depth is verified live instead.
  const tunnelMetrics = bindToBaseUrl(config.tunnelMetricsBind);

  return {
    brokerHealth: () => health(`${brokerBase}/v1/healthz`),
    gatewayHealth: () => health(`${gatewayBase}/healthz`),
    tunnelHealth: () => tunnelHealth(`${tunnelMetrics}/metrics`),
    async getSnapshot(): Promise<SnapshotEntryLike[]> {
      const data = (await getJson(`${brokerBase}/v1/snapshot`, config.brokerTokenPath)) as {
        credentials?: SnapshotEntryLike[];
        entries?: SnapshotEntryLike[];
      };
      return data.credentials ?? data.entries ?? [];
    },
    async getCredentialCheck(): Promise<CredentialCheckLike[]> {
      const data = (await getJson(
        `${gatewayBase}/v1/credentials/check`,
        config.gatewayTokenPath,
        120_000,
      )) as {
        credentials?: CredentialCheckLike[];
      };
      return data.credentials ?? [];
    },
    async getUsage(): Promise<UsageReportLike[]> {
      const data = (await getJson(`${gatewayBase}/v1/usage`, config.gatewayTokenPath, 60_000)) as {
        reports?: UsageReportLike[];
      };
      return data.reports ?? [];
    },
    readStickyRows: () => (deps.readStickyRows ?? defaultReadStickyRows)(config.agentDbPath),
    tokenPresent: (kind) =>
      readToken(kind === "broker" ? config.brokerTokenPath : config.gatewayTokenPath) !== null,
    readBrokerToken: () => readToken(config.brokerTokenPath),
    async postBlock(credentialId, providerKey, blockScope, blockedUntilMs) {
      const token = readToken(config.brokerTokenPath);
      const res = await fetcher(`${brokerBase}/v1/credential/${credentialId}/block`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ providerKey, blockScope, blockedUntilMs }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok)
        throw new Error(`POST block for credential ${credentialId} failed with HTTP ${res.status}`);
    },
    async deleteBlock(credentialId, providerKey, blockScope) {
      const token = readToken(config.brokerTokenPath);
      const res = await fetcher(`${brokerBase}/v1/credential/${credentialId}/block`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ providerKey, blockScope }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok)
        throw new Error(
          `DELETE block for credential ${credentialId} failed with HTTP ${res.status}`,
        );
    },
  };
}
