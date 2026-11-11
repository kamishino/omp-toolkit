import { describe, expect, test } from "bun:test";
import type { MonitorExecFn } from "./data";
import { executeGatewayAction } from "./gateway-actions";

const SOURCE = { bun: "/bun", script: "/ctl" };

describe("executeGatewayAction", () => {
  test("rejects unknown actions without executing", async () => {
    let calls = 0;
    const execFn: MonitorExecFn = async () => {
      calls += 1;
      return { stdout: "" };
    };
    const result = await executeGatewayAction(SOURCE, "explode", { execFn });
    expect(result.success).toBe(false);
    expect(result.message).toContain("unknown gateway action");
    expect(calls).toBe(0);
  });

  test("returns trimmed stdout with the bounded timeout", async () => {
    const calls: { file: string; args: string[]; options?: unknown }[] = [];
    const execFn: MonitorExecFn = async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: "  doctor ok\n" };
    };
    const result = await executeGatewayAction(SOURCE, "doctor", { execFn });
    expect(result).toEqual({ success: true, message: "doctor ok" });
    expect(calls[0]?.file).toBe("/bun");
    expect(calls[0]?.args).toEqual(["/ctl", "doctor"]);
    expect((calls[0]?.options as { timeoutMs?: number } | undefined)?.timeoutMs).toBe(60_000);
  });

  test("preserves captured stdout and stderr on nonzero exit", async () => {
    const failure = Object.assign(new Error("exit 1"), {
      stdout: "partial output\n",
      stderr: "hint text\n",
    });
    const execFn: MonitorExecFn = async () => {
      throw failure;
    };
    const result = await executeGatewayAction(SOURCE, "start", { execFn });
    expect(result.success).toBe(false);
    expect(result.message).toBe("partial output\nhint text");
  });

  test("empty failure output yields a safe contextual message", async () => {
    const execFn: MonitorExecFn = async () => {
      throw new Error("exit 1");
    };
    const result = await executeGatewayAction(SOURCE, "stop", { execFn });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Gateway stop failed with no output");
  });
});
