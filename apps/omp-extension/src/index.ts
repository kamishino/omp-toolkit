/**
 * Gemini 3.8 route health widget + temporary account circuit breaker.
 *
 * Why: OMP pins a session to one OAuth account. A hung Gemini route (request
 * accepted, no first SSE event) is not a usage/auth failure, so the pin never
 * rotates and fallback chains do not fire. This extension probes every
 * Antigravity account directly and can temporarily reserve (exclude) the
 * accounts whose route is hung.
 *
 * Commands:
 *   /gemini-health [--confirm]   probe all accounts and update the widget
 *   /gemini-heal [--dry-run]     probe + reserve hung accounts (temporary)
 *   /gemini-restore              remove only the exclusions added by heal
 *
 * Tool: gemini_health { heal?: boolean, confirm?: boolean }
 *
 * The probe uses the same wire envelope OMP uses for Antigravity. If Google
 * changes the model id or client version gate, update MODEL_WIRE / UA_VERSION.
 */

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { deepSeekUsageReport, type WarmUpRequest } from "@omp-toolkit/core";
import {
  AUTO_HEAL_COOLDOWN_MS,
  agentDir,
  applyHeal,
  checkAll,
  loadAccounts,
  maybeRestoreManaged,
  PROVIDER,
  policyStore,
  probe,
  probeClient,
  RESTORE_STREAK,
  readPolicies,
  readPoliciesForWrite,
  readSnapshot,
  recordHealth,
  recordHistory,
  removeAccountExclusion,
  restoreManaged,
  short,
  sleep,
} from "./circuit-breaker";
import { registerGeminiNormalizer } from "./gemini-normalizer";
import { closeHistory } from "./history";
import { runWarmUp, type WarmUpAdapter, type WarmUpDependencies } from "./warmup";
import { publish, setWidgetEnabled, summary, table, widgetEnabled } from "./widget";

export {
  applyHeal,
  checkAll,
  loadAccounts,
  maybeRestoreManaged,
  policyStore,
  probe,
  probeClient,
  recordHealth,
  restoreManaged,
};

function reloadIfAvailable(ctx: ExtensionContext): Promise<void> | undefined {
  const reload = (ctx as ExtensionContext & { reload?: () => Promise<void> }).reload;
  return reload?.();
}

const antigravityAdapter: WarmUpAdapter = {
  provider: PROVIDER,
  loadAccounts,
  probe,
};
const warmUpAdapters = new Map<string, WarmUpAdapter>([[PROVIDER, antigravityAdapter]]);
const warmUpDeps: WarmUpDependencies = {
  agentDir: agentDir(),
  adapters: warmUpAdapters,
  readSnapshot,
  recordHealth,
};
export default function geminiHealthExtension(pi: ExtensionAPI) {
  registerGeminiNormalizer(pi);
  pi.registerProvider("deepseek", {
    apiKey: "DEEPSEEK_API_KEY",
    usage: {
      id: "deepseek",
      cacheVersion: 1,
      async fetchUsage(params, ctx) {
        const apiKey = params.credential.apiKey;
        if (!apiKey) return null;
        const base = (params.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
        try {
          const response = await ctx.fetch(`${base}/user/balance`, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: "application/json",
            },
            signal: params.signal,
          });
          if (!response.ok) return null;
          return deepSeekUsageReport(await response.json(), Date.now(), params.credential);
        } catch {
          return null;
        }
      },
    },
  });

  const z = pi.zod;
  let lastAutoHeal = 0;
  let running = false;

  async function refresh(ctx: ExtensionContext, notify = false): Promise<void> {
    if (running) return;
    running = true;
    try {
      const results = await checkAll(false);
      recordHealth(results);
      const restored = await maybeRestoreManaged();
      const policies = await readPolicies();
      publish(ctx, results, policies);
      if (restored.length > 0) {
        ctx.ui.notify(
          `Gemini health: restored ${restored.join(", ")} after ${RESTORE_STREAK} healthy checks.`,
          "info",
        );
      }
      if (notify) {
        ctx.ui.notify(
          summary(results),
          results.every((r) => r.status === "ok") ? "info" : "warning",
        );
      }
    } catch (error) {
      ctx.ui.notify(`Gemini health check failed: ${short(error)}`, "error");
    } finally {
      running = false;
    }
  }

  async function autoHeal(ctx: ExtensionContext, trigger: string): Promise<void> {
    if (running) return;
    running = true;
    try {
      const results = await checkAll(true);
      recordHealth(results);
      const restored = await maybeRestoreManaged();
      const policies = await readPolicies();
      publish(ctx, results, policies);
      const action = await applyHeal(results, "auto-heal");
      const nextPolicies = await readPolicies();
      publish(ctx, results, nextPolicies);
      const restoredNote = restored.length > 0 ? ` Restored ${restored.join(", ")}.` : "";
      if (action.changed.length > 0) {
        ctx.ui.notify(
          `Gemini route stall (${trigger.slice(0, 80)}). Temporarily excluded ${action.changed.join(", ")}.${restoredNote} Run /gemini-heal to reload this session, or start /new.`,
          "warning",
        );
      } else {
        ctx.ui.notify(
          `Gemini route stall (${trigger.slice(0, 80)}); ${action.reason}. No new exclusion.${restoredNote}`,
          "info",
        );
      }
    } catch (error) {
      ctx.ui.notify(`Gemini auto-heal failed: ${short(error)}`, "error");
    } finally {
      running = false;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.agent.kind !== "main" || ctx.mode !== "tui") return;
    recordHistory([{ at: Date.now(), kind: "session_start", detail: "tui" }]);
    if (!widgetEnabled()) return;
    ctx.ui.setStatus("gemini-health", "Gemini 3.8: checking…");
    ctx.ui.setWidget("gemini-health", ["Gemini health: checking…"], {
      placement: "belowEditor",
    });
    ctx.setTimeout(() => {
      void refresh(ctx).catch(() => {});
    }, 1_500);
  });

  pi.on("session_shutdown", () => {
    closeHistory();
  });
  pi.on("agent_end", (event, ctx) => {
    if (ctx.agent.kind !== "main") return;
    const messages = (event as { messages?: unknown[] }).messages ?? [];
    const last = messages[messages.length - 1] as
      | { role?: string; stopReason?: string; errorMessage?: string; error?: string }
      | undefined;
    if (last?.role !== "assistant" || last.stopReason !== "error") return;

    const current = ctx.models.current();
    if (
      !current ||
      current.provider !== PROVIDER ||
      !String(current.id).startsWith("gemini-3.8-flash")
    ) {
      return;
    }

    const text = String(last.errorMessage ?? last.error ?? "");
    if (!/abort|timeout|timed out|503|UNAVAILABLE|capacity|closed|reset/i.test(text)) {
      return;
    }
    if (Date.now() - lastAutoHeal < AUTO_HEAL_COOLDOWN_MS) return;
    lastAutoHeal = Date.now();
    void autoHeal(ctx, text).catch(() => {});
  });

  pi.on("auto_retry_start", (event, ctx) => {
    if (ctx.agent.kind !== "main") return;
    const retryEvent = event as { attempt?: number; errorMessage?: string };
    if (retryEvent.attempt !== 1) return;
    const current = ctx.models.current();
    if (
      !current ||
      current.provider !== PROVIDER ||
      !String(current.id).startsWith("gemini-3.8-flash")
    ) {
      return;
    }
    const text = String(retryEvent.errorMessage ?? "");
    if (!/abort|timeout|timed out|503|UNAVAILABLE|capacity|closed|reset/i.test(text)) {
      return;
    }
    if (Date.now() - lastAutoHeal < AUTO_HEAL_COOLDOWN_MS) return;
    lastAutoHeal = Date.now();
    void autoHeal(ctx, text).catch(() => {});
  });

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
      await refresh(ctx, false);
    },
  });

  pi.registerCommand("gemini-health", {
    description: "Probe every Google Antigravity account for gemini-3.8-flash route hangs",
    handler: async (args, ctx) => {
      const confirm = /--confirm\b/.test(args);
      if (running) {
        ctx.ui.notify("Gemini health check already running", "info");
        return;
      }
      running = true;
      try {
        const results = await checkAll(confirm);
        recordHealth(results);
        const restored = await maybeRestoreManaged();
        const policies = await readPolicies();
        publish(ctx, results, policies);
        const text = table(results, policies);
        if (ctx.mode !== "tui") console.log(text);
        pi.sendMessage(
          {
            customType: "gemini-health",
            content: `${text}${
              restored.length > 0
                ? `\n\nRestored after ${RESTORE_STREAK} healthy checks: ${restored.join(", ")}`
                : ""
            }`,
            display: true,
            attribution: "agent",
          },
          { triggerTurn: false },
        );
        ctx.ui.notify(
          `${summary(results)}${restored.length > 0 ? ` · restored ${restored.join(", ")}` : ""}`,
          results.every((r) => r.status === "ok") ? "info" : "warning",
        );
      } catch (error) {
        ctx.ui.notify(`Gemini health check failed: ${short(error)}`, "error");
      } finally {
        running = false;
      }
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
      if (running) {
        ctx.ui.notify("A health check or warm-up is already running", "info");
        return;
      }
      running = true;
      try {
        let request: WarmUpRequest;
        if (all) {
          request = { provider: PROVIDER, action: "warm", all: true };
        } else {
          const accounts = await loadAccounts();
          const matches = accounts.filter(
            (a) =>
              a.email.toLowerCase() === needle || a.email.toLowerCase().split("@")[0] === needle,
          );
          if (matches.length === 0) {
            ctx.ui.notify(`No Antigravity account found for "${needle}"`, "warning");
            return;
          }
          if (matches.length > 1) {
            ctx.ui.notify(
              `Multiple accounts match "${needle}": ${matches.map((a) => a.email).join(", ")}. Use full email.`,
              "warning",
            );
            return;
          }
          request = { provider: PROVIDER, action: "warm", account: matches[0].email };
        }

        const run = await runWarmUp(warmUpDeps, request);
        const policies = await readPolicies();
        const snapshotResults = readSnapshot()?.results ?? run.results;
        publish(ctx, snapshotResults, policies);

        if ("all" in request) {
          const nonOkSkipped = run.report.skipped.filter((s) => s.reason === "non-ok").length;
          const cooldownSkipped = run.report.skipped.filter((s) => s.reason === "cooldown").length;
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
      } finally {
        running = false;
      }
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
      if (running) {
        ctx.ui.notify("A health check or warm-up is already running", "info");
        return;
      }
      running = true;
      try {
        const accounts = await loadAccounts();
        const matches = accounts.filter(
          (a) => a.email.toLowerCase() === needle || a.email.toLowerCase().split("@")[0] === needle,
        );
        if (matches.length === 0) {
          ctx.ui.notify(`No Antigravity account found for "${needle}"`, "warning");
          return;
        }
        if (matches.length > 1) {
          ctx.ui.notify(
            `Multiple accounts match "${needle}": ${matches.map((a) => a.email).join(", ")}. Use full email.`,
            "warning",
          );
          return;
        }

        const run = await runWarmUp(warmUpDeps, {
          provider: PROVIDER,
          action: "check",
          account: matches[0].email,
        });

        const policies = await readPolicies();
        const snapshotResults = readSnapshot()?.results ?? run.results;
        publish(ctx, snapshotResults, policies);

        const res = run.report.results[0];
        const statusText = res ? res.status.toUpperCase() : "UNKNOWN";
        const message = `Checked ${matches[0].email}: ${statusText}${res ? ` (${res.ms}ms)` : ""}.`;
        ctx.ui.notify(message, res?.status === "ok" ? "info" : "warning");
      } catch (error) {
        ctx.ui.notify(`Gemini check failed: ${short(error)}`, "error");
      } finally {
        running = false;
      }
    },
  });

  pi.registerCommand("gemini-heal", {
    description: "Temporarily exclude Antigravity accounts whose Gemini 3.8 route is hung",
    handler: async (args, ctx) => {
      const dryRun = /--dry-run\b/.test(args);
      if (running) {
        ctx.ui.notify("Gemini health check already running", "info");
        return;
      }
      running = true;
      try {
        const results = await checkAll(true);
        recordHealth(results);
        const restored = dryRun ? [] : await maybeRestoreManaged();
        const policies = await readPolicies();
        publish(ctx, results, policies);
        if (dryRun) {
          recordHistory([
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
        const action = await applyHeal(results, "heal");
        const nextPolicies = await readPolicies();
        publish(ctx, results, nextPolicies);
        recordHistory([
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
      } finally {
        running = false;
      }
    },
  });

  pi.registerCommand("gemini-restore", {
    description: "Remove only the Antigravity account exclusions added by /gemini-heal",
    handler: async (_args, ctx) => {
      try {
        const removed = await restoreManaged();
        recordHistory([
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
        const policies = await readPoliciesForWrite();
        const matches = policies.filter(
          (policy) =>
            policy?.provider === PROVIDER &&
            typeof policy?.account?.email === "string" &&
            (policy.account.email.toLowerCase() === needle ||
              policy.account.email.toLowerCase().split("@")[0] === needle),
        );
        if (matches.length === 0) {
          ctx.ui.notify(`No exclusion found for ${needle}`, "info");
          return;
        }
        const emails = new Set(
          matches
            .map((policy) => policy.account?.email)
            .filter((email): email is string => typeof email === "string"),
        );
        if (emails.size > 1) {
          ctx.ui.notify(
            `Multiple accounts match "${needle}": ${[...emails].join(", ")}. Use the full email.`,
            "warning",
          );
          return;
        }
        const target = [...emails][0];
        const latest = readSnapshot()?.results.find(
          (result) => result.email.toLowerCase() === target?.toLowerCase(),
        );
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
        if (target) {
          await removeAccountExclusion(target, "gemini-enable");
        }
        const message = `Enabled ${[...emails].join(", ")}`;
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
      const results = await checkAll(params.confirm);
      recordHealth(results);
      const restored = params.heal ? await maybeRestoreManaged() : [];
      const policies = await readPolicies();
      publish(ctx, results, policies);
      let note =
        restored.length > 0
          ? `\nRestored after ${RESTORE_STREAK} healthy checks: ${restored.join(", ")}`
          : "";
      if (params.heal) {
        const action = await applyHeal(results, "tool");
        const nextPolicies = await readPolicies();
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

if (import.meta.main) {
  const json = process.argv.includes("--json");
  const watch = process.argv.includes("--watch");
  const confirm = process.argv.includes("--confirm");
  const warmup = process.argv.includes("--warmup");
  const check = process.argv.includes("--check");

  if (warmup || check) {
    if (warmup && check) {
      console.error("error: --warmup and --check are mutually exclusive");
      process.exit(1);
    }
    if (watch) {
      console.error("error: --watch cannot be used with --warmup or --check");
      process.exit(1);
    }

    const providerArg =
      process.argv.find((a) => a.startsWith("--provider="))?.slice("--provider=".length) ??
      PROVIDER;
    const accountArg = process.argv
      .find((a) => a.startsWith("--account="))
      ?.slice("--account=".length);
    const all = process.argv.includes("--all");

    if (warmup && !all && !accountArg) {
      console.error("error: --warmup requires either --account=<email> or --all");
      process.exit(1);
    }
    if (warmup && all && accountArg) {
      console.error("error: --all cannot be combined with --account");
      process.exit(1);
    }
    if (check && !accountArg) {
      console.error("error: --check requires --account=<email>");
      process.exit(1);
    }
    if (check && all) {
      console.error("error: --check does not support --all");
      process.exit(1);
    }

    const request: WarmUpRequest = check
      ? { provider: providerArg, action: "check", account: accountArg ?? "" }
      : all
        ? { provider: providerArg, action: "warm", all: true }
        : { provider: providerArg, action: "warm", account: accountArg ?? "" };

    try {
      const run = await runWarmUp(warmUpDeps, request);
      if (json) {
        console.log(JSON.stringify(run.report, null, 2));
      } else {
        const warmedCount = run.report.results.length;
        const skippedCount = run.report.skipped.length;
        const verb = run.report.action === "warm" ? "Warmed" : "Checked";
        console.log(
          `${verb} ${warmedCount} account(s)${skippedCount > 0 ? ` · skipped ${skippedCount}` : ""}`,
        );
        for (const res of run.report.results) {
          console.log(`  ${res.status.toUpperCase().padEnd(5)} ${res.account} (${res.ms}ms)`);
        }
        for (const skip of run.report.skipped) {
          console.log(`  SKIP  ${skip.account} (${skip.reason})`);
        }
      }
      process.exit(0);
    } catch (error) {
      console.error(`error: ${short(error)}`);
      process.exit(1);
    }
  }

  const intervalArg = process.argv.find((arg) => arg.startsWith("--interval="));
  const interval = Math.max(10, Number(intervalArg?.slice("--interval=".length) ?? 60) || 60);

  const runOnce = async (): Promise<boolean> => {
    const results = await checkAll(confirm);
    recordHealth(results);
    const restored = await maybeRestoreManaged();
    const policies = await readPolicies();
    if (json) {
      console.log(JSON.stringify({ results, policies, restored }, null, 2));
    } else {
      if (watch && process.stdout.isTTY) console.clear();
      console.log(table(results, policies));
      if (restored.length > 0) {
        console.log(`\nRestored after ${RESTORE_STREAK} healthy checks: ${restored.join(", ")}`);
      }
      if (watch) console.log(`\nNext check in ${interval}s · Ctrl+C to stop`);
    }
    return results.every((result) => result.status === "ok");
  };

  if (!watch) {
    process.exit((await runOnce()) ? 0 : 1);
  }

  process.on("SIGINT", () => process.exit(0));
  process.on("exit", () => closeHistory());
  for (;;) {
    await runOnce();
    await sleep(interval * 1000);
  }
}
