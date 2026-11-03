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

function fakeAdapter(live: Map<number, string>, launched: string[][]): OmpAdapter {
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
  };
}

function manager(over: {
  doctor: DoctorReport;
  healthy: Record<DaemonKind, boolean>;
  store: MemoryStore;
  live: Map<number, string>;
  launched: string[][];
}): DaemonManager {
  return new DaemonManager({
    adapter: fakeAdapter(over.live, over.launched),
    store: over.store,
    probe: async (kind) => over.healthy[kind],
    runDoctor: async () => over.doctor,
    readBrokerToken: () => "broker-token",
    config: CONFIG,
    sleep: async () => {},
    now: () => 123,
    healthAttempts: 1,
    healthIntervalMs: 0,
  });
}

describe("DaemonManager", () => {
  test("start refuses when the doctor gate fails (fail closed)", async () => {
    const launched: string[][] = [];
    const m = manager({
      doctor: FAIL_DOCTOR,
      healthy: { broker: false, gateway: false },
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
      healthy: { broker: true, gateway: true },
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
      healthy: { broker: false, gateway: true },
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
      healthy: { broker: false, gateway: true },
      store: new MemoryStore(),
      live,
      launched: [],
    });
    const result = await m.stop();
    expect(result.ok).toBe(true);
    expect(live.has(99)).toBe(true);
    expect(result.lines.join("\n")).toContain("left untouched");
  });
});
