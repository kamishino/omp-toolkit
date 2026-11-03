import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  type GatewayCommandDependencies,
  handleGatewayCommand,
  resolveGatewayCtlPath,
} from "./gateway-command";

describe("handleGatewayCommand", () => {
  const createMockDeps = (
    overrides: Partial<GatewayCommandDependencies> = {},
  ): GatewayCommandDependencies => ({
    runCtl: async (action: string, args: string[] = []) => {
      if (action === "status") {
        return { stdout: "broker 127.0.0.1:8765: running (managed)", exitCode: 0 };
      }
      if (action === "start") return { stdout: "broker: started pid=1", exitCode: 0 };
      if (action === "stop") return { stdout: "gateway: stopped pid=2", exitCode: 0 };
      if (action === "clients-add") {
        return { stdout: `client "${args[0]}" added`, exitCode: 0 };
      }
      if (action === "recipe") return { stdout: "ANTHROPIC_BASE_URL curl snippet", exitCode: 0 };
      return { stdout: "", exitCode: 0 };
    },
    ...overrides,
  });

  test("status reports daemon manager state", async () => {
    const result = await handleGatewayCommand(["status"], createMockDeps());
    expect(result).toContain("running (managed)");
  });

  test("empty args defaults to status", async () => {
    const result = await handleGatewayCommand([], createMockDeps());
    expect(result).toContain("running (managed)");
  });

  test("start and stop pass through to gateway:ctl", async () => {
    expect(await handleGatewayCommand(["start"], createMockDeps())).toContain("started pid=1");
    expect(await handleGatewayCommand(["stop"], createMockDeps())).toContain("stopped pid=2");
  });

  test("client-add requires client name and maps to clients-add", async () => {
    expect(await handleGatewayCommand(["client-add"], createMockDeps())).toContain(
      "Usage: /gateway client-add <name>",
    );
    const result = await handleGatewayCommand(["client-add", "laptop-air"], createMockDeps());
    expect(result).toContain('client "laptop-air" added');
  });

  test("recipe delegates to gateway:ctl recipe", async () => {
    const result = await handleGatewayCommand(["recipe", "curl"], createMockDeps());
    expect(result).toContain("ANTHROPIC_BASE_URL");
  });

  test("unknown action returns help message without throwing", async () => {
    const result = await handleGatewayCommand(["foobar"], createMockDeps());
    expect(result).toContain("Usage: /gateway");
  });
});

describe("resolveGatewayCtlPath", () => {
  test("prefers installed ctl under ~/.omp/agent/scripts/", () => {
    const agentDir = path.join(path.parse(process.cwd()).root, "Users", "test", ".omp", "agent");
    const installed = path.join(agentDir, "scripts", "omp-gateway-ctl.js");
    expect(resolveGatewayCtlPath({}, agentDir, (p) => p === installed)).toBe(installed);
  });

  test("uses OMP_TOOLKIT_HOME dist when installed copy is absent", () => {
    const root = path.parse(process.cwd()).root;
    const toolkitHome = path.join(root, "Projects", "omp-toolkit");
    const dist = path.join(toolkitHome, "apps", "gateway", "dist", "index.js");
    const resolved = resolveGatewayCtlPath(
      { OMP_TOOLKIT_HOME: toolkitHome },
      path.join(root, "Users", "test", ".omp", "agent"),
      (p) => p === dist,
    );
    expect(resolved).toBe(dist);
  });

  test("falls back to checkout-relative dist path", () => {
    const resolved = resolveGatewayCtlPath({}, undefined, () => false);
    expect(resolved).toContain(path.join("apps", "gateway", "dist", "index.js"));
  });
});
