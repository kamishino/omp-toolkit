import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { YAML } from "bun";
import type { BackupContext, BackupRuntime } from "./omp-adapter";
import {
  exportBackupSnapshot,
  importBackupSnapshot,
  inspectBackupSnapshot,
  resolvePendingRestoreMarkerPath,
  resolveProfileAgentDir,
} from "./operations";

function initFreshSchema(db: Database): void {
  db.run("PRAGMA journal_mode=WAL;");
  db.run("PRAGMA synchronous=NORMAL;");
  db.run(`
    CREATE TABLE IF NOT EXISTS auth_schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL
    );
  `);
  db.run("INSERT OR REPLACE INTO auth_schema_version (id, version) VALUES (1, 8);");
  db.run(`
    CREATE TABLE IF NOT EXISTS auth_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      credential_type TEXT NOT NULL,
      data TEXT NOT NULL,
      disabled_cause TEXT DEFAULT NULL,
      identity_key TEXT DEFAULT NULL,
      created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
      updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS auth_credential_blocks (
      credential_id INTEGER NOT NULL,
      provider_key TEXT NOT NULL,
      block_scope TEXT NOT NULL DEFAULT '',
      blocked_until_ms INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (credential_id, provider_key, block_scope)
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS auth_credential_refresh_leases (
      credential_id INTEGER PRIMARY KEY,
      owner TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS auth_credential_block_mirror_guard (
      credential_id INTEGER PRIMARY KEY
    ) WITHOUT ROWID;
  `);
}

function createMockRuntime(): BackupRuntime {
  return {
    platform: "win32",
    async getVersion(): Promise<string> {
      return "18.18.3";
    },
    async listProcesses() {
      return [];
    },
    async initializeVault(agentDir: string) {
      fs.mkdirSync(agentDir, { recursive: true });
      const db = new Database(path.join(agentDir, "agent.db"));
      initFreshSchema(db);
      db.close();
    },
    async acquireLock(_lockPath: string) {
      return {
        async release() {},
      };
    },
    async launch() {
      return 0;
    },
  };
}

describe("apps/backup/operations", () => {
  let tempRoot: string;
  let sourceHome: string;
  let targetHome: string;
  let destinationDir: string;
  const testPassphrase = Buffer.from("synthetic-test-passphrase-8888", "utf8");

  beforeEach(() => {
    tempRoot = path.join(
      os.tmpdir(),
      `omp-ops-test-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    );
    sourceHome = path.join(tempRoot, "source-home");
    targetHome = path.join(tempRoot, "target-home");
    destinationDir = path.join(tempRoot, "drive-dest");

    fs.mkdirSync(sourceHome, { recursive: true });
    fs.mkdirSync(targetHome, { recursive: true });
    fs.mkdirSync(destinationDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  });

  it("exports and imports exact credential multiset and portable preferences while isolating target", async () => {
    // 1. Setup source default profile
    const sourceAgentDir = resolveProfileAgentDir(sourceHome, "default");
    fs.mkdirSync(sourceAgentDir, { recursive: true });

    const sourceDb = new Database(path.join(sourceAgentDir, "agent.db"));
    initFreshSchema(sourceDb);
    sourceDb.run(
      `INSERT INTO auth_credentials (provider, credential_type, data, identity_key) VALUES
      ('google-antigravity', 'oauth', '{"access":"tok-1","refresh":"ref-1","expires":1800000000000}', 'email:dev@example.invalid|org:platform'),
      ('google-antigravity', 'oauth', '{"access":"tok-2","refresh":"ref-2","expires":1800000000000}', 'email:personal@example.invalid'),
      ('deepseek', 'api_key', '{"key":"sk-deepseek-primary"}', NULL),
      ('deepseek', 'api_key', '{"key":"sk-deepseek-secondary"}', NULL)`,
    );
    sourceDb.close();

    const sourceConfig = {
      modelRoles: { default: "google-antigravity/gemini-3.8-flash", plan: "deepseek/deepseek-r1" },
      defaultThinkingLevel: "high",
      theme: { dark: "titanium" },
      edit: { mode: "apply_patch", fuzzyMatch: false },
      shellPath: "C:\\Program Files\\Git\\bin\\bash.exe",
    };
    fs.writeFileSync(path.join(sourceAgentDir, "config.yml"), YAML.stringify(sourceConfig), "utf8");

    // 2. Setup target omp-portable profile
    const targetAgentDir = resolveProfileAgentDir(targetHome, "omp-portable");
    fs.mkdirSync(targetAgentDir, { recursive: true });

    const targetDb = new Database(path.join(targetAgentDir, "agent.db"));
    initFreshSchema(targetDb);
    targetDb.run(
      `INSERT INTO auth_credentials (provider, credential_type, data, identity_key) VALUES
      ('openai', 'api_key', '{"key":"sk-target-local"}', NULL),
      ('mcp_oauth:github', 'oauth', '{"access":"gh","refresh":"gh-r","expires":1900000000000}', NULL)`,
    );
    targetDb.close();

    const targetConfig = {
      shellPath: "D:\\Git\\bin\\bash.exe",
      theme: { dark: "dracula" },
      dev: { autoqaConsent: "yes" },
      auth: { broker: { url: "http://old-broker:8765" } },
    };
    fs.writeFileSync(path.join(targetAgentDir, "config.yml"), YAML.stringify(targetConfig), "utf8");

    const sourceCtx: BackupContext = {
      home: sourceHome,
      env: {},
      runtime: createMockRuntime(),
    };

    const targetCtx: BackupContext = {
      home: targetHome,
      env: {},
      runtime: createMockRuntime(),
    };

    // 3. Export
    const { snapshotPath, latestPath } = await exportBackupSnapshot(
      {
        profile: "default",
        destinationDir,
        noLatestCopy: false,
        passphrase: testPassphrase,
      },
      sourceCtx,
    );

    expect(fs.existsSync(snapshotPath)).toBe(true);
    expect(latestPath).not.toBeNull();
    expect(fs.existsSync(latestPath ?? "")).toBe(true);

    // 4. Preview / inspect
    const preview = await inspectBackupSnapshot({
      snapshotPath,
      passphrase: testPassphrase,
    });
    expect(preview.kind).toBe("portable");
    expect(preview.credentialCount).toBe(4);
    expect(preview.sourceProfile).toBe("default");

    // 5. Restore
    const { recoveryPath, kind } = await importBackupSnapshot(
      {
        snapshotPath,
        confirmedSha256: preview.sha256,
        passphrase: testPassphrase,
      },
      targetCtx,
    );

    expect(kind).toBe("portable");
    expect(recoveryPath).not.toBeNull();
    expect(fs.existsSync(recoveryPath ?? "")).toBe(true);

    // 6. Verify credentials
    const verifyDb = new Database(path.join(targetAgentDir, "agent.db"), { readonly: true });
    const creds = verifyDb
      .query(
        "SELECT provider, credential_type, data, identity_key FROM auth_credentials WHERE disabled_cause IS NULL ORDER BY provider, id",
      )
      .all() as Array<{
      provider: string;
      credential_type: string;
      data: string;
      identity_key: string | null;
    }>;

    // 4 source credentials + 1 preserved MCP credential
    expect(creds).toHaveLength(5);
    expect(creds.find((c) => c.provider === "mcp_oauth:github")).toBeDefined();
    expect(creds.filter((c) => c.provider === "deepseek")).toHaveLength(2);
    expect(
      creds.find((c) => c.identity_key === "email:dev@example.invalid|org:platform"),
    ).toBeDefined();
    expect(creds.find((c) => c.provider === "openai")).toBeUndefined();
    verifyDb.close();

    // 7. Verify config
    const conf = YAML.parse(
      fs.readFileSync(path.join(targetAgentDir, "config.yml"), "utf8"),
    ) as Record<string, unknown>;
    expect(conf.modelRoles).toEqual({
      default: "google-antigravity/gemini-3.8-flash",
      plan: "deepseek/deepseek-r1",
    });
    expect((conf.theme as Record<string, unknown>)?.dark).toBe("titanium");
    expect((conf.edit as Record<string, unknown>)?.mode).toBe("apply_patch");
    expect(conf.shellPath).toBe("D:\\Git\\bin\\bash.exe");
    expect((conf.dev as Record<string, unknown>)?.autoqaConsent).toBe("yes");
    expect((conf.auth as Record<string, unknown>)?.broker).toBeUndefined();

    // 8. Rollback using recovery snapshot
    const recPath = recoveryPath ?? "";
    const recPreview = await inspectBackupSnapshot({
      snapshotPath: recPath,
      passphrase: testPassphrase,
    });
    expect(recPreview.kind).toBe("recovery");

    const rollbackResult = await importBackupSnapshot(
      {
        snapshotPath: recPath,
        confirmedSha256: recPreview.sha256,
        passphrase: testPassphrase,
      },
      targetCtx,
    );
    expect(rollbackResult.kind).toBe("recovery");

    const rbDb = new Database(path.join(targetAgentDir, "agent.db"), { readonly: true });
    const rbCreds = rbDb.query("SELECT provider FROM auth_credentials").all() as Array<{
      provider: string;
    }>;
    expect(rbCreds.find((c) => c.provider === "openai")).toBeDefined();
    rbDb.close();
  });

  it("refuses import when target profile process is active", async () => {
    const targetAgentDir = resolveProfileAgentDir(targetHome, "omp-portable");
    fs.mkdirSync(targetAgentDir, { recursive: true });

    const sourceAgentDir = resolveProfileAgentDir(sourceHome, "default");
    fs.mkdirSync(sourceAgentDir, { recursive: true });
    const sDb = new Database(path.join(sourceAgentDir, "agent.db"));
    initFreshSchema(sDb);
    sDb.run(
      "INSERT INTO auth_credentials (provider, credential_type, data) VALUES ('p', 'api_key', '{\"key\":\"k\"}')",
    );
    sDb.close();

    const sourceCtx: BackupContext = { home: sourceHome, env: {}, runtime: createMockRuntime() };
    const { snapshotPath } = await exportBackupSnapshot(
      { profile: "default", destinationDir, noLatestCopy: true, passphrase: testPassphrase },
      sourceCtx,
    );
    const preview = await inspectBackupSnapshot({ snapshotPath, passphrase: testPassphrase });

    const busyRuntime = createMockRuntime();
    busyRuntime.listProcesses = async () => [
      { pid: 1234, commandLine: "omp.exe --profile omp-portable" },
    ];

    const busyCtx: BackupContext = { home: targetHome, env: {}, runtime: busyRuntime };

    expect(
      importBackupSnapshot(
        { snapshotPath, confirmedSha256: preview.sha256, passphrase: testPassphrase },
        busyCtx,
      ),
    ).rejects.toThrow("currently in use by process 1234");
  });

  it("refuses import when pending marker exists for a different recovery snapshot", async () => {
    const targetAgentDir = resolveProfileAgentDir(targetHome, "omp-portable");
    fs.mkdirSync(targetAgentDir, { recursive: true });

    const sourceAgentDir = resolveProfileAgentDir(sourceHome, "default");
    fs.mkdirSync(sourceAgentDir, { recursive: true });
    const sDb = new Database(path.join(sourceAgentDir, "agent.db"));
    initFreshSchema(sDb);
    sDb.run(
      "INSERT INTO auth_credentials (provider, credential_type, data) VALUES ('p', 'api_key', '{\"key\":\"k\"}')",
    );
    sDb.close();

    const sourceCtx: BackupContext = { home: sourceHome, env: {}, runtime: createMockRuntime() };
    const { snapshotPath } = await exportBackupSnapshot(
      { profile: "default", destinationDir, noLatestCopy: true, passphrase: testPassphrase },
      sourceCtx,
    );
    const preview = await inspectBackupSnapshot({ snapshotPath, passphrase: testPassphrase });

    const markerPath = resolvePendingRestoreMarkerPath(targetHome);
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(
      markerPath,
      JSON.stringify({
        recoverySnapshotPath: "some-other-recovery.enc",
        startedAt: new Date().toISOString(),
        confirmedSha256: "abc",
      }),
      "utf8",
    );

    const targetCtx: BackupContext = { home: targetHome, env: {}, runtime: createMockRuntime() };

    expect(
      importBackupSnapshot(
        { snapshotPath, confirmedSha256: preview.sha256, passphrase: testPassphrase },
        targetCtx,
      ),
    ).rejects.toThrow("A pending restore was interrupted!");
  });
});
