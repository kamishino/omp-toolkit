import { Database } from "bun:sqlite";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  applyPortableSettings,
  assertSupportedAuthSchemaVersion,
  type BackupCredentialRecord,
  type BackupRecoveryBlockRecord,
  type BackupRecoveryCredentialRecord,
  type BackupRecoveryLeaseRecord,
  type BackupRecoveryMirrorGuardRecord,
  type BackupRecoveryPayload,
  type BackupSnapshotPayload,
  type BackupSourceProfile,
  decryptBackupPayload,
  EXPECTED_AUTH_SCHEMA_VERSION,
  encryptBackupPayload,
  extractPortableSettings,
  validateCredentialRecord,
} from "@omp-toolkit/core/backup";
import { YAML } from "bun";
import type { BackupContext } from "./omp-adapter";

export interface PendingRestoreMarker {
  recoverySnapshotPath: string;
  startedAt: string;
  confirmedSha256: string;
}

export function resolveProfileAgentDir(home: string, profile: BackupSourceProfile): string {
  return profile === "default"
    ? path.join(home, ".omp", "agent")
    : path.join(home, ".omp", "profiles", "omp-portable", "agent");
}

export function resolvePendingRestoreMarkerPath(home: string): string {
  return path.join(home, ".omp", "profiles", "omp-portable", "pending-restore.json");
}

export function resolveLockPath(home: string): string {
  return path.join(home, ".omp", "profiles", "omp-portable.lock");
}

// =============================================================================
// Export Operation
// =============================================================================

export async function exportBackupSnapshot(
  request: {
    profile: BackupSourceProfile;
    destinationDir: string;
    noLatestCopy: boolean;
    passphrase: Uint8Array;
  },
  context: BackupContext,
): Promise<{ snapshotPath: string; latestPath: string | null }> {
  const { profile, destinationDir, noLatestCopy, passphrase } = request;

  if (!fs.existsSync(destinationDir)) {
    throw new Error(`Destination directory '${destinationDir}' does not exist or is not mounted.`);
  }

  const agentDir = resolveProfileAgentDir(context.home, profile);
  const dbPath = path.join(agentDir, "agent.db");

  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `Source database '${dbPath}' does not exist. Cannot export credentials from an uninitialized profile.`,
    );
  }

  const yamlPath = path.join(agentDir, "config.yml");
  const yamlAltPath = path.join(agentDir, "config.yaml");
  let configContent: Record<string, unknown> = {};

  if (fs.existsSync(yamlPath) && fs.existsSync(yamlAltPath)) {
    throw new Error(
      `Ambiguous configuration: both 'config.yml' and 'config.yaml' exist in '${agentDir}'.`,
    );
  }

  const activeConfigPath = fs.existsSync(yamlPath)
    ? yamlPath
    : fs.existsSync(yamlAltPath)
      ? yamlAltPath
      : null;

  if (activeConfigPath) {
    const raw = fs.readFileSync(activeConfigPath, "utf8");
    if (raw.trim().length > 0) {
      const parsed = YAML.parse(raw);
      if (parsed !== null && typeof parsed !== "object") {
        throw new Error(`Configuration in '${activeConfigPath}' must be a YAML mapping.`);
      }
      configContent = (parsed as Record<string, unknown>) ?? {};
    }
  }

  const portableSettings = extractPortableSettings(configContent);

  const db = new Database(dbPath, { readonly: true });
  let credentials: BackupCredentialRecord[] = [];
  try {
    const versionRow = db.query("SELECT version FROM auth_schema_version WHERE id = 1").get() as {
      version?: number;
    } | null;
    assertSupportedAuthSchemaVersion(versionRow?.version);

    // Exact case-sensitive prefix exclusion for mcp_oauth:
    const rows = db
      .query(
        "SELECT provider, credential_type, data, identity_key FROM auth_credentials WHERE disabled_cause IS NULL AND substr(provider, 1, 10) != 'mcp_oauth:' ORDER BY id ASC",
      )
      .all() as Array<{
      provider: string;
      credential_type: string;
      data: string;
      identity_key: string | null;
    }>;

    credentials = rows.map((r) => ({
      provider: r.provider,
      credential_type: r.credential_type,
      data: r.data,
      identity_key: r.identity_key,
    }));
  } finally {
    db.close();
  }

  if (credentials.length === 0) {
    throw new Error(
      `Zero active provider credentials found in '${dbPath}'. ` +
        `Thin clients and unauthenticated profiles cannot create a credentials-free portable snapshot. ` +
        `Export must be executed on the machine holding the provider logins.`,
    );
  }

  for (const cred of credentials) {
    validateCredentialRecord(cred);
  }

  const actualOmpVersion = await context.runtime.getVersion();
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const randomHex = crypto.randomBytes(4).toString("hex");
  const snapshotFileName = `omp-config-${timestamp}-${randomHex}.enc`;
  const targetSnapshotPath = path.join(destinationDir, snapshotFileName);
  const partialSnapshotPath = path.join(destinationDir, `${snapshotFileName}.partial`);

  const payload: BackupSnapshotPayload = {
    formatVersion: 1,
    kind: "portable",
    createdAt: now.toISOString(),
    sourceHost: os.hostname(),
    sourceProfile: profile,
    ompVersion: actualOmpVersion,
    authSchemaVersion: EXPECTED_AUTH_SCHEMA_VERSION,
    portableSettings,
    credentials,
  };

  const encryptedBytes = encryptBackupPayload(payload, passphrase);

  fs.writeFileSync(partialSnapshotPath, encryptedBytes);
  fs.renameSync(partialSnapshotPath, targetSnapshotPath);

  let latestPath: string | null = null;
  if (!noLatestCopy) {
    latestPath = path.join(destinationDir, "omp-config-latest.enc");
    const partialLatestPath = path.join(destinationDir, "omp-config-latest.enc.partial");
    fs.writeFileSync(partialLatestPath, encryptedBytes);
    fs.renameSync(partialLatestPath, latestPath);
  }

  return { snapshotPath: targetSnapshotPath, latestPath };
}

// =============================================================================
// Inspect Operation
// =============================================================================

export async function inspectBackupSnapshot(request: {
  snapshotPath: string;
  passphrase: Uint8Array;
}): Promise<{
  sha256: string;
  kind: "portable" | "recovery";
  createdAt: string;
  sourceHost: string | null;
  sourceProfile: string | null;
  settingCount: number;
  credentialCount: number;
}> {
  const { snapshotPath, passphrase } = request;

  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot file '${snapshotPath}' does not exist.`);
  }

  const rawBytes = fs.readFileSync(snapshotPath);
  const sha256 = crypto.createHash("sha256").update(rawBytes).digest("hex");

  const payload = decryptBackupPayload(rawBytes, passphrase);

  if (payload.formatVersion !== 1) {
    throw new Error(`Unsupported snapshot formatVersion ${payload.formatVersion}. Expected 1.`);
  }
  if (payload.authSchemaVersion !== EXPECTED_AUTH_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported snapshot authSchemaVersion ${payload.authSchemaVersion ?? "missing/invalid"}. Supported schema is ${EXPECTED_AUTH_SCHEMA_VERSION}.`,
    );
  }

  if (payload.kind === "portable") {
    if (!Array.isArray(payload.credentials)) {
      throw new Error("Malformed snapshot: credentials array is required.");
    }
    for (const cred of payload.credentials) {
      validateCredentialRecord(cred);
    }
    return {
      sha256,
      kind: "portable",
      createdAt: payload.createdAt,
      sourceHost: payload.sourceHost,
      sourceProfile: payload.sourceProfile,
      settingCount: Object.keys(payload.portableSettings ?? {}).length,
      credentialCount: payload.credentials.length,
    };
  }

  if (payload.kind === "recovery") {
    return {
      sha256,
      kind: "recovery",
      createdAt: payload.createdAt,
      sourceHost: null,
      sourceProfile: null,
      settingCount: payload.configContent ? 1 : 0,
      credentialCount: payload.credentials?.length ?? 0,
    };
  }

  throw new Error("Unrecognized snapshot kind.");
}

// =============================================================================
// Import Operation
// =============================================================================

export async function importBackupSnapshot(
  request: {
    snapshotPath: string;
    confirmedSha256: string;
    passphrase: Uint8Array;
  },
  context: BackupContext,
): Promise<{ recoveryPath: string | null; kind: "portable" | "recovery" }> {
  const { snapshotPath, confirmedSha256, passphrase } = request;

  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot file '${snapshotPath}' does not exist.`);
  }

  const rawBytes = fs.readFileSync(snapshotPath);
  const actualSha256 = crypto.createHash("sha256").update(rawBytes).digest("hex");

  if (actualSha256 !== confirmedSha256) {
    throw new Error(
      `Snapshot verification mismatch! Expected SHA-256 '${confirmedSha256}', but file computed '${actualSha256}'. ` +
        `The snapshot file may have changed since inspection.`,
    );
  }

  const payload = decryptBackupPayload(rawBytes, passphrase);
  if (payload.formatVersion !== 1) {
    throw new Error(`Unsupported snapshot formatVersion ${payload.formatVersion}. Expected 1.`);
  }
  if (payload.authSchemaVersion !== EXPECTED_AUTH_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported snapshot authSchemaVersion ${payload.authSchemaVersion ?? "missing/invalid"}. Supported schema is ${EXPECTED_AUTH_SCHEMA_VERSION}.`,
    );
  }

  if (payload.kind === "portable") {
    if (!Array.isArray(payload.credentials)) {
      throw new Error("Malformed snapshot: credentials array is required.");
    }
    for (const cred of payload.credentials) {
      validateCredentialRecord(cred);
    }
  }

  // Process check: reject if omp-portable is running or command line is ambiguous
  const procs = await context.runtime.listProcesses();
  for (const proc of procs) {
    const cmd = proc.commandLine;
    if (cmd === null || cmd.includes("omp-portable") || cmd.includes("--profile omp-portable")) {
      throw new Error(
        `Target profile 'omp-portable' is currently in use by process ${proc.pid}. Stop OMP before modifying it.`,
      );
    }
  }

  const pendingMarkerPath = resolvePendingRestoreMarkerPath(context.home);
  if (fs.existsSync(pendingMarkerPath)) {
    const markerRaw = fs.readFileSync(pendingMarkerPath, "utf8");
    const marker: PendingRestoreMarker = JSON.parse(markerRaw);
    if (snapshotPath !== marker.recoverySnapshotPath) {
      throw new Error(
        `A pending restore was interrupted! You must restore recovery snapshot '${marker.recoverySnapshotPath}' ` +
          `to recover the previous baseline before performing any new import.`,
      );
    }
  }

  const targetAgentDir = resolveProfileAgentDir(context.home, "omp-portable");
  const targetDbPath = path.join(targetAgentDir, "agent.db");
  const targetConfigPath = path.join(targetAgentDir, "config.yml");

  // Preflight target database schema if it already exists
  if (fs.existsSync(targetDbPath)) {
    const preDb = new Database(targetDbPath, { readonly: true });
    try {
      const row = preDb.query("SELECT version FROM auth_schema_version WHERE id = 1").get() as {
        version?: number;
      } | null;
      assertSupportedAuthSchemaVersion(row?.version);
    } finally {
      preDb.close();
    }
  }

  const lock = await context.runtime.acquireLock(resolveLockPath(context.home));

  try {
    // -------------------------------------------------------------------------
    // Recovery Restore (Rollback)
    // -------------------------------------------------------------------------
    if (payload.kind === "recovery") {
      if (!payload.profileExisted) {
        if (fs.existsSync(targetConfigPath)) {
          fs.unlinkSync(targetConfigPath);
        }
        if (fs.existsSync(targetDbPath)) {
          const db = new Database(targetDbPath);
          try {
            db.run("DELETE FROM auth_credentials WHERE substr(provider, 1, 10) != 'mcp_oauth:'");
            db.run("DELETE FROM auth_credential_blocks");
            db.run("DELETE FROM auth_credential_refresh_leases");
            db.run("DELETE FROM auth_credential_block_mirror_guard");
          } finally {
            db.close();
          }
        }
      } else {
        if (payload.configContent !== null && payload.configFileName) {
          const confPath = path.join(targetAgentDir, payload.configFileName);
          fs.writeFileSync(confPath, payload.configContent, "utf8");
        }

        if (fs.existsSync(targetDbPath)) {
          const db = new Database(targetDbPath);
          try {
            db.run("BEGIN IMMEDIATE");
            db.run("DELETE FROM auth_credentials WHERE substr(provider, 1, 10) != 'mcp_oauth:'");
            db.run("DELETE FROM auth_credential_blocks");
            db.run("DELETE FROM auth_credential_refresh_leases");
            db.run("DELETE FROM auth_credential_block_mirror_guard");

            const insertCred = db.prepare(
              "INSERT INTO auth_credentials (id, provider, credential_type, data, disabled_cause, identity_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            );
            for (const c of payload.credentials) {
              insertCred.run(
                c.id,
                c.provider,
                c.credential_type,
                c.data,
                c.disabled_cause,
                c.identity_key,
                c.created_at,
                c.updated_at,
              );
            }

            const insertBlock = db.prepare(
              "INSERT INTO auth_credential_blocks (credential_id, provider_key, block_scope, blocked_until_ms, updated_at) VALUES (?, ?, ?, ?, ?)",
            );
            for (const b of payload.blocks) {
              insertBlock.run(
                b.credential_id,
                b.provider_key,
                b.block_scope,
                b.blocked_until_ms,
                b.updated_at,
              );
            }

            const insertLease = db.prepare(
              "INSERT INTO auth_credential_refresh_leases (credential_id, owner, expires_at_ms, updated_at) VALUES (?, ?, ?, ?)",
            );
            for (const l of payload.leases) {
              insertLease.run(l.credential_id, l.owner, l.expires_at_ms, l.updated_at);
            }

            const insertGuard = db.prepare(
              "INSERT INTO auth_credential_block_mirror_guard (credential_id) VALUES (?)",
            );
            for (const g of payload.mirrorGuards) {
              insertGuard.run(g.credential_id);
            }

            db.run("COMMIT");
          } catch (err) {
            db.run("ROLLBACK");
            throw err;
          } finally {
            db.close();
          }
        }
      }

      if (fs.existsSync(pendingMarkerPath)) {
        fs.unlinkSync(pendingMarkerPath);
      }

      return { recoveryPath: null, kind: "recovery" };
    }

    // -------------------------------------------------------------------------
    // Portable Restore (Forward Import)
    // -------------------------------------------------------------------------
    const profileExisted = fs.existsSync(targetAgentDir);
    const recoveryDir = path.join(context.home, ".omp", "backups", "portable-restore");
    if (!fs.existsSync(recoveryDir)) {
      fs.mkdirSync(recoveryDir, { recursive: true });
    }

    let existingConfigFileName: string | null = null;
    let existingConfigContent: string | null = null;
    let existingTargetConfig: Record<string, unknown> = {};

    if (profileExisted) {
      if (fs.existsSync(targetConfigPath)) {
        existingConfigFileName = "config.yml";
        existingConfigContent = fs.readFileSync(targetConfigPath, "utf8");
        try {
          existingTargetConfig =
            (YAML.parse(existingConfigContent) as Record<string, unknown>) ?? {};
        } catch {}
      } else {
        const altConfig = path.join(targetAgentDir, "config.yaml");
        if (fs.existsSync(altConfig)) {
          existingConfigFileName = "config.yaml";
          existingConfigContent = fs.readFileSync(altConfig, "utf8");
          try {
            existingTargetConfig =
              (YAML.parse(existingConfigContent) as Record<string, unknown>) ?? {};
          } catch {}
        }
      }
    } else {
      // First-time creation: seed shellPath from default profile if present
      const defaultAgentDir = resolveProfileAgentDir(context.home, "default");
      const defaultConf = path.join(defaultAgentDir, "config.yml");
      if (fs.existsSync(defaultConf)) {
        try {
          const parsed = YAML.parse(fs.readFileSync(defaultConf, "utf8")) as Record<
            string,
            unknown
          >;
          if (typeof parsed?.shellPath === "string") {
            existingTargetConfig.shellPath = parsed.shellPath;
          }
        } catch {}
      }
    }

    let existingCredentials: BackupRecoveryCredentialRecord[] = [];
    let existingBlocks: BackupRecoveryBlockRecord[] = [];
    let existingLeases: BackupRecoveryLeaseRecord[] = [];
    let existingMirrorGuards: BackupRecoveryMirrorGuardRecord[] = [];

    if (fs.existsSync(targetDbPath)) {
      const db = new Database(targetDbPath, { readonly: true });
      try {
        existingCredentials = db
          .query(
            "SELECT id, provider, credential_type, data, disabled_cause, identity_key, created_at, updated_at FROM auth_credentials WHERE substr(provider, 1, 10) != 'mcp_oauth:'",
          )
          .all() as BackupRecoveryCredentialRecord[];

        existingBlocks = db
          .query(
            "SELECT credential_id, provider_key, block_scope, blocked_until_ms, updated_at FROM auth_credential_blocks",
          )
          .all() as BackupRecoveryBlockRecord[];

        existingLeases = db
          .query(
            "SELECT credential_id, owner, expires_at_ms, updated_at FROM auth_credential_refresh_leases",
          )
          .all() as BackupRecoveryLeaseRecord[];

        existingMirrorGuards = db
          .query("SELECT credential_id FROM auth_credential_block_mirror_guard")
          .all() as BackupRecoveryMirrorGuardRecord[];
      } finally {
        db.close();
      }
    }

    const actualOmpVersion = await context.runtime.getVersion();
    const recoveryPayload: BackupRecoveryPayload = {
      formatVersion: 1,
      kind: "recovery",
      createdAt: new Date().toISOString(),
      ompVersion: actualOmpVersion,
      authSchemaVersion: EXPECTED_AUTH_SCHEMA_VERSION,
      profileExisted,
      configFileName: existingConfigFileName,
      configContent: existingConfigContent,
      credentials: existingCredentials,
      blocks: existingBlocks,
      leases: existingLeases,
      mirrorGuards: existingMirrorGuards,
    };

    const recoveryEncrypted = encryptBackupPayload(recoveryPayload, passphrase);
    const recoveryFileName = `recovery-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.enc`;
    const recoveryPath = path.join(recoveryDir, recoveryFileName);
    fs.writeFileSync(recoveryPath, recoveryEncrypted);

    // Verify recovery decrypts cleanly
    decryptBackupPayload(fs.readFileSync(recoveryPath), passphrase);

    // Write pending marker
    if (!fs.existsSync(path.dirname(pendingMarkerPath))) {
      fs.mkdirSync(path.dirname(pendingMarkerPath), { recursive: true });
    }
    const markerData: PendingRestoreMarker = {
      recoverySnapshotPath: recoveryPath,
      startedAt: new Date().toISOString(),
      confirmedSha256,
    };
    fs.writeFileSync(pendingMarkerPath, JSON.stringify(markerData, null, 2), "utf8");

    if (!fs.existsSync(targetAgentDir)) {
      fs.mkdirSync(targetAgentDir, { recursive: true });
    }

    const updatedConfig = applyPortableSettings(existingTargetConfig, payload.portableSettings);
    const updatedConfigYaml = YAML.stringify(updatedConfig);

    // Initialize database if absent via runtime vault initializer
    if (!fs.existsSync(targetDbPath)) {
      await context.runtime.initializeVault(targetAgentDir);
    }

    const targetDb = new Database(targetDbPath);
    try {
      const row = targetDb.query("SELECT version FROM auth_schema_version WHERE id = 1").get() as {
        version?: number;
      } | null;
      assertSupportedAuthSchemaVersion(row?.version);

      targetDb.run("BEGIN IMMEDIATE");

      const existingRows = targetDb
        .query("SELECT id FROM auth_credentials WHERE substr(provider, 1, 10) != 'mcp_oauth:'")
        .all() as Array<{ id: number }>;
      const existingIds = existingRows.map((r) => r.id);

      if (existingIds.length > 0) {
        const idList = existingIds.join(",");
        targetDb.run(`DELETE FROM auth_credential_blocks WHERE credential_id IN (${idList})`);
        targetDb.run(
          `DELETE FROM auth_credential_refresh_leases WHERE credential_id IN (${idList})`,
        );
        targetDb.run(
          `DELETE FROM auth_credential_block_mirror_guard WHERE credential_id IN (${idList})`,
        );
        targetDb.run(`DELETE FROM auth_credentials WHERE id IN (${idList})`);
      }

      const insertStmt = targetDb.prepare(
        "INSERT INTO auth_credentials (provider, credential_type, data, identity_key, disabled_cause, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER))",
      );

      for (const cred of payload.credentials) {
        insertStmt.run(cred.provider, cred.credential_type, cred.data, cred.identity_key);
      }

      const tmpConfigPath = path.join(targetAgentDir, "config.yml.tmp");
      fs.writeFileSync(tmpConfigPath, updatedConfigYaml, "utf8");
      fs.renameSync(tmpConfigPath, targetConfigPath);

      targetDb.run("COMMIT");
    } catch (err) {
      try {
        targetDb.run("ROLLBACK");
      } catch {}
      if (existingConfigContent !== null && existingConfigFileName) {
        fs.writeFileSync(
          path.join(targetAgentDir, existingConfigFileName),
          existingConfigContent,
          "utf8",
        );
      }
      throw err;
    } finally {
      targetDb.close();
    }

    // Verify consistency
    const verifyDb = new Database(targetDbPath, { readonly: true });
    try {
      const activeCountRow = verifyDb
        .query(
          "SELECT COUNT(*) as count FROM auth_credentials WHERE disabled_cause IS NULL AND substr(provider, 1, 10) != 'mcp_oauth:'",
        )
        .get() as { count: number };
      if (activeCountRow.count !== payload.credentials.length) {
        throw new Error(
          `Restored credential count mismatch! Target holds ${activeCountRow.count}, expected ${payload.credentials.length}.`,
        );
      }
    } finally {
      verifyDb.close();
    }

    if (fs.existsSync(pendingMarkerPath)) {
      fs.unlinkSync(pendingMarkerPath);
    }

    return { recoveryPath, kind: "portable" };
  } finally {
    await lock.release();
  }
}

// =============================================================================
// Launch Operation
// =============================================================================

export async function launchPortableProfile(
  args: readonly string[],
  context: BackupContext,
  ompPath = "omp",
): Promise<number> {
  const targetAgentDir = resolveProfileAgentDir(context.home, "omp-portable");
  if (!fs.existsSync(targetAgentDir)) {
    throw new Error(
      `Profile 'omp-portable' does not exist under '${context.home}'. Please run 'backup:import' first.`,
    );
  }

  const markerPath = resolvePendingRestoreMarkerPath(context.home);
  if (fs.existsSync(markerPath)) {
    throw new Error(
      `Pending restore marker detected at '${markerPath}'. An import was interrupted or failed. ` +
        `Restore the recovery snapshot before launching OMP.`,
    );
  }

  // Validate version via runtime
  await context.runtime.getVersion(ompPath);

  // Verify config has no broker configured
  const confPath = path.join(targetAgentDir, "config.yml");
  if (fs.existsSync(confPath)) {
    const raw = fs.readFileSync(confPath, "utf8");
    if (raw.trim().length > 0) {
      try {
        const parsed = YAML.parse(raw) as Record<string, unknown>;
        if (parsed?.["auth.broker.url"] || (parsed?.auth as Record<string, unknown>)?.broker) {
          throw new Error(
            `Direct profile at '${targetAgentDir}' contains active broker settings. Direct launch aborted.`,
          );
        }
      } catch (err) {
        if (String(err).includes("Direct profile at")) throw err;
      }
    }
  }

  return await context.runtime.launch(args, context.env, process.cwd(), ompPath);
}
