import path from "node:path";
import { type Dashboard, formatAge, money } from "@omp-toolkit/core";
import { fetchDashboard } from "./data";
import { findBun, resolveMonitorScript } from "./paths";

async function main(): Promise<void> {
  const checkoutRoot = path.resolve(import.meta.dir, "../../..");
  const bun = findBun();
  const script = resolveMonitorScript(process.env, checkoutRoot);

  if (!bun) {
    console.error("Bun was not found. Install Bun or set BUN_BIN.");
    process.exit(1);
    return;
  }

  if (!script) {
    console.error('omp-provider-usage.js was not found. Run "bun run install:omp".');
    process.exit(1);
    return;
  }

  let dashboard: Dashboard;
  try {
    dashboard = await fetchDashboard({ bun, script });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }
  const s = dashboard.summary;
  console.log("OMP Provider Usage");
  console.log(
    `providers: ${s.providers} · accounts: ${s.accounts} · ≥${Math.round(s.aboveThreshold * 100)}%: ${s.above80} · maxed: ${s.maxed}`,
  );

  if (s.tightest) {
    console.log(
      `tightest: ${s.tightest.provider}:${s.tightest.account} ${Math.round(s.tightest.usedFraction * 100)}%`,
    );
  } else {
    console.log("tightest: no usage data");
  }

  const h = dashboard.health;
  if (!h || h.checkedAt === 0) {
    console.log("health: no snapshot");
  } else {
    const age = formatAge(h.checkedAt, Date.now(), true);
    console.log(`health: ${age}${h.stale ? " (stale)" : ""}`);
  }

  if (dashboard.balance) {
    const b = dashboard.balance;
    const m = money(b.remaining, b.unit);
    console.log(`deepseek: ${m}${b.low ? " (LOW)" : ""}`);
  }
}

void main();
