import { describe, expect, test } from "bun:test";
import type { GatewayCtlConfig } from "./config";
import { parseGatewayCtlConfig } from "./config";
import {
  type DaemonKind,
  DaemonManager,
  type DaemonRecord,
  type DaemonRecordStore,
} from "./daemon";
import type { DoctorReport } from "./doctor";
import type { OmpAdapter, OmpProcessInfo } from "./omp-adapter";

const CONFIG: GatewayCtlConfig = parseGatewayCtlConfig(
  ["start", "--broker-bind=127.0.0.1:18765", "--gateway-bind=127.0.0.1:14001"],
  {},
  "C:/home/tester",
);

const PASS_DOCTOR: DoctorReport = { checks: [], passed: true, exitCode: 0 };
const FAIL_DOCTOR: DoctorReport = {
  checks: [{ id: "omp-version", status: "fail", detail: "too old" }],
  passed: false,
  exitCode: 1,
};

class MemoryStore implements DaemonRecordStore {
  records = new Map<string, DaemonRecord>();
  read(kind: DaemonKind, bind: string) {
    return this.records.get(`${kind}:${bind}`) ?? null;
  }
  write(record: DaemonRecord) {
    this.records.set(`${record.kind}:${record.bind}`, record);
  }
  remove(kind: DaemonKind, bind: string) {
    this.records.delete(`${kind}:${bind}`);
  }
}

function fakeAdapter(
  live: Map<number, string>,
  launched: string[][],
  exes: string[] = [],
): OmpAdapter {
  let nextPid = 5000;
  return {
    resolveOmpPath: async () => "omp",
    runOmpText: async () => "omp/18.16.0",
    launch: async (args: string[]) => {
      launched.push(args);
      const pid = nextPid++;
      live.set(pid, `omp ${args.join(" ")}`);
      return pid;
    },
    listOmpProcesses: async (): Promise<OmpProcessInfo[]> =>
      [...live.entries()].map(([pid, commandLine]) => ({ pid, commandLine })),
    commandLineOf: async (pid: number) => live.get(pid) ?? null,
    kill: async (pid: number) => {
      live.delete(pid);
    },
    resolveCloudflaredPath: async () => "cloudflared",
    runCloudflaredText: async () => "cloudflared version 2026.10.7",
    launchExe: async (exe: string, args: string[]) => {
      exes.push(exe);
      launched.push(args);
      const pid = nextPid++;
      live.set(pid, `${exe} ${args.join(" ")}`);
      return pid;
    },
  };
}

function manager(over: {
  doctor: DoctorReport;
  healthy: Record<DaemonKind, boolean>;
  store: MemoryStore;
  live: Map<number, string>;
  launched: string[][];
  config?: GatewayCtlConfig;
  exes?: string[];
}): DaemonManager {
  return new DaemonManager({
    adapter: fakeAdapter(over.live, over.launched, over.exes),
    store: over.store,
    probe: async (kind) => over.healthy[kind],
    runDoctor: async () => over.doctor,
    readBrokerToken: () => "broker-token",
    config: over.config ?? CONFIG,
    sleep: async () => {},
    now: () => 123,
    healthAttempts: 1,
    healthIntervalMs: 0,
  });
}

const TUNNEL_CONFIG = parseGatewayCtlConfig(
  ["start", "--with-tunnel", "--tunnel-config=C:/x/cloudflared/config.yml"],
  {},
  "C:/home/tester",
);

describe("DaemonManager", () => {
  test("start refuses when the doctor gate fails (fail closed)", async () => {
    const launched: string[][] = [];
    const m = manager({
      doctor: FAIL_DOCTOR,
      healthy: { broker: false, gateway: false, tunnel: false },
      store: new MemoryStore(),
      live: new Map(),
      launched,
    });
    const result = await m.start();
    expect(result.ok).toBe(false);
    expect(launched).toEqual([]);
    expect(result.lines.join("\n")).toContain("start refused");
  });

  test("start launches broker then gateway and records both", async () => {
    const launched: string[][] = [];
    const store = new MemoryStore();
    // A kind reads healthy once its own launch has happened.
    const m = new DaemonManager({
      adapter: fakeAdapter(new Map(), launched),
      store,
      probe: async (kind) =>
        launched.some((args) =>
          args.join(" ").includes(kind === "broker" ? "auth-broker" : "auth-gateway"),
        ),
      runDoctor: async () => PASS_DOCTOR,
      readBrokerToken: () => "tok",
      config: CONFIG,
      sleep: async () => {},
      now: () => 7,
      healthAttempts: 3,
      healthIntervalMs: 0,
    });
    const result = await m.start();
    expect(result.ok).toBe(true);
    expect(launched[0]?.slice(0, 2)).toEqual(["auth-broker", "serve"]);
    expect(launched[1]?.slice(0, 2)).toEqual(["auth-gateway", "serve"]);
    expect(launched[1]?.join(" ")).toContain("--clients=");
    expect(store.records.size).toBe(2);
  });

  test("start is idempotent and never adopts external processes", async () => {
    const launched: string[][] = [];
    const m = manager({
      doctor: PASS_DOCTOR,
      healthy: { broker: true, gateway: true, tunnel: false },
      store: new MemoryStore(),
      live: new Map(),
      launched,
    });
    const result = await m.start();
    expect(result.ok).toBe(true);
    expect(launched).toEqual([]);
    expect(result.lines.join("\n")).toContain("external, not managed");
  });

  test("stop refuses to kill a pid whose command line changed", async () => {
    const store = new MemoryStore();
    store.write({
      kind: "gateway",
      pid: 42,
      bind: CONFIG.gatewayBind,
      startedAtMs: 1,
      marker: "auth-gateway",
    });
    const live = new Map<number, string>([[42, "omp some-other-thing --bind=127.0.0.1:14001"]]);
    const m = manager({
      doctor: PASS_DOCTOR,
      healthy: { broker: false, gateway: true, tunnel: false },
      store,
      live,
      launched: [],
    });
    const result = await m.stop();
    expect(result.ok).toBe(false);
    expect(live.has(42)).toBe(true);
  });

  test("stop without records leaves running external processes alone", async () => {
    const live = new Map<number, string>([[99, "omp auth-gateway serve --bind=127.0.0.1:14001"]]);
    const m = manager({
      doctor: PASS_DOCTOR,
      healthy: { broker: false, gateway: true, tunnel: false },
      store: new MemoryStore(),
      live,
      launched: [],
    });
    const result = await m.stop();
    expect(result.ok).toBe(true);
    expect(live.has(99)).toBe(true);
    expect(result.lines.join("\n")).toContain("left untouched");
  });

  test("start without --with-tunnel never launches the tunnel", async () => {
    const launched: string[][] = [];
    const exes: string[] = [];
    const store = new MemoryStore();
    const m = new DaemonManager({
      adapter: fakeAdapter(new Map(), launched, exes),
      store,
      probe: async () => true,
      runDoctor: async () => PASS_DOCTOR,
      readBrokerToken: () => "tok",
      config: CONFIG,
      sleep: async () => {},
      now: () => 7,
      healthAttempts: 1,
      healthIntervalMs: 0,
    });
    const result = await m.start();
    expect(result.ok).toBe(true);
    expect(exes).toEqual([]);
    expect(store.records.size).toBe(0);
  });

  test("start --with-tunnel launches cloudflared last with config and metrics", async () => {
    const launched: string[][] = [];
    const exes: string[] = [];
    const store = new MemoryStore();
    const live = new Map<number, string>();
    const m = new DaemonManager({
      adapter: fakeAdapter(live, launched, exes),
      store,
      probe: async (kind) =>
        kind === "tunnel"
          ? exes.length > 0
          : launched.some((args) =>
              args.join(" ").includes(kind === "broker" ? "auth-broker" : "auth-gateway"),
            ),
      runDoctor: async () => PASS_DOCTOR,
      readBrokerToken: () => "tok",
      config: TUNNEL_CONFIG,
      sleep: async () => {},
      now: () => 7,
      healthAttempts: 3,
      healthIntervalMs: 0,
    });
    const result = await m.start();
    expect(result.ok).toBe(true);
    expect(exes).toEqual(["cloudflared"]);
    expect(launched[2]).toEqual([
      "tunnel",
      "--config=C:/x/cloudflared/config.yml",
      "--metrics=127.0.0.1:48333",
      "run",
    ]);
    const record = store.read("tunnel", TUNNEL_CONFIG.tunnelMetricsBind);
    expect(record?.marker).toBe("cloudflared");
    expect(record?.match).toBe("--config=C:/x/cloudflared/config.yml");
  });

  test("stop verifies the tunnel record against --config, not --bind", async () => {
    const store = new MemoryStore();
    store.write({
      kind: "tunnel",
      pid: 42,
      bind: TUNNEL_CONFIG.tunnelMetricsBind,
      startedAtMs: 1,
      marker: "cloudflared",
      match: "--config=C:/x/cloudflared/config.yml",
    });
    const live = new Map<number, string>([
      [42, "cloudflared tunnel --config=C:/x/cloudflared/config.yml --metrics=127.0.0.1:48333 run"],
    ]);
    const m = manager({
      doctor: PASS_DOCTOR,
      healthy: { broker: false, gateway: false, tunnel: true },
      store,
      live,
      launched: [],
      config: TUNNEL_CONFIG,
    });
    const result = await m.stop();
    expect(result.ok).toBe(true);
    expect(live.has(42)).toBe(false);
    expect(result.lines.join("\n")).toContain("tunnel: stopped pid=42");
  });

  test("legacy records without match still verify against --bind", async () => {
    const store = new MemoryStore();
    store.write({
      kind: "gateway",
      pid: 43,
      bind: CONFIG.gatewayBind,
      startedAtMs: 1,
      marker: "auth-gateway",
    });
    const live = new Map<number, string>([
      [43, "omp auth-gateway serve --bind=127.0.0.1:14001 --clients=C:/c.json"],
    ]);
    const m = manager({
      doctor: PASS_DOCTOR,
      healthy: { broker: false, gateway: true, tunnel: false },
      store,
      live,
      launched: [],
    });
    const result = await m.stop();
    expect(result.ok).toBe(true);
    expect(live.has(43)).toBe(false);
  });

  test("status hides the tunnel unless requested or recorded", async () => {
    const plain = manager({
      doctor: PASS_DOCTOR,
      healthy: { broker: true, gateway: true, tunnel: true },
      store: new MemoryStore(),
      live: new Map(),
      launched: [],
    });
    expect((await plain.status()).lines.join("\n")).not.toContain("tunnel");

    const recorded = new MemoryStore();
    recorded.write({
      kind: "tunnel",
      pid: 44,
      bind: CONFIG.tunnelMetricsBind,
      startedAtMs: 1,
      marker: "cloudflared",
      match: "--config=C:/y/config.yml",
    });
    const withRecord = manager({
      doctor: PASS_DOCTOR,
      healthy: { broker: true, gateway: true, tunnel: false },
      store: recorded,
      live: new Map(),
      launched: [],
    });
    expect((await withRecord.status()).lines.join("\n")).toContain("tunnel");
  });
});
