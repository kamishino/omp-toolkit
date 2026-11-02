import { describe, expect, test } from "bun:test";
import { type GatewayCommandDependencies, handleGatewayCommand } from "./gateway-command";

describe("handleGatewayCommand", () => {
  const createMockDeps = (
    overrides: Partial<GatewayCommandDependencies> = {},
  ): GatewayCommandDependencies => {
    return {
      runScript: async (action: string, args: string[] = []) => {
        if (action === "status") {
          return {
            stdout: "[OMP Gateway] Status: Broker=OK (:8765), Gateway=OK (:4000), Tunnel=CONNECTED",
            exitCode: 0,
          };
        }
        if (action === "start") {
          return {
            stdout: "Services started successfully.",
            exitCode: 0,
          };
        }
        if (action === "stop") {
          return {
            stdout: "Services stopped.",
            exitCode: 0,
          };
        }
        if (action === "client-add") {
          return {
            stdout: `Client '${args[0]}' added with token omp_gw_test123`,
            exitCode: 0,
          };
        }
        return { stdout: "", exitCode: 0 };
      },
      ...overrides,
    };
  };

  test("status reports gateway daemon status", async () => {
    const deps = createMockDeps();
    const result = await handleGatewayCommand(["status"], deps);
    expect(result).toContain("Broker=OK");
    expect(result).toContain("Gateway=OK");
  });

  test("empty args defaults to status", async () => {
    const deps = createMockDeps();
    const result = await handleGatewayCommand([], deps);
    expect(result).toContain("Broker=OK");
  });

  test("start triggers daemon startup", async () => {
    const deps = createMockDeps();
    const result = await handleGatewayCommand(["start"], deps);
    expect(result).toContain("started successfully");
  });

  test("stop triggers daemon shutdown", async () => {
    const deps = createMockDeps();
    const result = await handleGatewayCommand(["stop"], deps);
    expect(result).toContain("stopped");
  });

  test("client-add requires client name", async () => {
    const deps = createMockDeps();
    const result = await handleGatewayCommand(["client-add"], deps);
    expect(result).toContain("Usage: /gateway client-add <name>");
  });

  test("client-add issues token and instructions", async () => {
    const deps = createMockDeps();
    const result = await handleGatewayCommand(["client-add", "laptop-air"], deps);
    expect(result).toContain("Client 'laptop-air' added");
  });

  test("recipe returns client configuration snippet", async () => {
    const deps = createMockDeps();
    const result = await handleGatewayCommand(["recipe", "curl"], deps);
    expect(result).toContain("curl");
  });

  test("unknown action returns help message without throwing", async () => {
    const deps = createMockDeps();
    const result = await handleGatewayCommand(["foobar"], deps);
    expect(result).toContain("Usage: /gateway");
  });
});
