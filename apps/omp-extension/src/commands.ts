import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { WarmUpRequest } from "@omp-toolkit/core";
import type { AutoHealCoordinator } from "./auto-heal";
import { PROVIDER, RESTORE_STREAK } from "./config";
import { short } from "./fs-util";
import { handleGatewayCommand } from "./gateway-command";
import { healthManager } from "./health-manager";
import { runWarmUp, type WarmUpDependencies } from "./warmup";
import { publish, setWidgetEnabled, table, widgetEnabled } from "./widget";

export interface CommandDependencies {
  warmUpDeps: WarmUpDependencies;
  coordinator: AutoHealCoordinator;
  reloadIfAvailable: (ctx: ExtensionContext) => Promise<void> | undefined;
}

export function registerCommandsAndTools(pi: ExtensionAPI, deps: CommandDependencies): void {
  const { warmUpDeps, coordinator, reloadIfAvailable } = deps;
  const z = pi.zod;

  pi.registerCommand("gemini-health-widget", {
    description: "Show, hide, or toggle the Gemini health widget; auto-heal stays active",
    handler: async (args, ctx) => {
      const choice = args.trim().toLowerCase();
      const enabled = choice === "off" ? false : choice === "on" ? true : !widgetEnabled();
      setWidgetEnabled(enabled);
      if (!enabled) {
        ctx.ui.setStatus("gemini-health", undefined);
        ctx.ui.setWidget("gemini-health", undefined);
        ctx.ui.notify("Gemini health widget hidden. Auto-heal and commands remain active.", "info");
        return;
      }
      ctx.ui.notify("Gemini health widget enabled. Checking…", "info");
      await coordinator.refresh(ctx, false);
    },
  });

  pi.registerCommand("gemini-health", {
    description: "Probe every Google Antigravity account for gemini-3.8-flash route hangs",
    handler: async (args, ctx) => {
      const confirm = /--confirm\b/.test(args);
      await coordinator.runExclusive(ctx, "Gemini health check", async () => {
        try {
          const { results, restored, policies } = await coordinator.probeAndPublish(ctx, confirm);
          const text = table(results, policies);
          const restoredNote =
            restored.length > 0
              ? `\nRestored after ${RESTORE_STREAK} healthy checks: ${restored.join(", ")}`
              : "";
          pi.sendMessage(
            {
              customType: "gemini-health",
              content: `${text}${restoredNote}`,
              display: true,
              attribution: "agent",
            },
            { triggerTurn: false },
          );
          if (restored.length > 0) {
            ctx.ui.notify(
              `Gemini health: restored ${restored.join(", ")} after ${RESTORE_STREAK} healthy checks.`,
              "info",
            );
          }
        } catch (error) {
          ctx.ui.notify(`Gemini health check failed: ${short(error)}`, "error");
        }
      });
    },
  });

  pi.registerCommand("gemini-warmup", {
    description:
      "Warm up eligible Antigravity accounts with a minimal model request; skips non-OK accounts",
    handler: async (args, ctx) => {
      const all = /--all\b/.test(args);
      const needle = args
        .replace(/--all\b/g, "")
        .trim()
        .toLowerCase();
      if (!all && !needle) {
        ctx.ui.notify(
          "Usage: /gemini-warmup <email-or-local-part> or /gemini-warmup --all",
          "info",
        );
        return;
      }
      if (all && needle) {
        ctx.ui.notify(
          "Cannot combine --all with an account name. Use one or the other.",
          "warning",
        );
        return;
      }
      await coordinator.runExclusive(ctx, "A health check or warm-up is", async () => {
        try {
          let request: WarmUpRequest;
          if (all) {
            request = { provider: PROVIDER, action: "warm", all: true };
          } else {
            const resolution = await healthManager.resolveAccount(needle);
            if (resolution.status !== "found") {
              ctx.ui.notify(resolution.error, "warning");
              return;
            }
            request = { provider: PROVIDER, action: "warm", account: resolution.account.email };
          }

          const run = await runWarmUp(warmUpDeps, request);
          const policies = await healthManager.readPolicies();
          const snapshotResults = healthManager.readSnapshot()?.results ?? run.results;
          publish(ctx, snapshotResults, policies);

          if ("all" in request) {
            const nonOkSkipped = run.report.skipped.filter((s) => s.reason === "non-ok").length;
            const cooldownSkipped = run.report.skipped.filter(
              (s) => s.reason === "cooldown",
            ).length;
            const skipDetails = [
              nonOkSkipped > 0 ? `${nonOkSkipped} non-OK` : null,
              cooldownSkipped > 0 ? `${cooldownSkipped} cooldown` : null,
            ]
              .filter(Boolean)
              .join(", ");
            const note = skipDetails ? ` · skipped ${skipDetails}` : "";
            ctx.ui.notify(`Warmed ${run.report.results.length} account(s)${note}.`, "info");
          } else {
            if (run.report.results.length > 0) {
              const res = run.report.results[0];
              ctx.ui.notify(
                `Warmed ${res.account} (${res.status.toUpperCase()}, ${res.ms}ms).`,
                "info",
              );
            } else if (run.report.skipped.length > 0) {
              const skip = run.report.skipped[0];
              if (skip.reason === "non-ok") {
                ctx.ui.notify(
                  `Not warmed: ${skip.account} is ${String(skip.status).toUpperCase()}; use /gemini-check.`,
                  "warning",
                );
              } else {
                ctx.ui.notify(
                  `Not warmed: ${skip.account} was warmed recently (cooldown active).`,
                  "info",
                );
              }
            }
          }
        } catch (error) {
          ctx.ui.notify(`Gemini warm-up failed: ${short(error)}`, "error");
        }
      });
    },
  });

  pi.registerCommand("gemini-check", {
    description: "Probe one Antigravity account to check if its route has recovered (unhang check)",
    handler: async (args, ctx) => {
      const needle = args.trim().toLowerCase();
      if (!needle) {
        ctx.ui.notify("Usage: /gemini-check <email-or-local-part>", "info");
        return;
      }
      await coordinator.runExclusive(ctx, "A health check or warm-up is", async () => {
        try {
          const resolution = await healthManager.resolveAccount(needle);
          if (resolution.status !== "found") {
            ctx.ui.notify(resolution.error, "warning");
            return;
          }

          const run = await runWarmUp(warmUpDeps, {
            provider: PROVIDER,
            action: "check",
            account: resolution.account.email,
          });

          const policies = await healthManager.readPolicies();
          const snapshotResults = healthManager.readSnapshot()?.results ?? run.results;
          publish(ctx, snapshotResults, policies);

          const res = run.report.results[0];
          const statusText = res ? res.status.toUpperCase() : "UNKNOWN";
          const message = `Checked ${resolution.account.email}: ${statusText}${res ? ` (${res.ms}ms)` : ""}.`;
          ctx.ui.notify(message, res?.status === "ok" ? "info" : "warning");
        } catch (error) {
          ctx.ui.notify(`Gemini check failed: ${short(error)}`, "error");
        }
      });
    },
  });

  pi.registerCommand("gemini-heal", {
    description: "Temporarily exclude Antigravity accounts whose Gemini 3.8 route is hung",
    handler: async (args, ctx) => {
      const dryRun = /--dry-run\b/.test(args);
      await coordinator.runExclusive(ctx, "Gemini health check", async () => {
        try {
          const { results, restored } = await coordinator.probeAndPublish(ctx, true);
          if (dryRun) {
            healthManager.recordHistory([
              {
                at: Date.now(),
                kind: "manual_intervention",
                provider: PROVIDER,
                detail: "gemini-heal --dry-run",
              },
            ]);
            const bad = results.filter(
              (result) => result.status === "hang" || result.status === "error",
            );
            ctx.ui.notify(
              bad.length === 0
                ? "Dry run: no hung accounts"
                : `Dry run: would exclude ${bad.map((result) => result.email).join(", ")}`,
              "info",
            );
            return;
          }
          const action = await healthManager.applyHeal(results, "heal");
          const nextPolicies = await healthManager.readPolicies();
          publish(ctx, results, nextPolicies);
          healthManager.recordHistory([
            {
              at: Date.now(),
              kind: "manual_intervention",
              provider: PROVIDER,
              detail: "gemini-heal",
            },
          ]);
          const restoredNote = restored.length > 0 ? ` Restored ${restored.join(", ")}.` : "";
          const message =
            action.changed.length > 0
              ? `Excluded ${action.changed.join(", ")} temporarily.${restoredNote} Reloading settings.`
              : `No new exclusion: ${action.reason}${action.skipped.length ? ` (skipped: ${action.skipped.join(", ")})` : ""}.${restoredNote}`;
          ctx.ui.notify(message, action.changed.length > 0 ? "warning" : "info");
          pi.sendMessage(
            {
              customType: "gemini-heal",
              content: `${message}\n\n${table(results, nextPolicies)}`,
              display: true,
              attribution: "agent",
            },
            { triggerTurn: false },
          );
          await reloadIfAvailable(ctx);
        } catch (error) {
          ctx.ui.notify(`Gemini heal failed: ${short(error)}`, "error");
        }
      });
    },
  });

  pi.registerCommand("gemini-restore", {
    description: "Remove only the Antigravity account exclusions added by /gemini-heal",
    handler: async (_args, ctx) => {
      try {
        const removed = await healthManager.restoreManaged();
        healthManager.recordHistory([
          {
            at: Date.now(),
            kind: "manual_intervention",
            provider: PROVIDER,
            detail: "gemini-restore",
          },
        ]);
        ctx.ui.notify(
          removed.length > 0
            ? `Restored ${removed.join(", ")}`
            : "No health-managed exclusions to restore",
          "info",
        );
        if (removed.length > 0) {
          pi.sendMessage(
            {
              customType: "gemini-restore",
              content: `Restored accounts: ${removed.join(", ")}`,
              display: true,
              attribution: "agent",
            },
            { triggerTurn: false },
          );
          await reloadIfAvailable(ctx);
        }
      } catch (error) {
        ctx.ui.notify(`Gemini restore failed: ${short(error)}`, "error");
      }
    },
  });
  // Resolves against live Antigravity accounts; removed accounts must be cleared manually via omp config.
  pi.registerCommand("gemini-enable", {
    description:
      "Explicitly remove a Gemini account exclusion and re-enable it (requires --force if latest check is not OK)",
    handler: async (args, ctx) => {
      const force = /--force\b/.test(args);
      const needle = args
        .replace(/--force\b/g, "")
        .trim()
        .toLowerCase();
      if (!needle) {
        ctx.ui.notify("Usage: /gemini-enable <email-or-local-part> [--force]", "info");
        return;
      }
      try {
        const resolution = await healthManager.resolveAccount(needle);
        if (resolution.status !== "found") {
          ctx.ui.notify(resolution.error, "warning");
          return;
        }
        const account = resolution.account;
        const target = account.email;

        const policies = await healthManager.readPolicies();
        const hasExclusion = policies.some(
          (policy) =>
            policy?.provider === PROVIDER &&
            typeof policy?.account?.email === "string" &&
            policy.account.email.toLowerCase() === target.toLowerCase(),
        );
        if (!hasExclusion) {
          ctx.ui.notify(`No exclusion found for ${target}`, "info");
          return;
        }

        const latest = healthManager
          .readSnapshot()
          ?.results.find((result) => result.email.toLowerCase() === target.toLowerCase());
        if (latest && latest.status !== "ok" && !force) {
          ctx.ui.notify(
            `Refusing to enable ${latest.email}: latest check is ${latest.status.toUpperCase()}. Run /gemini-health, or use --force.`,
            "warning",
          );
          return;
        }
        if (latest && latest.status !== "ok") {
          ctx.ui.notify(
            `Warning: ${latest.email} was ${latest.status.toUpperCase()} in the latest check; enabling anyway.`,
            "warning",
          );
        }

        await healthManager.removeExclusion(target, "gemini-enable");

        const message = `Enabled ${target}`;
        ctx.ui.notify(message, "info");
        pi.sendMessage(
          {
            customType: "gemini-enable",
            content: message,
            display: true,
            attribution: "agent",
          },
          { triggerTurn: false },
        );
        await reloadIfAvailable(ctx);
      } catch (error) {
        ctx.ui.notify(`Gemini enable failed: ${short(error)}`, "error");
      }
    },
  });
  pi.registerCommand("gemini-auto-restore", {
    description:
      "Manage opt-in automatic restoration for manual Gemini account exclusions: /gemini-auto-restore [<email>|off <email>]",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      try {
        const sidecar = healthManager.readAutoRestore();
        const policies = await healthManager.readPolicies();
        const state = healthManager.readState();
        const managed = new Set(state.excluded);
        const manual = policies
          .filter(
            (p) =>
              p?.provider === PROVIDER &&
              typeof p?.account?.email === "string" &&
              (p.reservePct ?? 0) >= 100 &&
              !managed.has(p.account.email),
          )
          .map((p) => p.account?.email)
          .filter((email): email is string => typeof email === "string");

        // Case 1: no args -> list opted-in accounts and current manual exclusions
        if (!trimmed) {
          const optedInList = sidecar.enabled.length > 0 ? sidecar.enabled.join(", ") : "none";
          const manualList = manual.length > 0 ? manual.join(", ") : "none";
          const content = `Opted-in for auto-restore: ${optedInList}\nManual exclusions: ${manualList}`;
          ctx.ui.notify(content, "info");
          pi.sendMessage(
            {
              customType: "gemini-auto-restore",
              content,
              display: true,
              attribution: "agent",
            },
            { triggerTurn: false },
          );
          return;
        }

        // Case 2: off <email-or-local-part>
        if (trimmed.startsWith("off ") || trimmed === "off") {
          const needle = trimmed.replace(/^off\s*/, "").trim();
          if (!needle) {
            ctx.ui.notify("Usage: /gemini-auto-restore off <email-or-local-part>", "warning");
            return;
          }
          const resolution = await healthManager.resolveAccount(needle);
          let targetEmail: string;
          if (resolution.status === "ambiguous") {
            ctx.ui.notify(resolution.error, "warning");
            return;
          }
          if (resolution.status === "found") {
            targetEmail = resolution.account.email;
          } else {
            const matchInSidecar = sidecar.enabled.find(
              (e) =>
                e.toLowerCase() === needle.toLowerCase() ||
                e.toLowerCase().split("@")[0] === needle.toLowerCase(),
            );
            if (!matchInSidecar) {
              ctx.ui.notify(`Account "${needle}" is not opted in to auto-restore`, "info");
              return;
            }
            targetEmail = matchInSidecar;
          }

          if (!sidecar.enabled.some((e) => e.toLowerCase() === targetEmail.toLowerCase())) {
            ctx.ui.notify(`Account ${targetEmail} is not opted in to auto-restore`, "info");
            return;
          }

          sidecar.enabled = sidecar.enabled.filter(
            (e) => e.toLowerCase() !== targetEmail.toLowerCase(),
          );
          healthManager.writeAutoRestore(sidecar);
          healthManager.recordHistory([
            {
              at: Date.now(),
              kind: "policy_change",
              provider: PROVIDER,
              account: targetEmail,
              detail: "gemini-auto-restore off",
            },
          ]);
          ctx.ui.notify(`Removed ${targetEmail} from auto-restore`, "info");
          return;
        }

        // Case 3: <email-or-local-part> -> opt in
        const needle = trimmed;
        const resolution = await healthManager.resolveAccount(needle);
        if (resolution.status === "not_found") {
          ctx.ui.notify(resolution.error, "warning");
          return;
        }
        if (resolution.status === "ambiguous") {
          ctx.ui.notify(resolution.error, "warning");
          return;
        }

        const email = resolution.account.email;
        if (!sidecar.enabled.some((e) => e.toLowerCase() === email.toLowerCase())) {
          sidecar.enabled.push(email);
          healthManager.writeAutoRestore(sidecar);
          healthManager.recordHistory([
            {
              at: Date.now(),
              kind: "policy_change",
              provider: PROVIDER,
              account: email,
              detail: "gemini-auto-restore",
            },
          ]);
          ctx.ui.notify(`Enabled auto-restore for ${email}`, "info");
        } else {
          ctx.ui.notify(`${email} is already opted in to auto-restore`, "info");
        }
      } catch (error) {
        ctx.ui.notify(`Gemini auto-restore failed: ${short(error)}`, "error");
      }
    },
  });

  pi.registerCommand("gateway", {
    description:
      "Manage OMP Auth Gateway, Cloudflare Tunnel, and client PC tokens: /gateway [status|start|stop|restart|client-add|recipe]",
    handler: async (args, ctx) => {
      try {
        const rawArgs = args.trim().split(/\s+/).filter(Boolean);
        const output = await handleGatewayCommand(rawArgs);
        pi.sendMessage(
          {
            customType: "gateway-status",
            content: output,
            display: true,
            attribution: "agent",
          },
          { triggerTurn: false },
        );
      } catch (error) {
        ctx.ui.notify(`Gateway command failed: ${short(error)}`, "error");
      }
    },
  });

  pi.registerTool({
    name: "gemini_health",
    label: "Gemini Health",
    description:
      "Probe every Google Antigravity account for gemini-3.8-flash route hangs. Optionally apply temporary reservePct=100 exclusions for hung accounts.",
    parameters: z.object({
      heal: z.boolean().default(false).describe("Temporarily exclude accounts whose route is hung"),
      confirm: z
        .boolean()
        .default(true)
        .describe("Re-probe failing accounts before reporting or excluding"),
    }),
    loadMode: "essential",
    approval: "write",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const results = await healthManager.checkAll(params.confirm);
      await healthManager.recordHealth(results);
      const restored = params.heal ? await healthManager.maybeRestoreManaged() : [];
      const policies = await healthManager.readPolicies();
      publish(ctx, results, policies);
      let note =
        restored.length > 0
          ? `\nRestored after ${RESTORE_STREAK} healthy checks: ${restored.join(", ")}`
          : "";
      if (params.heal) {
        const action = await healthManager.applyHeal(results, "tool");
        const nextPolicies = await healthManager.readPolicies();
        publish(ctx, results, nextPolicies);
        note += `\nHeal: ${action.reason}${
          action.changed.length > 0 ? `; excluded ${action.changed.join(", ")}` : ""
        }${action.skipped.length > 0 ? `; skipped ${action.skipped.join(", ")}` : ""}`;
        return {
          content: [{ type: "text", text: `${table(results, nextPolicies)}${note}` }],
          details: { results, action, restored },
        };
      }
      return {
        content: [{ type: "text", text: `${table(results, policies)}${note}` }],
        details: { results, restored },
      };
    },
  });
}
