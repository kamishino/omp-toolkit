import { bindToBaseUrl, type GatewayCtlConfig } from "./config";
import type { DaemonKind, DaemonRecord, DaemonRecordStore } from "./daemon-store";
import type { DoctorReport } from "./doctor";
import type { OmpAdapter } from "./omp-adapter";

export interface DaemonManagerDependencies {
  adapter: OmpAdapter;
  store: DaemonRecordStore;
  /** Liveness probe per kind against the configured binds. */
  probe(kind: DaemonKind): Promise<boolean>;
  /** Doctor gate for start (requireRunning=false semantics). */
  runDoctor(): Promise<DoctorReport>;
  readBrokerToken(): string | null;
  config: GatewayCtlConfig;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  healthAttempts?: number;
  healthIntervalMs?: number;
}

export interface DaemonActionResult {
  ok: boolean;
  lines: string[];
}

const KIND_ORDER: readonly DaemonKind[] = ["broker", "gateway"];
const TUNNEL_ORDER: readonly DaemonKind[] = ["broker", "gateway", "tunnel"];

export class DaemonManager {
  readonly #deps: DaemonManagerDependencies;

  constructor(deps: DaemonManagerDependencies) {
    this.#deps = deps;
  }

  #bind(kind: DaemonKind): string {
    if (kind === "broker") return this.#deps.config.brokerBind;
    if (kind === "gateway") return this.#deps.config.gatewayBind;
    return this.#deps.config.tunnelMetricsBind;
  }

  #marker(kind: DaemonKind): string {
    if (kind === "broker") return "auth-broker";
    if (kind === "gateway") return "auth-gateway";
    return "cloudflared";
  }

  #match(kind: DaemonKind): string {
    if (kind === "tunnel") return `--config=${this.#deps.config.tunnelConfigPath}`;
    return `--bind=${this.#bind(kind)}`;
  }

  #recordMatches(record: DaemonRecord, cmd: string): boolean {
    return cmd.includes(record.marker) && cmd.includes(record.match ?? `--bind=${record.bind}`);
  }

  async #recordState(kind: DaemonKind): Promise<"managed" | "stale" | "none"> {
    const record = this.#deps.store.read(kind, this.#bind(kind));
    if (!record) return "none";
    const cmd = await this.#deps.adapter.commandLineOf(record.pid);
    if (cmd === null) return "stale";
    return this.#recordMatches(record, cmd) ? "managed" : "stale";
  }

  /**
   * Kinds for stop/status: broker/gateway always, plus the tunnel when it was
   * requested or a manager record for it exists (records outlive flags).
   */
  #lifecycleKinds(): DaemonKind[] {
    const kinds: DaemonKind[] = ["broker", "gateway"];
    if (
      this.#deps.config.withTunnel ||
      this.#deps.store.read("tunnel", this.#deps.config.tunnelMetricsBind) !== null
    ) {
      kinds.push("tunnel");
    }
    return kinds;
  }

  async #waitHealthy(kind: DaemonKind): Promise<boolean> {
    const attempts = this.#deps.healthAttempts ?? 30;
    const interval = this.#deps.healthIntervalMs ?? 500;
    const sleep = this.#deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let i = 0; i < attempts; i++) {
      if (await this.#deps.probe(kind)) return true;
      await sleep(interval);
    }
    return this.#deps.probe(kind);
  }

  async start(): Promise<DaemonActionResult> {
    const lines: string[] = [];
    const doctor = await this.#deps.runDoctor();
    if (!doctor.passed) {
      for (const check of doctor.checks.filter((c) => c.status === "fail")) {
        lines.push(`doctor FAIL ${check.id}: ${check.detail}`);
      }
      lines.push("start refused: fix the doctor failures above");
      return { ok: false, lines };
    }

    const kinds = this.#deps.config.withTunnel ? TUNNEL_ORDER : KIND_ORDER;
    for (const kind of kinds) {
      const bind = this.#bind(kind);
      const healthy = await this.#deps.probe(kind);
      if (healthy) {
        const state = await this.#recordState(kind);
        lines.push(
          state === "managed"
            ? `${kind}: already running (managed) on ${bind}`
            : `${kind}: already running (external, not managed) on ${bind}; left untouched`,
        );
        continue;
      }
      if ((await this.#recordState(kind)) === "stale") {
        this.#deps.store.remove(kind, bind);
        lines.push(`${kind}: removed stale pid record`);
      }

      const env: Record<string, string> = {};
      let pid: number;
      if (kind === "tunnel") {
        const exe =
          (await this.#deps.adapter.resolveCloudflaredPath(this.#deps.config.cloudflaredBin)) ??
          this.#deps.config.cloudflaredBin;
        // Note the --flag=value forms: the pid record re-verifies --config=.
        pid = await this.#deps.adapter.launchExe(
          exe,
          [
            "tunnel",
            `--config=${this.#deps.config.tunnelConfigPath}`,
            `--metrics=${this.#deps.config.tunnelMetricsBind}`,
            "run",
          ],
          env,
        );
      } else {
        const args =
          kind === "broker"
            ? ["auth-broker", "serve", `--bind=${bind}`]
            : [
                "auth-gateway",
                "serve",
                `--bind=${bind}`,
                `--clients=${this.#deps.config.clientsPath}`,
                // Matches the legacy manager: the loopback gateway may sit
                // behind a local Cloudflare tunnel terminator.
                "--trust-proxy-headers",
              ];
        if (kind === "gateway") {
          env.OMP_AUTH_BROKER_URL = bindToBaseUrl(this.#deps.config.brokerBind);
          const brokerToken = this.#deps.readBrokerToken();
          if (brokerToken) env.OMP_AUTH_BROKER_TOKEN = brokerToken;
        }
        pid = await this.#deps.adapter.launch(args, env);
      }
      this.#deps.store.write({
        kind,
        pid,
        bind,
        startedAtMs: (this.#deps.now ?? Date.now)(),
        marker: this.#marker(kind),
        match: this.#match(kind),
      });
      if (await this.#waitHealthy(kind)) lines.push(`${kind}: started pid=${pid} on ${bind}`);
      else {
        lines.push(
          `${kind}: launched pid=${pid} on ${bind} but health check did not pass; see status`,
        );
        return { ok: false, lines };
      }
    }
    return { ok: true, lines };
  }

  async stop(): Promise<DaemonActionResult> {
    const lines: string[] = [];
    let ok = true;
    for (const kind of this.#lifecycleKinds().reverse()) {
      const bind = this.#bind(kind);
      const record = this.#deps.store.read(kind, bind);
      if (!record) {
        const healthy = await this.#deps.probe(kind);
        lines.push(
          healthy
            ? `${kind}: running but not managed by gateway-ctl; left untouched`
            : `${kind}: not running`,
        );
        continue;
      }
      const cmd = await this.#deps.adapter.commandLineOf(record.pid);
      if (cmd === null) {
        this.#deps.store.remove(kind, bind);
        lines.push(`${kind}: stale record for pid=${record.pid} removed (process is gone)`);
        continue;
      }
      if (!this.#recordMatches(record, cmd)) {
        lines.push(
          `${kind}: pid=${record.pid} command line does not match the record; refusing to stop it`,
        );
        ok = false;
        continue;
      }
      await this.#deps.adapter.kill(record.pid);
      this.#deps.store.remove(kind, bind);
      lines.push(`${kind}: stopped pid=${record.pid}`);
    }
    return { ok, lines };
  }

  async restart(): Promise<DaemonActionResult> {
    const stopped = await this.stop();
    const started = await this.start();
    return { ok: stopped.ok && started.ok, lines: [...stopped.lines, ...started.lines] };
  }

  async status(): Promise<DaemonActionResult> {
    const lines: string[] = [];
    for (const kind of this.#lifecycleKinds()) {
      const bind = this.#bind(kind);
      const healthy = await this.#deps.probe(kind);
      const state = await this.#recordState(kind);
      const label = !healthy
        ? state === "stale"
          ? "down (stale pid record)"
          : "down"
        : state === "managed"
          ? "running (managed)"
          : "running (external, not managed)";
      lines.push(`${kind} ${bind}: ${label}`);
    }
    return { ok: true, lines };
  }
}
