import { parseMonitorCliConfig } from "./config";
import { MonitorRunner } from "./monitor-runner";

async function main(): Promise<void> {
  const config = parseMonitorCliConfig();
  const runner = new MonitorRunner();
  await runner.run(config);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
