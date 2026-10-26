import type { WarmUpRequest } from "@omp-toolkit/core";
import {
  checkAll,
  maybeRestoreManaged,
  PROVIDER,
  RESTORE_STREAK,
  readPolicies,
  recordHealth,
  short,
  sleep,
} from "./circuit-breaker";
import { closeHistory } from "./history";
import { runWarmUp, type WarmUpDependencies } from "./warmup";
import { table } from "./widget";

export async function runExtensionCli(
  argv: string[],
  warmUpDeps: WarmUpDependencies,
): Promise<void> {
  const json = argv.includes("--json");
  const watch = argv.includes("--watch");
  const confirm = argv.includes("--confirm");
  const warmup = argv.includes("--warmup");
  const check = argv.includes("--check");

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
      argv.find((a) => a.startsWith("--provider="))?.slice("--provider=".length) ?? PROVIDER;
    const accountArg = argv.find((a) => a.startsWith("--account="))?.slice("--account=".length);
    const all = argv.includes("--all");

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

  const intervalArg = argv.find((arg) => arg.startsWith("--interval="));
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
