export * from "./tokens/check-tokens";

import { checkTokens } from "./tokens/check-tokens";

if (import.meta.main) {
  if (!checkTokens()) {
    process.exit(1);
  }
}
