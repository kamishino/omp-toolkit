import type { GatewayPanelView } from "./ipc";

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
  const endpoint = base.replace(/^https?:\/\//, "");
  const checkedAt = now();
  const clientCount = options.readClientCount ? safeRead(options.readClientCount) : null;

  try {
    const res = await fetchFn(`${base}/healthz`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) {
      return {
        state: "error",
        label: `Gateway: HTTP ${res.status}`,
        endpoint,
        modelCount: null,
        antigravityModelCount: null,
        clientCount,
        checkedAt,
      };
    }
  } catch {
    return {
      state: "off",
      label: "Gateway: Off",
      endpoint,
      modelCount: null,
      antigravityModelCount: null,
      clientCount,
      checkedAt,
    };
  }

  let modelCount: number | null = null;
  let antigravityModelCount: number | null = null;
  const token = options.readGatewayToken ? safeRead(options.readGatewayToken) : null;
  if (token) {
    try {
      const res = await fetchFn(`${base}/v1/models`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2_500),
      });
      if (res.ok && res.json) {
        const data = (await res.json()) as { data?: { id?: string }[] };
        const ids = (data.data ?? []).map((m) => m.id ?? "");
        modelCount = ids.length;
        antigravityModelCount = ids.filter((id) => id.includes("google-antigravity")).length;
      }
    } catch {
      // Catalog is decorative here; health alone still proves liveness.
    }
  }

  return {
    state: "active",
    label: "Gateway: Active (:4000)",
    endpoint,
    modelCount,
    antigravityModelCount,
    clientCount,
    checkedAt,
  };
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
