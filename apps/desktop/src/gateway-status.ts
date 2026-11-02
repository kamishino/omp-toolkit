export interface GatewayResponse {
  ok: boolean;
  status: number;
}

export type GatewayFetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<GatewayResponse>;

const defaultFetch: GatewayFetch = (url, init) => fetch(url, init);

/**
 * Cadence owner for the gateway label: caches the last probe for a TTL and
 * dedupes concurrent probes, so per-notify tray syncs never stampede the
 * gateway. Tray code reads status from here instead of re-deriving it.
 */
export class GatewayStatusProbe {
  private status: string | null = null;
  private probedAt = 0;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly ttlMs = 30_000,
    private readonly fetchFn: GatewayFetch = defaultFetch,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<string> {
    if (this.status !== null && this.now() - this.probedAt < this.ttlMs) {
      return this.status;
    }
    if (this.inflight) return this.inflight;
    this.inflight = checkGatewayStatus(this.fetchFn).then((status) => {
      this.status = status;
      this.probedAt = this.now();
      this.inflight = null;
      return status;
    });
    return this.inflight;
  }
}

/** One-shot localhost gateway health probe for the tray menu label. */
export async function checkGatewayStatus(fetchFn: GatewayFetch = defaultFetch): Promise<string> {
  try {
    const res = await fetchFn("http://127.0.0.1:4000/healthz", {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      return "Gateway: Active (:4000)";
    }
    return `Gateway: HTTP ${res.status}`;
  } catch {
    return "Gateway: Off";
  }
}
