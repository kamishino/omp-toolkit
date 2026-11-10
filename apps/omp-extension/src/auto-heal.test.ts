import { describe, expect, test } from "bun:test";
import {
  AutoHealCoordinator,
  extractRunTokens,
  extractTokenTotal,
  parseLastAssistantMessage,
} from "./auto-heal";
import { healthManager } from "./health-manager";
import type { HistoryEventInput } from "./history-store";

describe("AutoHealCoordinator recovery timer", () => {
  test("initializes with default or custom recovery interval", () => {
    const coordinator = new AutoHealCoordinator({ recoveryIntervalMs: 120_000 });
    expect(coordinator.isRunning()).toBe(false);
    expect(coordinator.getRecoveryTimer()).toBeNull();
  });
  test("starts and stops timer on session_start and session_shutdown", () => {
    const recorded: HistoryEventInput[][] = [];
    const coordinator = new AutoHealCoordinator({
      recoveryIntervalMs: 60_000,
      healthEnabled: true,
      recordHistoryFn: (events) => {
        recorded.push(events);
      },
    });
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
    const coordinator = new AutoHealCoordinator({ healthEnabled: true });
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

  test("tickRecovery runs probeAndPublish without deadlock when idle and exclusions present", async () => {
    const coordinator = new AutoHealCoordinator({ healthEnabled: true });
    let probeAndPublishCalled = false;
    const notifications: string[] = [];

    const origHasExclusions = healthManager.hasExclusionsToRecover;
    healthManager.hasExclusionsToRecover = async () => true;

    (
      coordinator as unknown as { probeAndPublish: (ctx: unknown) => Promise<unknown> }
    ).probeAndPublish = async () => {
      probeAndPublishCalled = true;
      return { results: [], restored: [], policies: [] };
    };

    const mockCtx = {
      isIdle: () => true,
      ui: {
        notify: (msg: string) => {
          notifications.push(msg);
        },
      },
    };

    try {
      await coordinator.tickRecovery(mockCtx as never);
      expect(probeAndPublishCalled).toBe(true);
      expect(notifications.some((n) => n.includes("already running"))).toBe(false);
    } finally {
      healthManager.hasExclusionsToRecover = origHasExclusions;
    }
  });
});

describe("extractTokenTotal helper", () => {
  test("extracts tokens from usage sub-object or top-level fields", () => {
    // usage.totalTokens and usage.total_tokens
    expect(extractTokenTotal({ usage: { totalTokens: 1500 } })).toBe(1500);
    expect(extractTokenTotal({ usage: { total_tokens: 1600 } })).toBe(1600);

    // usage.input + usage.output
    expect(extractTokenTotal({ usage: { input: 800, output: 250 } })).toBe(1050);
    expect(extractTokenTotal({ usage: { input_tokens: 700, output_tokens: 300 } })).toBe(1000);
    expect(extractTokenTotal({ usage: { inputTokens: 500, outputTokens: 300 } })).toBe(800);

    // usage.promptTokens + usage.completionTokens
    expect(extractTokenTotal({ usage: { promptTokens: 400, completionTokens: 250 } })).toBe(650);
    expect(extractTokenTotal({ usage: { prompt_tokens: 500, completion_tokens: 350 } })).toBe(850);
    expect(extractTokenTotal({ usage: { prompt: 100, completion: 50 } })).toBe(150);

    // tokenUsage sub-object
    expect(extractTokenTotal({ tokenUsage: { totalTokens: 1800 } })).toBe(1800);
    expect(extractTokenTotal({ tokenUsage: { input: 600, output: 400 } })).toBe(1000);

    // top-level totalTokens and total_tokens
    expect(extractTokenTotal({ totalTokens: 2000 })).toBe(2000);
    expect(extractTokenTotal({ total_tokens: 2100 })).toBe(2100);
    expect(extractTokenTotal({ tokens: 2200 })).toBe(2200);

    // top-level input + output
    expect(extractTokenTotal({ input: 100, output: 50 })).toBe(150);
    expect(extractTokenTotal({ input_tokens: 200, output_tokens: 150 })).toBe(350);
    expect(extractTokenTotal({ inputTokens: 400, outputTokens: 600 })).toBe(1000);

    // partial usage (input only)
    expect(extractTokenTotal({ usage: { input: 450 } })).toBe(450);

    // invalid or missing
    expect(extractTokenTotal(null)).toBeNull();
    expect(extractTokenTotal(undefined)).toBeNull();
    expect(extractTokenTotal("string")).toBeNull();
    expect(extractTokenTotal({ usage: { totalTokens: -50 } })).toBeNull();
    expect(extractTokenTotal({ usage: { totalTokens: "nan" } })).toBeNull();
  });
});

describe("extractRunTokens helper", () => {
  test("extracts event-level token usage directly", () => {
    expect(extractRunTokens({ usage: { totalTokens: 2500 } })).toBe(2500);
    expect(extractRunTokens({ total_tokens: 3100 })).toBe(3100);
  });

  test("sums token usage across multi-turn assistant messages", () => {
    const event = {
      messages: [
        { role: "user", content: "start" },
        { role: "assistant", usage: { input: 500, output: 100 } },
        { role: "user", content: "continue" },
        { role: "assistant", usage: { input: 800, output: 300 } },
      ],
    };
    expect(extractRunTokens(event)).toBe(1700);
  });

  test("handles non-final assistant messages when followed by tool or user result", () => {
    const event = {
      messages: [
        { role: "assistant", usage: { prompt_tokens: 1000, completion_tokens: 250 } },
        { role: "tool", content: "command result" },
      ],
    };
    const last = parseLastAssistantMessage(event);
    expect(last?.role).toBe("assistant");
    expect(extractRunTokens(event, last)).toBe(1250);
  });

  test("falls back to lastDetails.raw if event.messages has no usage", () => {
    const lastDetails = {
      role: "assistant",
      raw: { usage: { totalTokens: 1850 } },
    };
    expect(extractRunTokens({}, lastDetails)).toBe(1850);
  });

  test("returns null when no usage exists in event or messages", () => {
    expect(extractRunTokens({})).toBeNull();
    expect(extractRunTokens(null)).toBeNull();
    expect(extractRunTokens({ messages: [{ role: "assistant", content: "done" }] })).toBeNull();
  });
});

describe("agent_run recording in agent_end event", () => {
  test("records distinct token totals and isolates from production history", () => {
    const recorded: HistoryEventInput[][] = [];
    const coordinator = new AutoHealCoordinator({
      healthEnabled: true,
      recordHistoryFn: (events) => {
        recorded.push(events);
      },
    });
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const mockPi = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
      },
    };

    coordinator.registerEvents(mockPi as never);

    const notifications: Array<{ message: string; type?: string }> = [];
    const mockCtxTui = {
      agent: { kind: "main" },
      mode: "tui",
      models: {
        current: () => ({ provider: "google-antigravity", id: "gemini-3.8-flash" }),
      },
      ui: {
        notify: (message: string, type?: "info" | "warning" | "error") => {
          notifications.push({ message, type });
        },
      },
    };

    // Turn 1: 1850 tokens
    handlers.agent_end(
      {
        messages: [
          { role: "user", content: "first prompt" },
          { role: "assistant", stopReason: "stop", usage: { totalTokens: 1850 } },
        ],
      },
      mockCtxTui,
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0][0].kind).toBe("agent_run");
    expect(recorded[0][0].status).toBe("ok");
    expect(recorded[0][0].detail).toBe("gemini-3.8-flash tok=1850");

    // Turn 2: 4200 tokens across multi-turn messages
    handlers.agent_end(
      {
        messages: [
          { role: "user", content: "second prompt" },
          {
            role: "assistant",
            stopReason: "stop",
            usage: { input_tokens: 2000, output_tokens: 500 },
          },
          {
            role: "assistant",
            stopReason: "stop",
            usage: { input_tokens: 1200, output_tokens: 500 },
          },
        ],
      },
      mockCtxTui,
    );

    expect(recorded).toHaveLength(2);
    expect(recorded[1][0].status).toBe("ok");
    expect(recorded[1][0].detail).toBe("gemini-3.8-flash tok=4200");

    // Turn 3: Run without token counts
    handlers.agent_end(
      {
        messages: [{ role: "assistant", stopReason: "stop" }],
      },
      mockCtxTui,
    );

    expect(recorded).toHaveLength(3);
    expect(recorded[2][0].status).toBe("ok");
    expect(recorded[2][0].detail).toBe("gemini-3.8-flash");

    // Turn 4: Error status
    handlers.agent_end(
      {
        messages: [{ role: "assistant", stopReason: "error", error: "rate limit" }],
      },
      mockCtxTui,
    );

    expect(recorded).toHaveLength(4);
    expect(recorded[3][0].status).toBe("error");
    expect(recorded[3][0].detail).toBe("gemini-3.8-flash");

    // Turn 5: Subsequent error status
    handlers.agent_end(
      {
        messages: [{ role: "assistant", stopReason: "error", error: "compile failure" }],
      },
      mockCtxTui,
    );

    expect(recorded).toHaveLength(5);
    expect(recorded[4]).toHaveLength(1);
    expect(recorded[4][0].status).toBe("error");
    expect(recorded[4][0].detail).toBe("gemini-3.8-flash");

    // Firing agent_end in non-TUI mode does not record
    const mockCtxRpc = {
      agent: { kind: "main" },
      mode: "rpc",
      models: {
        current: () => ({ provider: "google-antigravity", id: "gemini-3.8-flash" }),
      },
      ui: { notify: () => {} },
    };
    handlers.agent_end(
      {
        messages: [{ role: "assistant", stopReason: "stop", usage: { totalTokens: 9999 } }],
      },
      mockCtxRpc,
    );
    expect(recorded).toHaveLength(5);
  });
});

describe("AutoHealCoordinator health pause", () => {
  const oauthFailure = new Error(
    'Command failed: omp token google-antigravity --list No OAuth accounts found for provider "google-antigravity". --account/--list select among OAuth accounts; this provider has none',
  );

  function registerHandlers(coordinator: AutoHealCoordinator) {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    coordinator.registerEvents({
      on: (event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
      },
    } as never);
    return handlers;
  }

  test("paused startup records history, clears the widget, and never probes", async () => {
    const recorded: HistoryEventInput[][] = [];
    const coordinator = new AutoHealCoordinator({
      healthEnabled: false,
      recoveryIntervalMs: 60_000,
      recordHistoryFn: (events) => {
        recorded.push(events);
      },
    });
    const handlers = registerHandlers(coordinator);
    const statuses: Array<string | undefined> = [];
    const widgets: Array<string[] | undefined> = [];
    const scheduled: number[] = [];
    const notifications: string[] = [];
    const mainCtx = {
      agent: { kind: "main" },
      mode: "tui",
      isIdle: () => true,
      ui: {
        setStatus: (_key: string, value: string | undefined) => statuses.push(value),
        setWidget: (_key: string, value: string[] | undefined) => widgets.push(value),
        notify: (message: string) => notifications.push(message),
      },
      setTimeout: (_fn: () => void, ms: number) => {
        scheduled.push(ms);
      },
    };

    const origCheckAllSweep = healthManager.checkAllSweep;
    let probeCalls = 0;
    healthManager.checkAllSweep = async () => {
      probeCalls += 1;
      throw oauthFailure;
    };
    try {
      handlers.session_start({}, mainCtx);
      expect(coordinator.getRecoveryTimer()).toBeNull();
      expect(statuses).toEqual([undefined]);
      expect(widgets).toEqual([undefined]);
      expect(scheduled).toEqual([]);
      expect(recorded).toHaveLength(1);
      expect(recorded[0][0].kind).toBe("session_start");

      await coordinator.tickRecovery(mainCtx as never);
      expect(probeCalls).toBe(0);
      expect(notifications).toEqual([]);
    } finally {
      healthManager.checkAllSweep = origCheckAllSweep;
      coordinator.stopRecoveryTimer();
    }
  });

  test("paused Gemini stalls do not heal while run telemetry still records", () => {
    const recorded: HistoryEventInput[][] = [];
    const coordinator = new AutoHealCoordinator({
      healthEnabled: false,
      recordHistoryFn: (events) => {
        recorded.push(events);
      },
    });
    const handlers = registerHandlers(coordinator);
    const notifications: string[] = [];
    const ctx = {
      agent: { kind: "main" },
      mode: "tui",
      models: { current: () => ({ provider: "google-antigravity", id: "gemini-3.8-flash" }) },
      ui: { notify: (message: string) => notifications.push(message) },
    };

    const origCheckAllSweep = healthManager.checkAllSweep;
    const origApplyHeal = healthManager.applyHeal;
    let probeCalls = 0;
    healthManager.checkAllSweep = async () => {
      probeCalls += 1;
      throw oauthFailure;
    };
    healthManager.applyHeal = async () => {
      throw new Error("applyHeal must not run while paused");
    };
    try {
      handlers.agent_end(
        { messages: [{ role: "assistant", stopReason: "error", error: "503 UNAVAILABLE" }] },
        ctx,
      );
      handlers.auto_retry_start({ attempt: 1, errorMessage: "socket reset" }, ctx);
      expect(probeCalls).toBe(0);
      expect(notifications).toEqual([]);
      expect(recorded).toHaveLength(1);
      expect(recorded[0][0].kind).toBe("agent_run");
      expect(recorded[0][0].status).toBe("error");
    } finally {
      healthManager.checkAllSweep = origCheckAllSweep;
      healthManager.applyHeal = origApplyHeal;
    }
  });

  test("enabled refresh still reports the account-discovery failure", async () => {
    const coordinator = new AutoHealCoordinator({ healthEnabled: true });
    const notifications: Array<{ message: string; type?: string }> = [];
    const ctx = {
      ui: {
        notify: (message: string, type?: "info" | "warning" | "error") => {
          notifications.push({ message, type });
        },
      },
    };
    const origCheckAllSweep = healthManager.checkAllSweep;
    healthManager.checkAllSweep = async () => {
      throw oauthFailure;
    };
    try {
      await coordinator.refresh(ctx as never, false);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe("error");
      expect(notifications[0].message).toContain("Gemini health check failed");
      expect(notifications[0].message).toContain("No OAuth accounts found");
    } finally {
      healthManager.checkAllSweep = origCheckAllSweep;
    }
  });
});
