import * as crypto from "node:crypto";

// =============================================================================
// Constants & Formats
// =============================================================================

export const BACKUP_MAGIC = Buffer.from("OMPBAK01", "ascii");
export const BACKUP_MIN_OMP_VERSION = "18.18.2";
export const EXPECTED_AUTH_SCHEMA_VERSION = 8;
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024; // 16 MiB

export const PORTABLE_SETTINGS_KEYS = [
  "modelRoles",
  "defaultThinkingLevel",
  "modelPresets",
  "enabledModels",
  "enabledProviders",
  "disabledProviders",
  "modelProviderOrder",
  "cycleOrder",
  "extendedContext",
  "compaction",
  "retry",
  "theme",
  "symbolPreset",
  "statusLine",
  "display",
  "composer",
  "interruptMode",
  "personality",
  "emojiAutocomplete",
] as const;

export const PORTABLE_NESTED_SETTINGS_KEYS = [
  "auth.accountPolicies",
  "edit.mode",
  "plan.defaultOnStartup",
  "task.enableEffort",
  "github.enabled",
  "commands.enableClaudeProject",
  "commands.enableOpencodeProject",
] as const;

// =============================================================================
// Types
// =============================================================================

export type BackupSourceProfile = "default" | "omp-portable";

export interface BackupCredentialRecord {
  provider: string;
  credential_type: string;
  data: string;
  identity_key: string | null;
}

export interface BackupSnapshotPayload {
  formatVersion: 1;
  kind: "portable";
  createdAt: string;
  sourceHost: string;
  sourceProfile: BackupSourceProfile;
  ompVersion: string;
  authSchemaVersion: number;
  portableSettings: Record<string, unknown>;
  credentials: BackupCredentialRecord[];
}

export interface BackupRecoveryCredentialRecord {
  id: number;
  provider: string;
  credential_type: string;
  data: string;
  disabled_cause: string | null;
  identity_key: string | null;
  created_at: number;
  updated_at: number;
}

export interface BackupRecoveryBlockRecord {
  credential_id: number;
  provider_key: string;
  block_scope: string;
  blocked_until_ms: number;
  updated_at: number;
}

export interface BackupRecoveryLeaseRecord {
  credential_id: number;
  owner: string;
  expires_at_ms: number;
  updated_at: number;
}

export interface BackupRecoveryMirrorGuardRecord {
  credential_id: number;
}

export interface BackupRecoveryPayload {
  formatVersion: 1;
  kind: "recovery";
  createdAt: string;
  ompVersion: string;
  authSchemaVersion: number;
  profileExisted: boolean;
  configFileName: string | null;
  configContent: string | null;
  credentials: BackupRecoveryCredentialRecord[];
  blocks: BackupRecoveryBlockRecord[];
  leases: BackupRecoveryLeaseRecord[];
  mirrorGuards: BackupRecoveryMirrorGuardRecord[];
}

export type BackupPayload = BackupSnapshotPayload | BackupRecoveryPayload;

// =============================================================================
// Validation & Versioning
// =============================================================================

export function validateBackupRuntimeVersion(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("Unrecognized OMP version output.");
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length !== 1) {
    throw new Error("Unrecognized OMP version output.");
  }
  const normalized = lines[0].replace(/^omp\//i, "").trim();
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Unrecognized OMP version output: '${output.trim()}'.`);
  }
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    throw new Error("Unrecognized OMP version output.");
  }

  const minMatch = BACKUP_MIN_OMP_VERSION.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!minMatch) return normalized;
  const minMajor = Number.parseInt(minMatch[1], 10);
  const minMinor = Number.parseInt(minMatch[2], 10);
  const minPatch = Number.parseInt(minMatch[3], 10);

  const isOlder =
    major < minMajor ||
    (major === minMajor && minor < minMinor) ||
    (major === minMajor && minor === minMinor && patch < minPatch);

  if (isOlder) {
    throw new Error(
      `Unsupported OMP version ${normalized}; requires OMP >=${BACKUP_MIN_OMP_VERSION}.`,
    );
  }

  return normalized;
}

export function assertSupportedAuthSchemaVersion(version: number | null | undefined): void {
  if (version !== EXPECTED_AUTH_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported authentication schema ${version ?? "missing/invalid"}; supported schema is ${EXPECTED_AUTH_SCHEMA_VERSION}.`,
    );
  }
}

export function validateCredentialRecord(entry: BackupCredentialRecord): void {
  if (!entry.provider || typeof entry.provider !== "string") {
    throw new Error("Invalid credential: provider is required.");
  }
  if (!["api_key", "oauth"].includes(entry.credential_type)) {
    throw new Error(
      `Invalid credential type '${entry.credential_type}' for provider '${entry.provider}'.`,
    );
  }

  let dataObj: Record<string, unknown>;
  try {
    dataObj = JSON.parse(entry.data);
  } catch {
    throw new Error(`Invalid credential JSON data for provider '${entry.provider}'.`);
  }

  if (dataObj === null || typeof dataObj !== "object" || Array.isArray(dataObj)) {
    throw new Error(`Invalid credential JSON object for provider '${entry.provider}'.`);
  }

  if (entry.credential_type === "api_key") {
    if (typeof dataObj.key !== "string" || dataObj.key.trim().length === 0) {
      throw new Error(`API key for provider '${entry.provider}' has no valid key string.`);
    }
  } else if (entry.credential_type === "oauth") {
    if (typeof dataObj.access !== "string" || typeof dataObj.refresh !== "string") {
      throw new Error(
        `OAuth credential for provider '${entry.provider}' is missing access or refresh token.`,
      );
    }
    if (dataObj.refresh === "__remote__") {
      throw new Error(
        `OAuth credential for '${entry.provider}' has sentinel refresh token '__remote__'. Broker credentials cannot be exported.`,
      );
    }
    if (typeof dataObj.expires !== "number" || !Number.isFinite(dataObj.expires)) {
      throw new Error(
        `OAuth credential for provider '${entry.provider}' has non-numeric expires field.`,
      );
    }
  }
}

// =============================================================================
// Settings Extraction & Sanitization
// =============================================================================

function isForbiddenKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function getNestedValue(obj: Record<string, unknown>, dottedKey: string): unknown {
  let curr: unknown = obj;
  for (const part of dottedKey.split(".")) {
    if (isForbiddenKey(part)) return undefined;
    if (curr === null || typeof curr !== "object" || Array.isArray(curr)) {
      return undefined;
    }
    curr = (curr as Record<string, unknown>)[part];
  }
  return curr;
}

function setNestedValue(obj: Record<string, unknown>, dottedKey: string, value: unknown): void {
  const parts = dottedKey.split(".");
  let curr: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (isForbiddenKey(part)) return;
    if (curr[part] === null || typeof curr[part] !== "object" || Array.isArray(curr[part])) {
      curr[part] = {};
    }
    curr = curr[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1];
  if (!isForbiddenKey(lastPart)) {
    curr[lastPart] = value;
  }
}

function deleteNestedValue(obj: Record<string, unknown>, dottedKey: string): void {
  const parts = dottedKey.split(".");
  let curr: Record<string, unknown> = obj;
  const stack: Array<{ parent: Record<string, unknown>; key: string }> = [];

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (isForbiddenKey(part)) return;
    if (curr[part] === null || typeof curr[part] !== "object" || Array.isArray(curr[part])) {
      return;
    }
    stack.push({ parent: curr, key: part });
    curr = curr[part] as Record<string, unknown>;
  }

  const leaf = parts[parts.length - 1];
  if (!isForbiddenKey(leaf)) {
    delete curr[leaf];
  }

  // Prune empty parent objects
  for (let i = stack.length - 1; i >= 0; i--) {
    const { parent, key } = stack[i];
    const child = parent[key];
    if (
      child !== null &&
      typeof child === "object" &&
      !Array.isArray(child) &&
      Object.keys(child as Record<string, unknown>).length === 0
    ) {
      delete parent[key];
    }
  }
}

export function extractPortableSettings(
  sourceConfig: Record<string, unknown>,
): Record<string, unknown> {
  const portable: Record<string, unknown> = {};

  for (const key of PORTABLE_SETTINGS_KEYS) {
    if (isForbiddenKey(key)) continue;
    if (Object.hasOwn(sourceConfig, key) && sourceConfig[key] !== undefined) {
      const val = sourceConfig[key];

      if (
        key === "modelPresets" &&
        val !== null &&
        typeof val === "object" &&
        !Array.isArray(val)
      ) {
        for (const [presetName, presetVal] of Object.entries(val as Record<string, unknown>)) {
          if (presetVal !== null && typeof presetVal === "object" && !Array.isArray(presetVal)) {
            for (const presetField of Object.keys(presetVal as Record<string, unknown>)) {
              if (presetField !== "modelRoles" && presetField !== "defaultThinkingLevel") {
                throw new Error(
                  `Unsupported modelPreset property '${presetField}' in preset '${presetName}'. ` +
                    `Portable presets support only 'modelRoles' and 'defaultThinkingLevel'.`,
                );
              }
            }
          }
        }
      }

      if (
        ["enabledModels", "enabledProviders", "disabledProviders"].includes(key) &&
        Array.isArray(val)
      ) {
        for (const item of val) {
          if (typeof item !== "string") {
            throw new Error(
              `Path-scoped entries in '${key}' cannot be exported portably; only plain string identifiers are supported.`,
            );
          }
        }
      }

      portable[key] = val;
    }
  }

  for (const dottedKey of PORTABLE_NESTED_SETTINGS_KEYS) {
    const val = getNestedValue(sourceConfig, dottedKey);
    if (val !== undefined) {
      setNestedValue(portable, dottedKey, val);
    }
  }

  return portable;
}

export function applyPortableSettings(
  targetConfig: Record<string, unknown>,
  portableSettings: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = JSON.parse(JSON.stringify(targetConfig));

  // Remove existing portable keys
  for (const key of PORTABLE_SETTINGS_KEYS) {
    delete result[key];
  }
  for (const dottedKey of PORTABLE_NESTED_SETTINGS_KEYS) {
    deleteNestedValue(result, dottedKey);
  }

  // Remove broker configuration from recovery profile
  deleteNestedValue(result, "auth.broker");
  delete result["auth.broker.url"];
  delete result["auth.broker.token"];

  // Apply new portable settings: whole keys
  for (const key of PORTABLE_SETTINGS_KEYS) {
    if (Object.hasOwn(portableSettings, key) && portableSettings[key] !== undefined) {
      result[key] = portableSettings[key];
    }
  }

  // Apply new portable settings: nested leaves
  for (const dottedKey of PORTABLE_NESTED_SETTINGS_KEYS) {
    const val = getNestedValue(portableSettings, dottedKey);
    if (val !== undefined) {
      setNestedValue(result, dottedKey, val);
    }
  }

  return result;
}

// =============================================================================
// Encryption / Decryption (scrypt + AES-256-GCM)
// =============================================================================

export function encryptBackupPayload(payload: BackupPayload, passphrase: Uint8Array): Uint8Array {
  if (passphrase.length === 0) {
    throw new Error("Passphrase cannot be empty.");
  }

  const jsonBytes = Buffer.from(JSON.stringify(payload), "utf8");
  if (jsonBytes.length > MAX_SNAPSHOT_BYTES) {
    throw new Error(`Snapshot payload exceeds maximum size of ${MAX_SNAPSHOT_BYTES} bytes.`);
  }

  const salt = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);

  const key = crypto.scryptSync(passphrase, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });

  const header = Buffer.concat([BACKUP_MAGIC, salt, nonce]); // 52 bytes AAD

  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(header);

  const ciphertext = Buffer.concat([cipher.update(jsonBytes), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  return new Uint8Array(Buffer.concat([header, ciphertext, tag]));
}

export function decryptBackupPayload(bytes: Uint8Array, passphrase: Uint8Array): BackupPayload {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (buffer.length < 8 + 32 + 12 + 16) {
    throw new Error("Decryption failed: invalid snapshot format (file too short).");
  }

  if (buffer.length > MAX_SNAPSHOT_BYTES) {
    throw new Error("Decryption failed: snapshot file exceeds maximum permitted size.");
  }

  const magic = buffer.subarray(0, 8);
  if (!magic.equals(BACKUP_MAGIC)) {
    throw new Error("Decryption failed: unrecognized file magic (not an OMP encrypted snapshot).");
  }

  const salt = buffer.subarray(8, 40);
  const nonce = buffer.subarray(40, 52);
  const header = buffer.subarray(0, 52);
  const tag = buffer.subarray(buffer.length - 16);
  const ciphertext = buffer.subarray(52, buffer.length - 16);

  let key: Buffer;
  try {
    key = crypto.scryptSync(passphrase, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(`Key derivation failed: ${String(err)}`);
  }

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8"));

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Decryption failed: malformed snapshot payload.");
    }
    return parsed as BackupPayload;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("Decryption failed: malformed")) {
      throw err;
    }
    throw new Error("Decryption failed: invalid passphrase or corrupted snapshot.");
  }
}
