import { describe, expect, test } from "bun:test";
import { AutoHealCoordinator } from "./auto-heal";

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
