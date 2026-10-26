import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDesktopShortcut,
  generateLinuxDesktopEntry,
  generateMacCommandScript,
  resolveDesktopDir,
} from "./create-desktop-shortcut";

describe("cross-platform desktop shortcut generator", () => {
  test("resolveDesktopDir resolves user Desktop folder", () => {
    const customHome = path.join("custom", "home");
    expect(resolveDesktopDir(customHome)).toBe(path.join("custom", "home", "Desktop"));
  });

  test("generateLinuxDesktopEntry generates valid Freedesktop INI content", () => {
    const entry = generateLinuxDesktopEntry({
      repoRoot: "/opt/omp-toolkit",
      launcherPath: "/opt/omp-toolkit/omp-widget.sh",
      iconPath: "/opt/omp-toolkit/icon.png",
    });

    expect(entry).toContain("[Desktop Entry]");
    expect(entry).toContain("Type=Application");
    expect(entry).toContain("Name=OMP Provider Usage");
    expect(entry).toContain('Exec="/opt/omp-toolkit/omp-widget.sh"');
    expect(entry).toContain("Path=/opt/omp-toolkit");
    expect(entry).toContain("Terminal=false");
    expect(entry).toContain("Categories=Utility;System;");
  });

  test("generateMacCommandScript generates valid shell launcher", () => {
    const script = generateMacCommandScript({
      repoRoot: "/Users/test/omp-toolkit",
      launcherPath: "/Users/test/omp-toolkit/omp-widget.sh",
    });

    expect(script).toContain("#!/bin/sh");
    expect(script).toContain('cd "/Users/test/omp-toolkit"');
    expect(script).toContain('exec "/Users/test/omp-toolkit/omp-widget.sh"');
  });

  test("supports dryRun on all platforms without filesystem mutation", () => {
    const fakeHome = path.join(os.tmpdir(), "nonexistent-fake-home");

    const winRes = createDesktopShortcut({
      platform: "win32",
      home: fakeHome,
      dryRun: true,
    });
    expect(winRes.type).toBe("lnk");
    expect(winRes.path.endsWith("OMP Provider Usage.lnk")).toBe(true);

    const macRes = createDesktopShortcut({
      platform: "darwin",
      home: fakeHome,
      dryRun: true,
    });
    expect(macRes.type).toBe("app");
    expect(macRes.path.endsWith("OMP Provider Usage.app")).toBe(true);

    const linuxRes = createDesktopShortcut({
      platform: "linux",
      home: fakeHome,
      dryRun: true,
    });
    expect(linuxRes.type).toBe("desktop");
    expect(linuxRes.path.endsWith("omp-provider-usage.desktop")).toBe(true);
  });

  test("creates Linux desktop file with executable permissions in target directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-shortcut-test-"));
    const fakeDesktop = path.join(tempDir, "Desktop");
    fs.mkdirSync(fakeDesktop, { recursive: true });

    try {
      const res = createDesktopShortcut({
        platform: "linux",
        home: tempDir,
        repoRoot: path.resolve(import.meta.dir, ".."),
        silent: true,
      });

      expect(res.type).toBe("desktop");
      expect(fs.existsSync(res.path)).toBe(true);
      const content = fs.readFileSync(res.path, "utf8");
      expect(content).toContain("[Desktop Entry]");
      expect(content).toContain("Name=OMP Provider Usage");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
