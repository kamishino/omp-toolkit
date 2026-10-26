import type { Dashboard, WarmUpRequest } from "@omp-toolkit/core";
import { supportsWarmUp, warmUpEligibility } from "@omp-toolkit/core";
import type { BrowserWindow, MessageBoxOptions } from "electron";
import { dialog } from "electron";
import { findBun, resolveHealthScript } from "./paths";
import { executeWarmUp } from "./warmup";

export interface WarmUpHandlerContext {
  panelWindow: BrowserWindow | null;
  lastDashboard: Dashboard | null;
  checkoutRoot: string;
  isWarmUpRunning: boolean;
  isQuitting: boolean;
  onWarmUpStart: (message: string) => void;
  onWarmUpEnd: (finalMessage?: string) => void;
  onRefreshRequested: () => Promise<void>;
  env?: Record<string, string | undefined>;
}

export async function handleWarmUpRequest(
  request: WarmUpRequest,
  ctx: WarmUpHandlerContext,
): Promise<void> {
  const {
    panelWindow,
    lastDashboard,
    checkoutRoot,
    isWarmUpRunning,
    isQuitting,
    onWarmUpStart,
    onWarmUpEnd,
    onRefreshRequested,
    env = process.env,
  } = ctx;

  if (isWarmUpRunning || isQuitting) return;

  if (!lastDashboard) {
    dialog.showErrorBox(
      "OMP Provider Usage",
      "No usage data loaded yet. Please wait for initial refresh.",
    );
    return;
  }

  const provider = lastDashboard.providers.find((p) => p.id === request.provider);
  if (!provider || !supportsWarmUp(provider.id)) {
    dialog.showErrorBox(
      "OMP Provider Usage",
      `Warm-up is not supported for provider "${request.provider}".`,
    );
    return;
  }

  if ("all" in request) {
    if (request.action !== "warm") return;
    const eligibleCount = provider.rows.filter(
      (r) => warmUpEligibility(provider.id, r.health) === "warm",
    ).length;
    const skippedNonOk = provider.rows.length - eligibleCount;

    if (eligibleCount === 0) {
      if (panelWindow) {
        await dialog.showMessageBox(panelWindow, {
          type: "info",
          title: "Warm up all",
          message: "No eligible accounts to warm up.",
          detail: `${skippedNonOk} non-OK account(s) skipped; use Check per account to verify recovery.`,
        });
      }
      return;
    }

    const staleNote =
      lastDashboard.health?.stale === true || !lastDashboard.health?.checkedAt
        ? " Health data is stale or missing; known non-OK accounts are still skipped."
        : "";

    const boxOpts: MessageBoxOptions = {
      type: "question",
      buttons: ["Cancel", "Warm up"],
      defaultId: 1,
      cancelId: 0,
      title: "Warm up all",
      message: `Warm up ${eligibleCount} account(s) in ${provider.name}?`,
      detail: `${skippedNonOk} non-OK account(s) will be skipped.${staleNote} Each account receives one minimal model request.`,
    };

    const { response } = panelWindow
      ? await dialog.showMessageBox(panelWindow, boxOpts)
      : await dialog.showMessageBox(boxOpts);

    if (response !== 1) return;
  } else {
    const row = provider.rows.find((r) => r.account === request.account);
    if (!row) {
      dialog.showErrorBox(
        "OMP Provider Usage",
        `Account "${request.account}" not found in current dashboard.`,
      );
      return;
    }
    const eligibility = warmUpEligibility(provider.id, row.health);
    if (request.action === "warm" && eligibility !== "warm") {
      dialog.showErrorBox(
        "OMP Provider Usage",
        `Account "${row.displayAccount}" is ${row.route.text}; use Check instead.`,
      );
      return;
    }
    if (request.action === "check" && eligibility !== "check") {
      dialog.showErrorBox(
        "OMP Provider Usage",
        `Account "${row.displayAccount}" is already OK; use Warm up instead.`,
      );
      return;
    }
  }

  const bun = findBun();
  const healthScript = resolveHealthScript(env, checkoutRoot);
  if (!bun) {
    dialog.showErrorBox("OMP Provider Usage", "Bun not found. Install Bun or set BUN_BIN.");
    return;
  }
  if (!healthScript) {
    dialog.showErrorBox(
      "OMP Provider Usage",
      'gemini-health.js was not found. Run "bun run install:omp".',
    );
    return;
  }

  onWarmUpStart("Warming up...");

  let finalMessage: string | undefined;
  try {
    const result = await executeWarmUp({ bun, script: healthScript }, request);
    if (result.success) {
      finalMessage = result.message;
      await onRefreshRequested();
    } else {
      finalMessage = `Warm-up failed: ${result.message}`;
      if (panelWindow) {
        await dialog.showMessageBox(panelWindow, {
          type: "error",
          title: "OMP Provider Usage",
          message: "Warm-up failed",
          detail: result.message,
        });
      } else {
        dialog.showErrorBox("OMP Provider Usage", result.message);
      }
    }
  } finally {
    onWarmUpEnd(finalMessage);
  }
}
