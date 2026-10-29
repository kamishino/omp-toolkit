import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { parseTemplateArgs, registerTemplateCommands, TEMPLATE_USAGE } from "./template-commands";

describe("template-commands parser", () => {
  test("empty args or whitespace returns help action", () => {
    expect(parseTemplateArgs("")).toEqual({ action: "help" });
    expect(parseTemplateArgs("   ")).toEqual({ action: "help" });
    expect(parseTemplateArgs("help")).toEqual({ action: "help" });
  });

  test("unknown action or extra tokens on help throws usage", () => {
    expect(() => parseTemplateArgs("unknown")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("help extra")).toThrow(TEMPLATE_USAGE);
  });

  test("save parses name and force flag", () => {
    // Happy path without force
    expect(parseTemplateArgs("save my-template")).toEqual({
      action: "save",
      name: "my-template",
      force: false,
    });

    // Happy path with force
    expect(parseTemplateArgs("save my-template --force")).toEqual({
      action: "save",
      name: "my-template",
      force: true,
    });

    // Case-insensitivity on action and irregular whitespace
    expect(parseTemplateArgs("  SAVE   custom-slug   --force  ")).toEqual({
      action: "save",
      name: "custom-slug",
      force: true,
    });

    // Missing name throws usage
    expect(() => parseTemplateArgs("save")).toThrow(TEMPLATE_USAGE);

    // Name starting with '-' throws usage (e.g. save --force my-template)
    expect(() => parseTemplateArgs("save --force my-template")).toThrow(TEMPLATE_USAGE);

    // Bogus flag throws usage
    expect(() => parseTemplateArgs("save my-template --bogus")).toThrow(TEMPLATE_USAGE);

    // Too many tokens throws usage
    expect(() => parseTemplateArgs("save my-template --force extra")).toThrow(TEMPLATE_USAGE);
  });

  test("apply parses name and rejects extra or invalid flag-like name", () => {
    expect(parseTemplateArgs("apply work")).toEqual({
      action: "apply",
      name: "work",
    });

    expect(parseTemplateArgs("  APPLY   work  ")).toEqual({
      action: "apply",
      name: "work",
    });

    expect(() => parseTemplateArgs("apply")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("apply -flag")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("apply work extra")).toThrow(TEMPLATE_USAGE);
  });

  test("list takes zero arguments", () => {
    expect(parseTemplateArgs("list")).toEqual({ action: "list" });
    expect(parseTemplateArgs("  LIST  ")).toEqual({ action: "list" });
    expect(() => parseTemplateArgs("list extra")).toThrow(TEMPLATE_USAGE);
  });

  test("show parses name and rejects extra or missing name", () => {
    expect(parseTemplateArgs("show deepseek-mode")).toEqual({
      action: "show",
      name: "deepseek-mode",
    });

    expect(() => parseTemplateArgs("show")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("show --flag")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("show deepseek-mode extra")).toThrow(TEMPLATE_USAGE);
  });

  test("delete parses name and force flag", () => {
    expect(parseTemplateArgs("delete old-tmpl --force")).toEqual({
      action: "delete",
      name: "old-tmpl",
      force: true,
    });

    expect(parseTemplateArgs("delete old-tmpl")).toEqual({
      action: "delete",
      name: "old-tmpl",
      force: false,
    });

    expect(() => parseTemplateArgs("delete")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("delete --force old-tmpl")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("delete old-tmpl --bogus")).toThrow(TEMPLATE_USAGE);
    expect(() => parseTemplateArgs("delete old-tmpl --force extra")).toThrow(TEMPLATE_USAGE);
  });
});

describe("registerTemplateCommands handler", () => {
  test("executes save, list, apply, and error paths via registered command handler", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tmpl-cmd-test-"));
    const agentDir = path.join(root, "agent");
    const checkout = path.join(root, "checkout");
    const templatesDir = path.join(checkout, "templates");
    const probe = path.join(checkout, "scripts", "monitor", "orca-monitor.ts");

    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, "// probe");

    const origHome = process.env.OMP_TOOLKIT_HOME;
    const origAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.OMP_TOOLKIT_HOME = checkout;
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
      let commandHandler: ((args: string, ctx: ExtensionContext) => Promise<void>) | undefined;
      const sentMessages: Array<{ customType: string; content: string }> = [];
      const notifications: Array<{ message: string; type?: string }> = [];

      const mockPi = {
        registerCommand(_name: string, opts: { handler: typeof commandHandler }) {
          commandHandler = opts.handler;
        },
        sendMessage(msg: { customType: string; content: string }) {
          sentMessages.push(msg);
        },
      } as unknown as ExtensionAPI;

      const mockCtx = {
        ui: {
          notify(message: string, type?: string) {
            notifications.push({ message, type });
          },
        },
      } as unknown as ExtensionContext;

      registerTemplateCommands(mockPi, {
        reloadIfAvailable: async () => {},
      });

      expect(commandHandler).toBeDefined();
      if (!commandHandler) throw new Error("commandHandler not registered");
      const handler = commandHandler;

      // Seed live file
      fs.writeFileSync(path.join(agentDir, "AGENTS.md"), "agents v1\n");

      // 1. Save demo
      await handler("save demo", mockCtx);
      expect(notifications.some((n) => n.message.includes('Saved template "demo"'))).toBe(true);

      // 2. List templates
      await handler("list", mockCtx);
      expect(sentMessages.some((m) => m.content.includes("demo"))).toBe(true);

      // 3. Modify live file, then apply demo
      fs.writeFileSync(path.join(agentDir, "AGENTS.md"), "agents modified live\n");
      await handler("apply demo", mockCtx);
      expect(sentMessages.some((m) => m.content.includes('Applied template "demo"'))).toBe(true);
      expect(fs.readFileSync(path.join(agentDir, "AGENTS.md"), "utf8")).toBe("agents v1\n");

      // 4. Apply non-existent template -> notifies error, live file untouched
      await handler("apply nonexistent", mockCtx);
      expect(
        notifications.some(
          (n) => n.type === "error" && n.message.includes("Template command failed"),
        ),
      ).toBe(true);
      expect(fs.readFileSync(path.join(agentDir, "AGENTS.md"), "utf8")).toBe("agents v1\n");
    } finally {
      if (origHome !== undefined) process.env.OMP_TOOLKIT_HOME = origHome;
      else delete process.env.OMP_TOOLKIT_HOME;
      if (origAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = origAgentDir;
      else delete process.env.PI_CODING_AGENT_DIR;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
