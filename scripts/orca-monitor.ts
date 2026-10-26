export * from "./monitor/orca-monitor";

import { launchOrFocusMonitor } from "./monitor/orca-monitor";

if (import.meta.main) {
  launchOrFocusMonitor();
}
