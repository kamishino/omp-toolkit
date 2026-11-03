import fs from "node:fs";
import path from "node:path";
import { bindToBaseUrl, type GatewayCtlConfig, portOfBind } from "./config";
import type { DoctorReport } from "./doctor";
import type { OmpAdapter } from "./omp-adapter";

export type DaemonKind = "broker" | "gateway";

export interface DaemonRecord {
  kind: DaemonKind;
  pid: number;
  bind: string;
  startedAtMs: number;
  /** Substring that must appear in the pid's live command line before we stop it. */
  marker: string;
}

export interface DaemonRecordStore {
  read(kind: DaemonKind, bind: string): DaemonRecord | null;
  write(record: DaemonRecord): void;
  remove(kind: DaemonKind, bind: string): void;
}

function recordFileName(kind: DaemonKind, bind: string): string {
  return `gateway-ctl-${kind}-${portOfBind(bind)}.json`;
}

export function createFileRecordStore(runDir: string): DaemonRecordStore {
  const fileFor = (kind: DaemonKind, bind: string) => path.join(runDir, recordFileName(kind, bind));
  return {
    read(kind, bind) {
      try {
        return JSON.parse(fs.readFileSync(fileFor(kind, bind), "utf-8")) as DaemonRecord;
      } catch {
        return null;
      }
    },
    write(record) {
      fs.mkdirSync(runDir, { recursive: true });
      const file = fileFor(record.kind, record.bind);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
      fs.renameSync(tmp, file);
    },
    remove(kind, bind) {
      try {
        fs.rmSync(fileFor(kind, bind), { force: true });
      } catch {
        // best effort cleanup
      }
    },
  };
}

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

export class DaemonManager {
  readonly #deps: DaemonManagerDependencies;

  constructor(deps: DaemonManagerDependencies) {
    this.#deps = deps;
  }

  #bind(kind: DaemonKind): string {
    return kind === "broker" ? this.#deps.config.brokerBind : this.#deps.config.gatewayBind;
  }

  #marker(kind: DaemonKind): string {
    return kind === "broker" ? "auth-broker" : "auth-gateway";
  }

  async #recordState(kind: DaemonKind): Promise<"managed" | "stale" | "none"> {
    const record = this.#deps.store.read(kind, this.#bind(kind));
    if (!record) return "none";
    const cmd = await this.#deps.adapter.commandLineOf(record.pid);
    if (cmd === null) return "stale";
    return cmd.includes(record.marker) && cmd.includes(`--bind=${record.bind}`)
      ? "managed"
      : "stale";
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

    for (const kind of KIND_ORDER) {
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

      const pid = await this.#deps.adapter.launch(args, env);
      this.#deps.store.write({
        kind,
        pid,
        bind,
        startedAtMs: (this.#deps.now ?? Date.now)(),
        marker: this.#marker(kind),
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
    for (const kind of [...KIND_ORDER].reverse()) {
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
      if (!cmd.includes(record.marker) || !cmd.includes(`--bind=${record.bind}`)) {
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
    for (const kind of KIND_ORDER) {
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
