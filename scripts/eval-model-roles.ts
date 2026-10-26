export * from "./eval/eval-model-roles";

import { main } from "./eval/eval-model-roles";

if (import.meta.main) {
  void main();
}
