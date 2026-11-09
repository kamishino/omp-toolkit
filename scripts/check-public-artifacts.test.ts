import { describe, expect, it } from "bun:test";
import { findPrivateArtifacts, normalizeRepoPath } from "./check-public-artifacts";

describe("check-public-artifacts", () => {
  it("normalizes path separators and trims whitespace", () => {
    expect(normalizeRepoPath("apps\\backup\\src\\index.ts")).toBe("apps/backup/src/index.ts");
    expect(normalizeRepoPath("./packages/core/src/backup.ts ")).toBe("packages/core/src/backup.ts");
  });

  it("detects forbidden private artifacts (negative fixtures)", () => {
    const forbiddenList = [
      "omp-config-20261109T030000Z-1234.enc",
      "backups/omp-config-latest.enc",
      "omp-config-20261107-075138.zip",
      "temp-backup.partial",
      "apps/backup/pending-restore.json",
      "credentials.json",
      "profiles/default/credentials.json",
      "config.local",
      ".env",
      ".env.production",
      "vault.db",
      "vault.sqlite",
      "agent.db-wal",
      "models.db-shm",
      "server.key",
      "client.pem",
      "auth.p12",
      ".omp/agent/agent.db",
      "backups/recovery.enc",
      "apps/backup/dist/index.js",
      "out/coverage.json",
      "coverage/lcov.info",
    ];

    const violations = findPrivateArtifacts(forbiddenList);
    expect(violations).toHaveLength(forbiddenList.length);
  });

  it("accepts legitimate public source, templates, and example files (positive fixtures)", () => {
    const allowedList = [
      "apps/backup/package.json",
      "apps/backup/src/index.ts",
      "apps/backup/src/config.ts",
      "apps/backup/src/operations.ts",
      "apps/backup/src/omp-adapter.ts",
      "packages/core/src/backup.ts",
      "packages/core/src/backup.test.ts",
      "scripts/backup/export-omp-config.ps1",
      "scripts/backup/import-omp-config.ps1",
      "scripts/backup/start-omp-direct.ps1",
      "scripts/check-public-artifacts.ts",
      "scripts/build/build.ts",
      "templates/plan-exec-handoff/AGENTS.template.md",
      ".env.example",
      "README.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "GLOSSARY.md",
      "docs/adr/0011-isolated-credential-recovery.md",
    ];

    const violations = findPrivateArtifacts(allowedList);
    expect(violations).toHaveLength(0);
  });
});
