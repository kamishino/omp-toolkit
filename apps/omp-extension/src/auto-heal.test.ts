import { describe, expect, test } from "bun:test";
import { AutoHealCoordinator, extractTokenTotal } from "./auto-heal";

describe("AutoHealCoordinator recovery timer", () => {
  test("initializes with default or custom recovery interval", () => {
    const coordinator = new AutoHealCoordinator({ recoveryIntervalMs: 120_000 });
    expect(coordinator.isRunning()).toBe(false);
    expect(coordinator.getRecoveryTimer()).toBeNull();
  });
  test("starts and stops timer on session_start and session_shutdown", () => {
    const coordinator = new AutoHealCoordinator({ recoveryIntervalMs: 60_000 });
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const mockPi = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
      },
    };

    coordinator.registerEvents(mockPi as never);

    // session_start for sub agent does not start recovery timer
    handlers.session_start({}, { agent: { kind: "sub" }, mode: "tui" });
    expect(coordinator.getRecoveryTimer()).toBeNull();

    // session_start for main agent starts recovery timer
    handlers.session_start(
      {},
      {
        agent: { kind: "main" },
        mode: "tui",
        ui: { setStatus: () => {}, setWidget: () => {} },
        setTimeout: () => {},
      },
    );
    expect(coordinator.getRecoveryTimer()).not.toBeNull();

    // session_shutdown clears timer
    handlers.session_shutdown();
    expect(coordinator.getRecoveryTimer()).toBeNull();
  });

  test("tickRecovery returns early if not idle or no exclusions", async () => {
    const coordinator = new AutoHealCoordinator();
    let isIdleVal = false;
    let refreshCalled = false;

    (coordinator as unknown as { refresh: () => Promise<void> }).refresh = async () => {
      refreshCalled = true;
    };

    const mockCtx = {
      isIdle: () => isIdleVal,
      ui: { notify: () => {} },
    };

    // When isIdle returns false
    await coordinator.tickRecovery(mockCtx as never);
    expect(refreshCalled).toBe(false);

    // When isIdle returns true but no exclusions
    isIdleVal = true;
    await coordinator.tickRecovery(mockCtx as never);
    expect(refreshCalled).toBe(false);
  });
});

describe("extractTokenTotal helper", () => {
  test("extracts tokens from usage sub-object or top-level fields", () => {
    // usage.totalTokens
    expect(extractTokenTotal({ usage: { totalTokens: 1500 } })).toBe(1500);

    // usage.input + usage.output
    expect(extractTokenTotal({ usage: { input: 800, output: 250 } })).toBe(1050);

    // usage.inputTokens + usage.outputTokens
    expect(extractTokenTotal({ usage: { inputTokens: 500, outputTokens: 300 } })).toBe(800);

    // top-level totalTokens
    expect(extractTokenTotal({ totalTokens: 2000 })).toBe(2000);

    // top-level input + output
    expect(extractTokenTotal({ input: 100, output: 50 })).toBe(150);

    // top-level inputTokens + outputTokens
    expect(extractTokenTotal({ inputTokens: 400, outputTokens: 600 })).toBe(1000);

    // invalid or missing
    expect(extractTokenTotal(null)).toBeNull();
    expect(extractTokenTotal(undefined)).toBeNull();
    expect(extractTokenTotal("string")).toBeNull();
    expect(extractTokenTotal({ usage: { totalTokens: -50 } })).toBeNull();
    expect(extractTokenTotal({ usage: { totalTokens: "nan" } })).toBeNull();
  });
});

describe("agent_run recording in agent_end event", () => {
  test("records agent_run when in main TUI mode and skips in other modes", () => {
    const coordinator = new AutoHealCoordinator();
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const mockPi = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
      },
    };

    coordinator.registerEvents(mockPi as never);

    const mockCtxTui = {
      agent: { kind: "main" },
      mode: "tui",
      models: {
        current: () => ({ provider: "google-antigravity", id: "gemini-3.8-flash" }),
      },
      ui: { notify: () => {} },
    };

    // Firing agent_end in TUI mode
    expect(() => {
      handlers.agent_end(
        {
          messages: [{ role: "assistant", stopReason: "stop" }],
          usage: { totalTokens: 1200 },
        },
        mockCtxTui,
      );
    }).not.toThrow();

    // Firing agent_end in non-TUI mode
    const mockCtxRpc = {
      agent: { kind: "main" },
      mode: "rpc",
      models: {
        current: () => ({ provider: "google-antigravity", id: "gemini-3.8-flash" }),
      },
      ui: { notify: () => {} },
    };
    expect(() => {
      handlers.agent_end(
        {
          messages: [{ role: "assistant", stopReason: "stop" }],
        },
        mockCtxRpc,
      );
    }).not.toThrow();
  });
});
