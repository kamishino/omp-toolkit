export * from "./reliability/reliability-report";

import { generateReport } from "./reliability/reliability-report";

if (import.meta.main) {
  generateReport();
}
