export * from "./monitor/monitor";

import { runMonitor } from "./monitor/monitor";

if (import.meta.main) {
  runMonitor();
}
