import type { GatewayPanelStateKind, GatewayPanelView } from "./ipc";

export interface GatewayResponse {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
}

export type GatewayFetch = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<GatewayResponse>;

const defaultFetch: GatewayFetch = (url, init) => fetch(url, init);

export interface GatewayProbeOptions {
  /** Gateway bearer token for the model catalog; null degrades to health-only. */
  readGatewayToken?: () => string | null;
  /** Scoped client count from the clients file; null when unreadable. */
  readClientCount?: () => number | null;
  gatewayBaseUrl?: string;
}

export async function fetchGatewayPanelView(
  fetchFn: GatewayFetch = defaultFetch,
  options: GatewayProbeOptions = {},
  now: () => number = Date.now,
): Promise<GatewayPanelView> {
  const base = (options.gatewayBaseUrl ?? "http://127.0.0.1:4000").replace(/\/$/, "");
  const endpoint = base;
  const checkedAt = now();
  const clientCount = options.readClientCount ? safeRead(options.readClientCount) : null;
  const down = (state: GatewayPanelStateKind, label: string): GatewayPanelView => ({
    state,
    label,
    endpoint,
    access: "unknown",
    accessHttpStatus: null,
    modelCount: null,
    antigravityModelCount: null,
    clientCount,
    checkedAt,
  });

  try {
    const res = await fetchFn(`${base}/healthz`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) {
      return down("error", `Gateway: HTTP ${res.status}`);
    }
  } catch {
    return down("off", "Gateway: Off");
  }

  const token = options.readGatewayToken ? safeRead(options.readGatewayToken) : null;
  if (!token) {
    return {
      state: "active",
      label: "Gateway: Alive · access not checked",
      endpoint,
      access: "unknown",
      accessHttpStatus: null,
      modelCount: null,
      antigravityModelCount: null,
      clientCount,
      checkedAt,
    };
  }

  try {
    const res = await fetchFn(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2_500),
    });
    if (res.status === 401 || res.status === 403) {
      return {
        state: "active",
        label: "Gateway: Alive · access denied",
        endpoint,
        access: "denied",
        accessHttpStatus: res.status,
        modelCount: null,
        antigravityModelCount: null,
        clientCount,
        checkedAt,
      };
    }
    if (!res.ok || !res.json) {
      return {
        state: "active",
        label: "Gateway: Alive · access unavailable",
        endpoint,
        access: "error",
        accessHttpStatus: res.status,
        modelCount: null,
        antigravityModelCount: null,
        clientCount,
        checkedAt,
      };
    }
    const data = (await res.json()) as { data?: { id?: unknown }[] };
    if (!Array.isArray(data.data) || !data.data.every((m) => typeof m.id === "string")) {
      return {
        state: "active",
        label: "Gateway: Alive · access unavailable",
        endpoint,
        access: "error",
        accessHttpStatus: res.status,
        modelCount: null,
        antigravityModelCount: null,
        clientCount,
        checkedAt,
      };
    }
    const ids = data.data.map((m) => m.id as string);
    return {
      state: "active",
      label: "Gateway: Alive · access verified",
      endpoint,
      access: "ok",
      accessHttpStatus: res.status,
      modelCount: ids.length,
      antigravityModelCount: ids.filter((id) => id.includes("google-antigravity")).length,
      clientCount,
      checkedAt,
    };
  } catch {
    return {
      state: "active",
      label: "Gateway: Alive · access unavailable",
      endpoint,
      access: "error",
      accessHttpStatus: null,
      modelCount: null,
      antigravityModelCount: null,
      clientCount,
      checkedAt,
    };
  }
}

function safeRead<T>(read: () => T | null): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/**
 * Cadence owner for gateway state: caches the last probe for a TTL and
 * dedupes concurrent probes, so tray syncs and panel renders never stampede
 * the gateway. Tray and panel both read from here.
 */
export class GatewayStatusProbe {
  private view: GatewayPanelView | null = null;
  private probedAt = 0;
  private inflight: Promise<GatewayPanelView> | null = null;

  constructor(
    private readonly ttlMs = 30_000,
    private readonly fetchFn: GatewayFetch = defaultFetch,
    private readonly now: () => number = Date.now,
    private readonly options: GatewayProbeOptions = {},
  ) {}

  async getPanelView(): Promise<GatewayPanelView> {
    if (this.view !== null && this.now() - this.probedAt < this.ttlMs) return this.view;
    if (this.inflight) return this.inflight;
    this.inflight = fetchGatewayPanelView(this.fetchFn, this.options, this.now).then((view) => {
      this.view = view;
      this.probedAt = this.now();
      this.inflight = null;
      return view;
    });
    return this.inflight;
  }

  async get(): Promise<string> {
    return (await this.getPanelView()).label;
  }
}

/** One-shot localhost gateway health probe for the tray menu label. */
export async function checkGatewayStatus(fetchFn: GatewayFetch = defaultFetch): Promise<string> {
  return (await fetchGatewayPanelView(fetchFn)).label;
}
