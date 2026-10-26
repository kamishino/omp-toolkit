import path from "node:path";

export * from "./build/build-tray-icons";

import { buildTrayIcons } from "./build/build-tray-icons";

if (import.meta.main) {
  const target = process.argv[2] ?? path.resolve(import.meta.dir, "../apps/desktop/dist/assets");
  buildTrayIcons(target);
  console.log(`Generated tray and app icons in ${target}`);
}
