import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const targets = [
  {
    name: "omp-extension",
    entry: path.join(root, "apps/omp-extension/src/index.ts"),
    outdir: path.join(root, "apps/omp-extension/dist"),
  },
  {
    name: "provider-usage",
    entry: path.join(root, "apps/provider-usage/src/index.ts"),
    outdir: path.join(root, "apps/provider-usage/dist"),
  },
];

for (const target of targets) {
  fs.rmSync(target.outdir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [target.entry],
    outdir: target.outdir,
    target: "bun",
    format: "esm",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  console.log(`built ${path.relative(root, target.outdir)}/index.js`);
}
