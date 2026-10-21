import { type HealthResult, limitFor, type ProviderSection, sectionsFor } from "@omp-toolkit/core";
import { renderProviderUsage } from "@omp-toolkit/tui";
import { writeHeartbeat } from "./heartbeat";
import { fetchUsage, readSnapshot } from "./usage";

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function jsonSections(sections: ProviderSection[]) {
  return sections.map((section) => ({
    provider: section.provider,
    accounts: section.reports.length,
    columns: section.columns,
    rows: section.rows.map((row) => ({
      account: row.account,
      maxUsed: row.max,
      health: row.health?.status ?? null,
      limits: section.columns.map((column) => ({
        label: column.label,
        ...limitFor(row.report, column),
      })),
    })),
  }));
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const watch = process.argv.includes("--watch");
  const showHealth = process.argv.includes("--health");
  const intervalArg = process.argv.find((arg) => arg.startsWith("--interval="));
  const interval = Math.max(10, Number(intervalArg?.slice("--interval=".length) ?? 300) || 300);

  const runOnce = async (): Promise<void> => {
    const reports = await fetchUsage();
    try {
      writeHeartbeat();
    } catch {
      // The monitor stays usable; the report shows a stale heartbeat.
    }
    const snapshot = showHealth ? readSnapshot() : null;
    const health = new Map<string, HealthResult>(
      (snapshot?.results ?? []).map((result) => [result.email, result]),
    );
    const sections = sectionsFor(reports, health);

    if (json) {
      console.log(
        JSON.stringify(
          {
            fetchedAt: Date.now(),
            providers: jsonSections(sections),
            ...(showHealth ? { health: snapshot } : {}),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (watch && process.stdout.isTTY) console.clear();
    console.log(
      renderProviderUsage(sections, {
        interval,
        watch,
        showHealth,
        checkedAt: snapshot?.checkedAt,
      }),
    );
    if (watch) console.log();
  };

  if (!watch) {
    await runOnce();
    return;
  }

  process.on("SIGINT", () => process.exit(0));
  for (;;) {
    try {
      await runOnce();
    } catch (error) {
      console.error(
        `OMP Provider Usage: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await sleep(interval * 1000);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
