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
import { deepSeekUsageReport } from "@omp-toolkit/core";
import { AutoHealCoordinator } from "./auto-heal";
import {
  agentDir,
  applyHeal,
  checkAll,
  loadAccounts,
  maybeRestoreManaged,
  PROVIDER,
  policyStore,
  probe,
  probeClient,
  readSnapshot,
  recordHealth,
  restoreManaged,
} from "./circuit-breaker";
import { runExtensionCli } from "./cli";
import { registerCommandsAndTools } from "./commands";
import { registerGeminiNormalizer } from "./gemini-normalizer";
import type { WarmUpAdapter, WarmUpDependencies } from "./warmup";

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
  if (ctx && typeof ctx === "object" && "reload" in ctx && typeof ctx.reload === "function") {
    return (ctx.reload as () => Promise<void>)();
  }
  return undefined;
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

  const coordinator = new AutoHealCoordinator();
  coordinator.registerEvents(pi);

  registerCommandsAndTools(pi, {
    warmUpDeps,
    coordinator,
    reloadIfAvailable,
  });
}

if (import.meta.main) {
  void runExtensionCli(process.argv, warmUpDeps);
}
