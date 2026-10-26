import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { buildTrayIcons } from "./build-tray-icons";

const root = path.resolve(import.meta.dir, "..");
const appDir = path.join(root, "apps", "desktop");
const distDir = path.join(appDir, "dist");

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

export async function buildTargets(): Promise<void> {
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
}

export async function buildDesktop(): Promise<void> {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  const mainBuild = await Bun.build({
    entrypoints: [path.join(appDir, "src", "main.ts")],
    outdir: distDir,
    target: "node",
    format: "cjs",
    external: ["electron"],
  });
  if (!mainBuild.success) {
    for (const log of mainBuild.logs) console.error(log);
    throw new Error("Failed to build apps/desktop/src/main.ts");
  }
  fs.renameSync(path.join(distDir, "main.js"), path.join(distDir, "main.cjs"));

  const preloadBuild = await Bun.build({
    entrypoints: [path.join(appDir, "src", "preload.ts")],
    outdir: distDir,
    target: "node",
    format: "cjs",
    external: ["electron"],
  });
  if (!preloadBuild.success) {
    for (const log of preloadBuild.logs) console.error(log);
    throw new Error("Failed to build apps/desktop/src/preload.ts");
  }
  fs.renameSync(path.join(distDir, "preload.js"), path.join(distDir, "preload.cjs"));

  const rendererBuild = await Bun.build({
    entrypoints: [path.join(appDir, "src", "renderer", "renderer.ts")],
    outdir: distDir,
    target: "browser",
    format: "esm",
  });
  if (!rendererBuild.success) {
    for (const log of rendererBuild.logs) console.error(log);
    throw new Error("Failed to build apps/desktop/src/renderer/renderer.ts");
  }

  fs.copyFileSync(
    path.join(appDir, "src", "renderer", "index.html"),
    path.join(distDir, "index.html"),
  );
  fs.copyFileSync(
    path.join(appDir, "src", "renderer", "styles.css"),
    path.join(distDir, "styles.css"),
  );

  const assetsDir = path.join(distDir, "assets");
  const srcProvidersDir = path.join(appDir, "src", "renderer", "assets", "providers");
  const distProvidersDir = path.join(assetsDir, "providers");
  fs.mkdirSync(distProvidersDir, { recursive: true });
  fs.cpSync(srcProvidersDir, distProvidersDir, { recursive: true });

  buildTrayIcons(assetsDir);

  const require = createRequire(import.meta.url);
  const interDir = path.dirname(require.resolve("@fontsource-variable/inter/package.json"));
  const jbDir = path.dirname(require.resolve("@fontsource-variable/jetbrains-mono/package.json"));
  const fontsDir = path.join(assetsDir, "fonts");
  fs.mkdirSync(fontsDir, { recursive: true });
  fs.copyFileSync(
    path.join(interDir, "files", "inter-latin-wght-normal.woff2"),
    path.join(fontsDir, "inter-latin-wght-normal.woff2"),
  );
  fs.copyFileSync(
    path.join(jbDir, "files", "jetbrains-mono-latin-wght-normal.woff2"),
    path.join(fontsDir, "jetbrains-mono-latin-wght-normal.woff2"),
  );

  // Verification assertions
  const requiredFiles = [
    path.join(distDir, "main.cjs"),
    path.join(distDir, "preload.cjs"),
    path.join(distDir, "renderer.js"),
    path.join(distDir, "index.html"),
    path.join(distDir, "styles.css"),
    path.join(assetsDir, "app-icon.png"),
    path.join(assetsDir, "providers", "google-gemini.svg"),
    path.join(assetsDir, "providers", "openai-light.svg"),
    path.join(assetsDir, "providers", "openai-dark.svg"),
    path.join(assetsDir, "providers", "deepseek.svg"),
    path.join(fontsDir, "inter-latin-wght-normal.woff2"),
    path.join(fontsDir, "jetbrains-mono-latin-wght-normal.woff2"),
  ];

  const modes = ["light", "dark"] as const;
  const levels = ["ok", "warn", "hot", "critical", "unknown"] as const;
  for (const mode of modes) {
    for (const level of levels) {
      requiredFiles.push(path.join(assetsDir, "tray", `tray-${mode}-${level}.png`));
      requiredFiles.push(path.join(assetsDir, "tray", `tray-${mode}-${level}@2x.png`));
    }
  }

  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      throw new Error(`missing required desktop build artifact: ${file}`);
    }
  }

  console.log("built apps/desktop/dist");
}

export async function buildAll(options: { desktop?: boolean } = {}): Promise<void> {
  await buildTargets();
  if (options.desktop !== false) {
    await buildDesktop();
  }
}

if (import.meta.main) {
  const desktopOnly = process.argv.includes("--desktop");
  const noDesktop = process.argv.includes("--no-desktop") || process.argv.includes("--targets");

  if (desktopOnly) {
    await buildDesktop();
  } else {
    await buildAll({ desktop: !noDesktop });
  }
}
