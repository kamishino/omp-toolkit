import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyTemplate,
  deleteTemplate,
  listTemplates,
  resolveCheckoutRoot,
  saveTemplate,
  showTemplate,
} from "./template-store";

describe("template-store module", () => {
  function createTestHarness() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-tmpl-test-"));
    const agentDir = path.join(root, "agent");
    const checkout = path.join(root, "checkout");
    const templatesDir = path.join(checkout, "templates");

    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(templatesDir, { recursive: true });

    // Create probe in checkout to make it a valid omp-toolkit checkout
    const probe = path.join(checkout, "scripts", "monitor", "orca-monitor.ts");
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, "// probe");

    return {
      root,
      agentDir,
      checkout,
      templatesDir,
      cleanup: () => {
        fs.rmSync(root, { recursive: true, force: true });
      },
    };
  }

  test("saveTemplate saves both files, one-file save, zero-byte file, forced overwrite mirrors live", () => {
    const h = createTestHarness();
    try {
      // 1. No live files => throw
      expect(() => saveTemplate(h.templatesDir, h.agentDir, "work", { force: false })).toThrow(
        "nothing to save",
      );

      // 2. Invalid template name => throw
      expect(() => saveTemplate(h.templatesDir, h.agentDir, "Work!", { force: false })).toThrow(
        "invalid template name",
      );

      // 3. Save with both files present
      fs.writeFileSync(path.join(h.agentDir, "AGENTS.md"), "agents v1\n");
      fs.writeFileSync(path.join(h.agentDir, "RULES.md"), "rules v1\n");
      const res1 = saveTemplate(h.templatesDir, h.agentDir, "work", { force: false });
      expect(res1.name).toBe("work");
      expect(res1.files).toEqual(["AGENTS.md", "RULES.md"]);
      expect(fs.readFileSync(path.join(h.templatesDir, "work", "AGENTS.template.md"), "utf8")).toBe(
        "agents v1\n",
      );
      expect(fs.readFileSync(path.join(h.templatesDir, "work", "RULES.template.md"), "utf8")).toBe(
        "rules v1\n",
      );

      // 4. Overwrite without force => throw
      expect(() => saveTemplate(h.templatesDir, h.agentDir, "work", { force: false })).toThrow(
        "already exists; pass --force to overwrite",
      );

      // 5. Forced overwrite when RULES.md is deleted live (one-file save) => stale RULES.template.md removed
      fs.rmSync(path.join(h.agentDir, "RULES.md"));
      fs.writeFileSync(path.join(h.agentDir, "AGENTS.md"), "agents v2\n");
      const res2 = saveTemplate(h.templatesDir, h.agentDir, "work", { force: true });
      expect(res2.files).toEqual(["AGENTS.md"]);
      expect(fs.readFileSync(path.join(h.templatesDir, "work", "AGENTS.template.md"), "utf8")).toBe(
        "agents v2\n",
      );
      expect(fs.existsSync(path.join(h.templatesDir, "work", "RULES.template.md"))).toBe(false);

      // 6. Zero-byte file copied verbatim
      fs.writeFileSync(path.join(h.agentDir, "RULES.md"), "");
      saveTemplate(h.templatesDir, h.agentDir, "zero-byte", { force: false });
      expect(
        fs.readFileSync(path.join(h.templatesDir, "zero-byte", "RULES.template.md"), "utf8"),
      ).toBe("");
    } finally {
      h.cleanup();
    }
  });

  test("applyTemplate restores mutated content, creates missing, deletes extra with backup", () => {
    const h = createTestHarness();
    try {
      // Setup template: AGENTS.template.md only
      const tmplDir = path.join(h.templatesDir, "minimal");
      fs.mkdirSync(tmplDir, { recursive: true });
      fs.writeFileSync(path.join(tmplDir, "AGENTS.template.md"), "restored agents\n");

      // Live has: mutated AGENTS.md and extra RULES.md
      fs.writeFileSync(path.join(h.agentDir, "AGENTS.md"), "dirty agents\n");
      fs.writeFileSync(path.join(h.agentDir, "RULES.md"), "extra rules\n");

      const fixedTime = new Date("2026-10-28T12:00:00.000Z");
      const applyRes = applyTemplate(h.templatesDir, h.agentDir, "minimal", fixedTime);

      expect(applyRes.name).toBe("minimal");
      expect(applyRes.written).toEqual(["AGENTS.md"]);
      expect(applyRes.deleted).toEqual(["RULES.md"]);
      expect(applyRes.unchanged).toEqual([]);

      // Expected backup dir
      const expectedBackupDir = path.join(
        h.agentDir,
        "backups",
        "templates",
        "2026-10-28T12-00-00-000Z",
      );
      expect(applyRes.backupDir).toBe(expectedBackupDir);
      expect(fs.existsSync(expectedBackupDir)).toBe(true);
      expect(fs.readFileSync(path.join(expectedBackupDir, "AGENTS.md"), "utf8")).toBe(
        "dirty agents\n",
      );
      expect(fs.readFileSync(path.join(expectedBackupDir, "RULES.md"), "utf8")).toBe(
        "extra rules\n",
      );

      // Live files updated: AGENTS restored, RULES deleted
      expect(fs.readFileSync(path.join(h.agentDir, "AGENTS.md"), "utf8")).toBe("restored agents\n");
      expect(fs.existsSync(path.join(h.agentDir, "RULES.md"))).toBe(false);

      // Re-applying identical template reports unchanged, still writes backup
      const applyIdentical = applyTemplate(
        h.templatesDir,
        h.agentDir,
        "minimal",
        new Date("2026-10-28T12:05:00.000Z"),
      );
      expect(applyIdentical.written).toEqual([]);
      expect(applyIdentical.deleted).toEqual([]);
      expect(applyIdentical.unchanged).toEqual(["AGENTS.md", "RULES.md"]);
      expect(applyIdentical.backupDir).toContain("2026-10-28T12-05-00-000Z");

      // Unknown template throws
      expect(() => applyTemplate(h.templatesDir, h.agentDir, "non-existent")).toThrow(
        'template "non-existent" not found',
      );

      // Empty template dir throws
      const emptyDir = path.join(h.templatesDir, "empty");
      fs.mkdirSync(emptyDir, { recursive: true });
      expect(() => applyTemplate(h.templatesDir, h.agentDir, "empty")).toThrow(
        "contains neither AGENTS.template.md nor RULES.template.md",
      );
    } finally {
      h.cleanup();
    }
  });

  test("applyTemplate rolls back on write error mid-apply", () => {
    const h = createTestHarness();
    try {
      // Template has both AGENTS.template.md and RULES.template.md
      const tmplDir = path.join(h.templatesDir, "both");
      fs.mkdirSync(tmplDir, { recursive: true });
      fs.writeFileSync(path.join(tmplDir, "AGENTS.template.md"), "new agents\n");
      fs.writeFileSync(path.join(tmplDir, "RULES.template.md"), "new rules\n");

      // Live has initial AGENTS.md
      fs.writeFileSync(path.join(h.agentDir, "AGENTS.md"), "original agents\n");

      // Block writing RULES.md by creating a read-only directory at that path
      // On Windows or POSIX, if RULES.md is a directory, writeFileAtomic writing to it will fail!
      fs.mkdirSync(path.join(h.agentDir, "RULES.md"));

      expect(() => applyTemplate(h.templatesDir, h.agentDir, "both")).toThrow("apply failed");

      // Rollback must have restored original AGENTS.md
      expect(fs.readFileSync(path.join(h.agentDir, "AGENTS.md"), "utf8")).toBe("original agents\n");
    } finally {
      h.cleanup();
    }
  });

  test("listTemplates sorts alphabetically and ignores README.md and empty dirs", () => {
    const h = createTestHarness();
    try {
      // Create live files
      fs.writeFileSync(path.join(h.agentDir, "AGENTS.md"), "live-a\n");

      // Create templates:
      // 1. z-last
      const zDir = path.join(h.templatesDir, "z-last");
      fs.mkdirSync(zDir, { recursive: true });
      fs.writeFileSync(path.join(zDir, "AGENTS.template.md"), "other\n");

      // 2. a-first (matches live)
      const aDir = path.join(h.templatesDir, "a-first");
      fs.mkdirSync(aDir, { recursive: true });
      fs.writeFileSync(path.join(aDir, "AGENTS.template.md"), "live-a\n");

      // 3. README.md file in templates dir
      fs.writeFileSync(path.join(h.templatesDir, "README.md"), "# Templates");

      // 4. empty dir
      fs.mkdirSync(path.join(h.templatesDir, "empty-dir"), { recursive: true });

      // 5. invalid slug dir
      fs.mkdirSync(path.join(h.templatesDir, "Invalid_Slug!"), { recursive: true });
      fs.writeFileSync(path.join(h.templatesDir, "Invalid_Slug!", "AGENTS.template.md"), "x");

      const list = listTemplates(h.templatesDir, h.agentDir);
      expect(list.length).toBe(2);
      expect(list[0].name).toBe("a-first");
      expect(list[0].matchesLive).toBe(true);
      expect(list[1].name).toBe("z-last");
      expect(list[1].matchesLive).toBe(false);

      // Missing templatesDir returns []
      expect(listTemplates(path.join(h.root, "nonexistent"), h.agentDir)).toEqual([]);
    } finally {
      h.cleanup();
    }
  });

  test("showTemplate returns accurate comparisons and matchesLive", () => {
    const h = createTestHarness();
    try {
      fs.writeFileSync(path.join(h.agentDir, "AGENTS.md"), "live-agents\n");
      fs.writeFileSync(path.join(h.agentDir, "RULES.md"), "live-rules\n");

      const tmplDir = path.join(h.templatesDir, "custom");
      fs.mkdirSync(tmplDir, { recursive: true });
      fs.writeFileSync(path.join(tmplDir, "AGENTS.template.md"), "diff-agents\n");
      fs.writeFileSync(path.join(tmplDir, "RULES.template.md"), "live-rules\n");

      const res = showTemplate(h.templatesDir, h.agentDir, "custom");
      expect(res.name).toBe("custom");
      expect(res.matchesLive).toBe(false);
      expect(res.comparisons).toEqual([
        { file: "AGENTS.md", inTemplate: true, liveExists: true, identical: false },
        { file: "RULES.md", inTemplate: true, liveExists: true, identical: true },
      ]);
    } finally {
      h.cleanup();
    }
  });

  test("deleteTemplate deletes directory with force and throws without force or on missing", () => {
    const h = createTestHarness();
    try {
      const tmplDir = path.join(h.templatesDir, "to-delete");
      fs.mkdirSync(tmplDir, { recursive: true });
      fs.writeFileSync(path.join(tmplDir, "AGENTS.template.md"), "bye\n");

      expect(() => deleteTemplate(h.templatesDir, "to-delete", { force: false })).toThrow(
        "pass --force to delete",
      );
      expect(fs.existsSync(tmplDir)).toBe(true);

      deleteTemplate(h.templatesDir, "to-delete", { force: true });
      expect(fs.existsSync(tmplDir)).toBe(false);

      expect(() => deleteTemplate(h.templatesDir, "to-delete", { force: true })).toThrow(
        'template "to-delete" not found',
      );
    } finally {
      h.cleanup();
    }
  });

  test("resolveCheckoutRoot resolves candidate in priority order or throws on invalid env / not found", () => {
    const h = createTestHarness();
    try {
      const fakeHome = path.join(h.root, "home");
      fs.mkdirSync(fakeHome, { recursive: true });

      // 1. Env winner
      const resolvedFromEnv = resolveCheckoutRoot(
        { OMP_TOOLKIT_HOME: h.checkout },
        path.join(h.root, "somewhere"),
        fakeHome,
      );
      expect(resolvedFromEnv).toBe(path.resolve(h.checkout));

      // 2. Env invalid => hard error naming env value
      expect(() =>
        resolveCheckoutRoot(
          { OMP_TOOLKIT_HOME: path.join(h.root, "not-a-checkout") },
          h.checkout,
          fakeHome,
        ),
      ).toThrow("OMP_TOOLKIT_HOME is not an omp-toolkit checkout");

      // 3. CWD ancestor winner
      const deepCwd = path.join(h.checkout, "nested", "inner");
      fs.mkdirSync(deepCwd, { recursive: true });
      const resolvedFromCwd = resolveCheckoutRoot({}, deepCwd, fakeHome);
      expect(resolvedFromCwd).toBe(path.resolve(h.checkout));

      // 4. Home-clone winner
      const homeClone = path.join(fakeHome, ".omp", "omp-toolkit");
      const homeProbe = path.join(homeClone, "scripts", "monitor", "orca-monitor.ts");
      fs.mkdirSync(path.dirname(homeProbe), { recursive: true });
      fs.writeFileSync(homeProbe, "// home clone probe");

      const resolvedFromHome = resolveCheckoutRoot({}, path.join(h.root, "other"), fakeHome);
      expect(resolvedFromHome).toBe(path.resolve(homeClone));

      // 5. None found => throws
      expect(() =>
        resolveCheckoutRoot({}, path.join(h.root, "other"), path.join(h.root, "empty-home")),
      ).toThrow("omp-toolkit checkout not found; set OMP_TOOLKIT_HOME");
    } finally {
      h.cleanup();
    }
  });

  test("applyTemplate prunes backups exceeding retention limit of 10", () => {
    const h = createTestHarness();
    try {
      // Seed a template
      const tmplDir = path.join(h.templatesDir, "demo");
      fs.mkdirSync(tmplDir, { recursive: true });
      fs.writeFileSync(path.join(tmplDir, "AGENTS.template.md"), "agents template\n");

      // Seed live file so backup is triggered
      fs.writeFileSync(path.join(h.agentDir, "AGENTS.md"), "live initial\n");

      // Seed 12 fake backup dirs
      // Seed 12 fake template backup dirs under backups/templates
      const backupsRoot = path.join(h.agentDir, "backups", "templates");
      fs.mkdirSync(backupsRoot, { recursive: true });
      for (let i = 1; i <= 12; i++) {
        const pad = String(i).padStart(2, "0");
        fs.mkdirSync(path.join(backupsRoot, `2026-01-${pad}T00-00-00-000Z`));
      }

      // Seed an installer backup under backups/ that must NEVER be pruned
      const installerBackup = path.join(h.agentDir, "backups", "2026-02-01T00-00-00-000Z");
      fs.mkdirSync(installerBackup, { recursive: true });
      fs.writeFileSync(path.join(installerBackup, "gemini-health.js"), "installer backup\n");

      const applyRes = applyTemplate(h.templatesDir, h.agentDir, "demo");
      expect(applyRes.backupDir).not.toBeNull();
      if (!applyRes.backupDir) throw new Error("expected backupDir");

      const remaining = fs
        .readdirSync(backupsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      expect(remaining.length).toBe(10);
      expect(remaining).toContain(path.basename(applyRes.backupDir));
      expect(fs.readFileSync(path.join(installerBackup, "gemini-health.js"), "utf8")).toBe(
        "installer backup\n",
      );
    } finally {
      h.cleanup();
    }
  });
});
