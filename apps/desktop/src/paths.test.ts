import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  errorLogPath,
  findBun,
  panelPaths,
  resolveCheckout,
  resolveHealthScript,
  resolveMonitorScript,
} from "./paths";

describe("paths helpers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-desktop-paths-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("findBun honors BUN_BIN override", () => {
    const res = findBun({ BUN_BIN: "/custom/bun" }, "linux", tmpDir);
    expect(res).toBe("/custom/bun");
  });

  test("findBun finds bun in PATH", () => {
    const binDir = path.join(tmpDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const bunName = process.platform === "win32" ? "bun.exe" : "bun";
    const bunFile = path.join(binDir, bunName);
    fs.writeFileSync(bunFile, "#!/bin/sh\n", "utf8");
    if (process.platform !== "win32") {
      // which.sync requires the X_OK bit on POSIX.
      fs.chmodSync(bunFile, 0o755);
    }

    const res = findBun({ PATH: binDir }, process.platform, tmpDir);
    expect(res?.toLowerCase()).toBe(bunFile.toLowerCase());
  });

  test("findBun finds fallback in home directory", () => {
    const bunDir = path.join(tmpDir, ".bun", "bin");
    fs.mkdirSync(bunDir, { recursive: true });
    const bunName = process.platform === "win32" ? "bun.exe" : "bun";
    const bunFile = path.join(bunDir, bunName);
    fs.writeFileSync(bunFile, "#!/bin/sh\n", "utf8");

    const res = findBun({ PATH: "" }, process.platform, tmpDir);
    expect(res).toBe(bunFile);
  });
  test("findBun returns null if bun is nowhere", () => {
    const res = findBun({ PATH: "" }, "linux", tmpDir);
    expect(res).toBeNull();
  });

  test("resolveMonitorScript respects precedence: installed > dist > source", () => {
    const agentScripts = path.join(tmpDir, ".omp", "agent", "scripts");
    fs.mkdirSync(agentScripts, { recursive: true });
    const installed = path.join(agentScripts, "omp-provider-usage.js");
    fs.writeFileSync(installed, "// installed\n");

    const checkoutRoot = path.join(tmpDir, "checkout");
    const distDir = path.join(checkoutRoot, "apps", "provider-usage", "dist");
    fs.mkdirSync(distDir, { recursive: true });
    const distFile = path.join(distDir, "index.js");
    fs.writeFileSync(distFile, "// dist\n");

    const srcDir = path.join(checkoutRoot, "apps", "provider-usage", "src");
    fs.mkdirSync(srcDir, { recursive: true });
    const srcFile = path.join(srcDir, "index.ts");
    fs.writeFileSync(srcFile, "// src\n");

    // All 3 exist -> installed wins
    expect(
      resolveMonitorScript(
        { PI_CODING_AGENT_DIR: path.join(tmpDir, ".omp", "agent") },
        checkoutRoot,
        tmpDir,
      ),
    ).toBe(installed);

    // Remove installed -> dist wins
    fs.unlinkSync(installed);
    expect(
      resolveMonitorScript(
        { PI_CODING_AGENT_DIR: path.join(tmpDir, ".omp", "agent") },
        checkoutRoot,
        tmpDir,
      ),
    ).toBe(distFile);

    // Remove dist -> src wins
    fs.unlinkSync(distFile);
    expect(
      resolveMonitorScript(
        { PI_CODING_AGENT_DIR: path.join(tmpDir, ".omp", "agent") },
        checkoutRoot,
        tmpDir,
      ),
    ).toBe(srcFile);

    // Remove src -> null
    fs.unlinkSync(srcFile);
    expect(
      resolveMonitorScript(
        { PI_CODING_AGENT_DIR: path.join(tmpDir, ".omp", "agent") },
        checkoutRoot,
        tmpDir,
      ),
    ).toBeNull();
  });
  test("resolveHealthScript respects precedence: dist > installed > source", () => {
    const extensionsDir = path.join(tmpDir, ".omp", "agent", "extensions");
    fs.mkdirSync(extensionsDir, { recursive: true });
    const installed = path.join(extensionsDir, "gemini-health.js");
    fs.writeFileSync(installed, "// installed\n");

    const checkoutRoot = path.join(tmpDir, "checkout");
    const distDir = path.join(checkoutRoot, "apps", "omp-extension", "dist");
    fs.mkdirSync(distDir, { recursive: true });
    const distFile = path.join(distDir, "index.js");
    fs.writeFileSync(distFile, "// dist\n");

    const srcDir = path.join(checkoutRoot, "apps", "omp-extension", "src");
    fs.mkdirSync(srcDir, { recursive: true });
    const srcFile = path.join(srcDir, "index.ts");
    fs.writeFileSync(srcFile, "// src\n");

    // All 3 exist -> dist wins
    expect(
      resolveHealthScript(
        { PI_CODING_AGENT_DIR: path.join(tmpDir, ".omp", "agent") },
        checkoutRoot,
        tmpDir,
      ),
    ).toBe(distFile);

    // Remove dist -> installed wins
    fs.unlinkSync(distFile);
    expect(
      resolveHealthScript(
        { PI_CODING_AGENT_DIR: path.join(tmpDir, ".omp", "agent") },
        checkoutRoot,
        tmpDir,
      ),
    ).toBe(installed);

    // Remove installed -> src wins
    fs.unlinkSync(installed);
    expect(
      resolveHealthScript(
        { PI_CODING_AGENT_DIR: path.join(tmpDir, ".omp", "agent") },
        checkoutRoot,
        tmpDir,
      ),
    ).toBe(srcFile);

    // Remove src -> null
    fs.unlinkSync(srcFile);
    expect(
      resolveHealthScript(
        { PI_CODING_AGENT_DIR: path.join(tmpDir, ".omp", "agent") },
        checkoutRoot,
        tmpDir,
      ),
    ).toBeNull();
  });

  test("resolveCheckout respects precedence and requires scripts/orca-monitor.ts", () => {
    const custom = path.join(tmpDir, "custom-checkout");
    fs.mkdirSync(path.join(custom, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(custom, "scripts", "orca-monitor.ts"), "// ok\n");

    const res = resolveCheckout({ OMP_TOOLKIT_HOME: custom }, tmpDir, tmpDir);
    expect(res).toBe(path.resolve(custom));
  });

  test("errorLogPath returns path under agent directory", () => {
    const res = errorLogPath({ PI_CODING_AGENT_DIR: "/test/agent" }, tmpDir);
    expect(res).toBe(path.join("/test/agent", "desktop-widget-error.log"));
  });
  test("panelPaths resolves HTML and preload under dist, not src", () => {
    const appPath = path.join(tmpDir, "apps", "desktop");
    const result = panelPaths(appPath);
    expect(result.distDir).toBe(path.join(appPath, "dist"));
    expect(result.html).toBe(path.join(appPath, "dist", "index.html"));
    expect(result.preload).toBe(path.join(appPath, "dist", "preload.cjs"));
    expect(result.html).not.toContain(`${path.sep}src${path.sep}`);
  });
});
