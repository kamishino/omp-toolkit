import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { resolveAgentDir, resolveTemplatesDir } from "@omp-toolkit/core";
import { short } from "./fs-util";
import {
  applyTemplate,
  deleteTemplate,
  listTemplates,
  resolveCheckoutRoot,
  saveTemplate,
  showTemplate,
} from "./template-store";

export type TemplateCommand =
  | { action: "save"; name: string; force: boolean }
  | { action: "apply"; name: string }
  | { action: "list" }
  | { action: "show"; name: string }
  | { action: "delete"; name: string; force: boolean }
  | { action: "help" };

export const TEMPLATE_USAGE = `Usage: /template save <name> [--force] | apply <name> | list | show <name> | delete <name> --force
Templates bundle ~/.omp/agent AGENTS.md + RULES.md into <omp-toolkit checkout>/templates/<name>/. Names: 1-64 chars [a-z0-9-_], starting with a letter or digit.`;

export function parseTemplateArgs(args: string): TemplateCommand {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { action: "help" };
  }

  const action = tokens[0].toLowerCase();

  switch (action) {
    case "help": {
      if (tokens.length > 1) {
        throw new Error(TEMPLATE_USAGE);
      }
      return { action: "help" };
    }
    case "save": {
      if (tokens.length < 2 || tokens.length > 3) {
        throw new Error(TEMPLATE_USAGE);
      }
      const name = tokens[1];
      if (name.startsWith("-")) {
        throw new Error(TEMPLATE_USAGE);
      }
      let force = false;
      if (tokens.length === 3) {
        if (tokens[2] !== "--force") {
          throw new Error(TEMPLATE_USAGE);
        }
        force = true;
      }
      return { action: "save", name, force };
    }
    case "apply": {
      if (tokens.length !== 2) {
        throw new Error(TEMPLATE_USAGE);
      }
      const name = tokens[1];
      if (name.startsWith("-")) {
        throw new Error(TEMPLATE_USAGE);
      }
      return { action: "apply", name };
    }
    case "list": {
      if (tokens.length !== 1) {
        throw new Error(TEMPLATE_USAGE);
      }
      return { action: "list" };
    }
    case "show": {
      if (tokens.length !== 2) {
        throw new Error(TEMPLATE_USAGE);
      }
      const name = tokens[1];
      if (name.startsWith("-")) {
        throw new Error(TEMPLATE_USAGE);
      }
      return { action: "show", name };
    }
    case "delete": {
      if (tokens.length < 2 || tokens.length > 3) {
        throw new Error(TEMPLATE_USAGE);
      }
      const name = tokens[1];
      if (name.startsWith("-")) {
        throw new Error(TEMPLATE_USAGE);
      }
      let force = false;
      if (tokens.length === 3) {
        if (tokens[2] !== "--force") {
          throw new Error(TEMPLATE_USAGE);
        }
        force = true;
      }
      return { action: "delete", name, force };
    }
    default:
      throw new Error(TEMPLATE_USAGE);
  }
}

export function registerTemplateCommands(
  pi: ExtensionAPI,
  deps: { reloadIfAvailable: (ctx: ExtensionContext) => Promise<void> | undefined },
): void {
  pi.registerCommand("template", {
    description: "Save, apply, list, show, or delete global AGENTS.md + RULES.md template bundles",
    handler: async (args, ctx) => {
      try {
        const cmd = parseTemplateArgs(args);
        if (cmd.action === "help") {
          pi.sendMessage(
            {
              customType: "prompt-template",
              content: TEMPLATE_USAGE,
              display: true,
              attribution: "agent",
            },
            { triggerTurn: false },
          );
          return;
        }

        const checkoutRoot = resolveCheckoutRoot();
        const templatesDir = resolveTemplatesDir(checkoutRoot);
        const agentDirPath = resolveAgentDir();

        switch (cmd.action) {
          case "save": {
            const res = saveTemplate(templatesDir, agentDirPath, cmd.name, {
              force: cmd.force,
            });
            ctx.ui.notify(
              `Saved template "${res.name}" (${res.files.join(", ")}) to ${res.dir}. Commit it in git to keep/share it.`,
              "info",
            );
            break;
          }
          case "list": {
            const summaries = listTemplates(templatesDir, agentDirPath);
            if (summaries.length === 0) {
              pi.sendMessage(
                {
                  customType: "prompt-template",
                  content: `No templates in ${templatesDir}. Save your current globals: /template save <name>`,
                  display: true,
                  attribution: "agent",
                },
                { triggerTurn: false },
              );
              return;
            }
            const lines = [`Templates in ${templatesDir} (${summaries.length}):`];
            for (const s of summaries) {
              const mark = s.matchesLive ? "* " : "  ";
              const matchSuffix = s.matchesLive ? " (matches live)" : "";
              lines.push(`${mark}${s.name} — ${s.files.join(", ")}${matchSuffix}`);
            }
            pi.sendMessage(
              {
                customType: "prompt-template",
                content: lines.join("\n"),
                display: true,
                attribution: "agent",
              },
              { triggerTurn: false },
            );
            break;
          }
          case "show": {
            const res = showTemplate(templatesDir, agentDirPath, cmd.name);
            const matchSuffix = res.matchesLive ? " (matches live globals)" : "";
            const lines = [`Template "${res.name}" (${res.dir}):${matchSuffix}`];
            for (const c of res.comparisons) {
              if (c.inTemplate && c.liveExists) {
                lines.push(
                  `  ${c.file}: ${c.identical ? "identical to live" : "differs from live"}`,
                );
              } else if (c.inTemplate && !c.liveExists) {
                lines.push(`  ${c.file}: in template, missing live (apply will create)`);
              } else if (!c.inTemplate && c.liveExists) {
                lines.push(`  ${c.file}: missing in template, present live (apply will delete)`);
              } else {
                lines.push(`  ${c.file}: missing in both`);
              }
            }
            pi.sendMessage(
              {
                customType: "prompt-template",
                content: lines.join("\n"),
                display: true,
                attribution: "agent",
              },
              { triggerTurn: false },
            );
            break;
          }
          case "apply": {
            const res = applyTemplate(templatesDir, agentDirPath, cmd.name);
            await deps.reloadIfAvailable(ctx);
            const writtenStr = res.written.length > 0 ? res.written.join(", ") : "none";
            const deletedStr = res.deleted.length > 0 ? res.deleted.join(", ") : "none";
            const unchangedStr = res.unchanged.length > 0 ? res.unchanged.join(", ") : "none";
            const backupStr = res.backupDir ?? "none (no live files existed)";
            const msg = `Applied template "${res.name}": written: ${writtenStr}; deleted: ${deletedStr}; unchanged: ${unchangedStr}. Backup: ${backupStr}. Settings reload attempted — start /new to guarantee the new prompt is active.`;
            pi.sendMessage(
              {
                customType: "prompt-template",
                content: msg,
                display: true,
                attribution: "agent",
              },
              { triggerTurn: false },
            );
            break;
          }
          case "delete": {
            deleteTemplate(templatesDir, cmd.name, { force: cmd.force });
            ctx.ui.notify(`Deleted template "${cmd.name}" from ${templatesDir}.`, "info");
            break;
          }
        }
      } catch (error) {
        ctx.ui.notify(`Template command failed: ${short(error)}`, "error");
      }
    },
  });
}
