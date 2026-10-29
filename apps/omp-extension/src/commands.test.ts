import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { Policy, ProbeResult } from "@omp-toolkit/core";
import { type CommandDependencies, registerCommandsAndTools } from "./commands";
import { healthManager } from "./health-manager";
import { widgetEnabled } from "./widget";

interface RegisteredCommand {
  description: string;
  handler: (args: string, ctx: ExtensionContext) => unknown;
}

interface RegisteredTool {
  name: string;
  label?: string;
  description?: string;
  execute: (
    id: string,
    params: { confirm?: boolean; heal?: boolean },
    signal: unknown,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ) => Promise<{ content: unknown[]; details: Record<string, unknown> }>;
}

describe("registerCommandsAndTools", () => {
  const origCheckAll = healthManager.checkAll.bind(healthManager);
  const origRestoreManaged = healthManager.restoreManaged.bind(healthManager);
  const origApplyHeal = healthManager.applyHeal.bind(healthManager);
  const origRecordHealth = healthManager.recordHealth.bind(healthManager);
  const origMaybeRestore = healthManager.maybeRestoreManaged.bind(healthManager);
  const origReadPolicies = healthManager.readPolicies.bind(healthManager);

  beforeAll(() => {
    healthManager.checkAll = async () => [
      {
        index: 0,
        email: "alpha@example.com",
        project: "test-proj",
        status: "ok",
        ms: 120,
      },
    ];
    healthManager.restoreManaged = async () => ["alpha@example.com"];
    healthManager.recordHealth = () => {};
    healthManager.maybeRestoreManaged = async () => ["alpha@example.com"];
    healthManager.readPolicies = async () => [];
    healthManager.applyHeal = async (_results, reason) => ({
      status: "success",
      changed: ["alpha@example.com"],
      skipped: [],
      reason: reason ?? "heal",
    });
  });

  afterAll(() => {
    healthManager.checkAll = origCheckAll;
    healthManager.restoreManaged = origRestoreManaged;
    healthManager.applyHeal = origApplyHeal;
    healthManager.recordHealth = origRecordHealth;
    healthManager.maybeRestoreManaged = origMaybeRestore;
    healthManager.readPolicies = origReadPolicies;
  });

  function createTestHarness() {
    const commands: Record<string, RegisteredCommand> = {};
    const tools: Record<string, RegisteredTool> = {};
    const sentMessages: Array<{ customType: string; content: string }> = [];
    const notifications: Array<{ message: string; type?: string }> = [];
    const statuses: Record<string, unknown> = {};
    const widgets: Record<string, unknown> = {};

    const mockZod = {
      object: (shape: unknown) => ({
        shape,
        describe: () => mockZod.object(shape),
        default: () => mockZod.object(shape),
      }),
      boolean: () => ({
        describe: () => mockZod.boolean(),
        default: () => mockZod.boolean(),
      }),
    };

    const mockPi = {
      zod: mockZod,
      registerCommand: (name: string, options: RegisteredCommand) => {
        commands[name] = options;
      },
      registerTool: (options: RegisteredTool) => {
        tools[options.name] = options;
      },
      sendMessage: (message: { customType: string; content: string }) => {
        sentMessages.push(message);
      },
      on: () => {},
      registerProvider: () => {},
      unregisterProvider: () => {},
    } as unknown as ExtensionAPI;

    const mockCtx = {
      ui: {
        notify: (message: string, type?: "info" | "warning" | "error") => {
          notifications.push({ message, type });
        },
        setStatus: (key: string, value: unknown) => {
          statuses[key] = value;
        },
        setWidget: (key: string, value: unknown) => {
          widgets[key] = value;
        },
      },
    } as unknown as ExtensionContext;

    let reloaded = false;
    const mockCoordinator = {
      refresh: async () => {},
      probeAndPublish: async (_ctx: ExtensionContext, _confirm?: boolean) => {
        const results: ProbeResult[] = [
          {
            index: 0,
            email: "alpha@example.com",
            project: "test-proj",
            status: "ok",
            ms: 120,
          },
        ];
        const restored: string[] = [];
        const policies: Policy[] = [];
        return { results, restored, policies };
      },
      runExclusive: async (_ctx: ExtensionContext, _label: string, fn: () => Promise<void>) => {
        await fn();
      },
      restoreManaged: async () => ["alpha@example.com"],
    };

    const mockWarmUpDeps = {
      client: {
        probeAccount: async () => ({
          status: "ok" as const,
          latencyMs: 100,
          rawStatus: "ok",
        }),
      },
      policyStore: {
        readPolicies: async () => [],
      },
      accounts: async () => [{ email: "alpha@example.com" }],
    };

    const deps: CommandDependencies = {
      warmUpDeps: mockWarmUpDeps as unknown as CommandDependencies["warmUpDeps"],
      coordinator: mockCoordinator as unknown as CommandDependencies["coordinator"],
      reloadIfAvailable: async () => {
        reloaded = true;
      },
    };

    registerCommandsAndTools(mockPi, deps);

    return {
      commands,
      tools,
      sentMessages,
      notifications,
      statuses,
      widgets,
      mockCtx,
      mockCoordinator,
      isReloaded: () => reloaded,
    };
  }

  test("registers all 8 slash commands and the gemini_health tool", () => {
    const { commands, tools } = createTestHarness();

    const expectedCommands = [
      "gemini-health-widget",
      "gemini-health",
      "gemini-warmup",
      "gemini-check",
      "gemini-heal",
      "gemini-restore",
      "gemini-enable",
      "gemini-auto-restore",
    ];

    for (const cmd of expectedCommands) {
      expect(commands[cmd]).toBeDefined();
      expect(typeof commands[cmd].handler).toBe("function");
    }

    expect(tools.gemini_health).toBeDefined();
    expect(typeof tools.gemini_health.execute).toBe("function");
  });

  test("gemini-health-widget toggles, enables, and hides widget", async () => {
    const { commands, mockCtx, notifications, statuses, widgets } = createTestHarness();
    const handler = commands["gemini-health-widget"].handler;

    // Test "off"
    await handler("off", mockCtx);
    expect(widgetEnabled()).toBe(false);
    expect(statuses["gemini-health"]).toBeUndefined();
    expect(widgets["gemini-health"]).toBeUndefined();
    expect(notifications.some((n) => n.message.includes("hidden"))).toBe(true);

    // Test "on"
    await handler("on", mockCtx);
    expect(widgetEnabled()).toBe(true);
    expect(notifications.some((n) => n.message.includes("enabled"))).toBe(true);

    // Test toggle (empty args flips true -> false)
    await handler("", mockCtx);
    expect(widgetEnabled()).toBe(false);
  });

  test("gemini-health runs probe check, sends message, and notifies", async () => {
    const { commands, mockCtx, sentMessages } = createTestHarness();
    const handler = commands["gemini-health"].handler;

    await handler("", mockCtx);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].customType).toBe("gemini-health");
    expect(sentMessages[0].content).toContain("alpha@example.com");

    // With --confirm flag
    await handler("--confirm", mockCtx);
    expect(sentMessages).toHaveLength(2);
  });

  test("gemini-warmup handles --all and target email arguments", async () => {
    const { commands, mockCtx, notifications } = createTestHarness();
    const handler = commands["gemini-warmup"].handler;

    // --all warm up
    await handler("--all", mockCtx);
    expect(notifications.length).toBeGreaterThan(0);

    // targeting single account
    await handler("alpha@example.com", mockCtx);
    expect(notifications.length).toBeGreaterThan(1);
  });

  test("gemini-check validates needle and performs unhang check", async () => {
    const { commands, mockCtx, notifications } = createTestHarness();
    const handler = commands["gemini-check"].handler;

    // Empty needle triggers usage error
    await handler("", mockCtx);
    expect(notifications.some((n) => n.message.includes("Usage: /gemini-check"))).toBe(true);

    // Needle targeting alpha
    await handler("alpha", mockCtx);
    expect(
      notifications.some((n) => n.message.includes("Warming") || n.message.includes("alpha")),
    ).toBe(true);
  });

  test("gemini-heal handles --dry-run and active healing execution", async () => {
    const { commands, mockCtx, notifications, sentMessages, isReloaded } = createTestHarness();
    const handler = commands["gemini-heal"].handler;

    // Dry run
    await handler("--dry-run", mockCtx);
    expect(notifications.some((n) => n.message.includes("Dry run"))).toBe(true);
    expect(sentMessages).toHaveLength(0);

    // Active heal
    await handler("", mockCtx);
    expect(sentMessages.some((m) => m.customType === "gemini-heal")).toBe(true);
    expect(isReloaded()).toBe(true);
  });

  test("gemini-restore calls restoreManaged and notifies", async () => {
    const { commands, mockCtx, notifications, sentMessages, isReloaded } = createTestHarness();
    const handler = commands["gemini-restore"].handler;

    await handler("", mockCtx);
    expect(notifications.some((n) => n.message.includes("Restored"))).toBe(true);
    expect(sentMessages.some((m) => m.customType === "gemini-restore")).toBe(true);
    expect(isReloaded()).toBe(true);
  });

  test("gemini-enable requires email argument and enforces --force when needed", async () => {
    const { commands, mockCtx, notifications } = createTestHarness();
    const handler = commands["gemini-enable"].handler;

    // Empty argument
    await handler("", mockCtx);
    expect(notifications.some((n) => n.message.includes("Usage: /gemini-enable"))).toBe(true);

    // Unknown email
    await handler("nonexistent@example.com", mockCtx);
    expect(notifications.some((n) => n.message.includes("No exclusion found"))).toBe(true);
  });

  test("gemini-auto-restore lists status when given empty arguments", async () => {
    const { commands, mockCtx, sentMessages } = createTestHarness();
    const handler = commands["gemini-auto-restore"].handler;

    await handler("", mockCtx);
    expect(sentMessages.some((m) => m.customType === "gemini-auto-restore")).toBe(true);
  });

  test("gemini_health tool execute runs check and returns structured details", async () => {
    const { tools, mockCtx } = createTestHarness();
    const tool = tools.gemini_health;

    // Without heal
    const res = await tool.execute("call-1", { confirm: true, heal: false }, null, null, mockCtx);
    expect(res.content).toBeDefined();
    expect(res.details).toBeDefined();
    expect(res.details.results).toBeDefined();

    // With heal
    const resHeal = await tool.execute(
      "call-2",
      { confirm: true, heal: true },
      null,
      null,
      mockCtx,
    );
    expect(resHeal.details.action).toBeDefined();
  });
});
