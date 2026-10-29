import { describe, expect, test } from "bun:test";
import {
  AutoHealCoordinator,
  extractRunTokens,
  extractTokenTotal,
  parseLastAssistantMessage,
} from "./auto-heal";
import type { HistoryEventInput } from "./history-store";

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
    expect(recorded[3][0].detail).toContain("[strike 1]");
    expect(notifications.some((n) => n.message.includes("Strike 1"))).toBe(true);

    // Turn 5: Strike 2 error status -> records alert event and notifies error
    handlers.agent_end(
      {
        messages: [{ role: "assistant", stopReason: "error", error: "compile failure" }],
      },
      mockCtxTui,
    );

    expect(recorded).toHaveLength(5);
    expect(recorded[4]).toHaveLength(2); // agent_run + alert
    expect(recorded[4][0].status).toBe("error");
    expect(recorded[4][0].detail).toContain("[strike 2 - halted]");
    expect(recorded[4][1].kind).toBe("alert");
    expect(recorded[4][1].detail).toBe("two-strike escalation limit reached");
    expect(notifications.some((n) => n.message.includes("Strike 2"))).toBe(true);

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
