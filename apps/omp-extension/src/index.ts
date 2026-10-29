/**
 * Gemini route health widget, account circuit breaker, and wire normalizer.
 *
 * Commands:
 *   /gemini-health-widget [on|off]  toggle TUI health widget
 *   /gemini-health [--confirm]      probe all accounts and update widget
 *   /gemini-warmup <email>|--all    warm up eligible Antigravity accounts
 *   /gemini-check <email>           probe single account route (unhang check)
 *   /gemini-heal [--dry-run]        probe + reserve hung accounts (temporary)
 *   /gemini-restore                 remove exclusions added by heal
 *   /gemini-enable <email> [--force] explicitly remove an account exclusion
 *   /gemini-auto-restore [<email>|off <email>] manage manual exclusion streak restore
 *   /template <save|apply|list|show|delete> global AGENTS.md + RULES.md bundles
 *
 * Tool: gemini_health { heal?: boolean, confirm?: boolean }
 * Provider: deepseek (usage and balance telemetry)
 * CLI: --warmup, --check, --watch, --json
 */

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { deepSeekUsageReport, resolveAgentDir } from "@omp-toolkit/core";
import { AutoHealCoordinator } from "./auto-heal";
import { runExtensionCli } from "./cli";
import { registerCommandsAndTools } from "./commands";
import { PROVIDER } from "./config";
import { registerGeminiNormalizer } from "./gemini-normalizer";
import { healthManager } from "./health-manager";
import { registerTemplateCommands } from "./template-commands";
import type { WarmUpAdapter, WarmUpDependencies } from "./warmup";

function reloadIfAvailable(ctx: ExtensionContext): Promise<void> | undefined {
  if (ctx && typeof ctx === "object" && "reload" in ctx && typeof ctx.reload === "function") {
    return (ctx.reload as () => Promise<void>)();
  }
  return undefined;
}

const antigravityAdapter: WarmUpAdapter = {
  provider: PROVIDER,
  loadAccounts: () => healthManager.loadAccounts(),
  probe: (a) => healthManager.probe(a),
};
const warmUpAdapters = new Map<string, WarmUpAdapter>([[PROVIDER, antigravityAdapter]]);
const warmUpDeps: WarmUpDependencies = {
  agentDir: resolveAgentDir(),
  adapters: warmUpAdapters,
  readSnapshot: () => healthManager.readSnapshot(),
  recordHealth: (r, o) => healthManager.recordHealth(r, o),
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

  const coordinator = new AutoHealCoordinator();
  coordinator.registerEvents(pi);

  registerCommandsAndTools(pi, {
    warmUpDeps,
    coordinator,
    reloadIfAvailable,
  });

  registerTemplateCommands(pi, {
    reloadIfAvailable,
  });
}

if (import.meta.main) {
  void runExtensionCli(process.argv, warmUpDeps);
}
