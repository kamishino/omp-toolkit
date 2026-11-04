// Scoped-clients file: strict parse for views plus fail-closed entry
// upserts for writes. Digests are fingerprints only; raw tokens never land here.

import { maskIdentityKey } from "./identities";

export interface GatewayClientView {
  name: string;
  tokenFingerprint: string;
  models: string[] | null; // null = all served models
  accounts: Record<string, string[]> | null;
}

export interface ParseClientsResult {
  clients: GatewayClientView[];
  error: string | null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/i;

export function parseClientsFile(text: string): ParseClientsResult {
  let parsed: unknown;
  try {
    // PowerShell-written files (Set-Content -Encoding UTF8) carry a BOM that
    // strict JSON parsers reject; the legacy manager produces them.
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (err) {
    return {
      clients: [],
      error: `clients file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { clients: [], error: "clients file must be a JSON object mapping name to client" };
  }
  const clients: GatewayClientView[] = [];
  for (const [name, raw] of Object.entries(parsed)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { clients: [], error: `client "${name}" must be an object` };
    }
    const entry = raw as Record<string, unknown>;
    const digest = entry.tokenSha256;
    if (typeof digest !== "string" || !SHA256_HEX.test(digest)) {
      return { clients: [], error: `client "${name}".tokenSha256 must be a hex SHA-256 digest` };
    }
    let models: string[] | null = null;
    if (entry.models !== undefined) {
      if (!Array.isArray(entry.models) || !entry.models.every((m) => typeof m === "string")) {
        return { clients: [], error: `client "${name}".models must be a list of strings` };
      }
      models = entry.models as string[];
    }
    let accounts: Record<string, string[]> | null = null;
    if (entry.accounts !== undefined) {
      if (
        typeof entry.accounts !== "object" ||
        entry.accounts === null ||
        Array.isArray(entry.accounts)
      ) {
        return { clients: [], error: `client "${name}".accounts must be an object` };
      }
      accounts = {};
      for (const [providerId, keys] of Object.entries(entry.accounts as Record<string, unknown>)) {
        if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string")) {
          return {
            clients: [],
            error: `client "${name}".accounts.${providerId} must be a list of identity keys`,
          };
        }
        // Mask identity keys at this boundary so views never carry raw emails.
        accounts[providerId] = (keys as string[]).map(maskIdentityKey);
      }
    }
    clients.push({ name, tokenFingerprint: digest.slice(0, 8).toLowerCase(), models, accounts });
  }
  clients.sort((a, b) => a.name.localeCompare(b.name));
  return { clients, error: null };
}

export interface ClientEntryWrite {
  tokenSha256: string;
  models?: string[];
  accounts?: Record<string, string[]>;
}

export interface ClientsFileWriteResult {
  text: string;
  error: string | null;
}

type RawClientsMap = Record<string, Record<string, unknown>>;

function parseRawClientsMap(text: string): { map: RawClientsMap } | { error: string } {
  // Validate through the read path first so writes fail closed on any
  // pre-existing corruption instead of silently dropping entries.
  const checked = parseClientsFile(text);
  if (checked.error) return { error: checked.error };
  const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
  return { map: parsed as RawClientsMap };
}

export function upsertClientEntry(
  existingText: string,
  name: string,
  entry: ClientEntryWrite,
  options: { force?: boolean } = {},
): ClientsFileWriteResult {
  if (!name.trim()) return { text: existingText, error: "client name must not be empty" };
  if (!SHA256_HEX.test(entry.tokenSha256)) {
    return { text: existingText, error: "tokenSha256 must be a hex SHA-256 digest" };
  }
  const parsed = parseRawClientsMap(existingText);
  if ("error" in parsed) return { text: existingText, error: parsed.error };
  if (name in parsed.map && !options.force) {
    return {
      text: existingText,
      error: `client "${name}" already exists (use --force to replace)`,
    };
  }
  const record: Record<string, unknown> = { tokenSha256: entry.tokenSha256.toLowerCase() };
  if (entry.models !== undefined) record.models = entry.models;
  if (entry.accounts !== undefined) record.accounts = entry.accounts;
  parsed.map[name] = record;
  return { text: `${JSON.stringify(parsed.map, null, 2)}\n`, error: null };
}

export function removeClientEntry(existingText: string, name: string): ClientsFileWriteResult {
  const parsed = parseRawClientsMap(existingText);
  if ("error" in parsed) return { text: existingText, error: parsed.error };
  if (!(name in parsed.map)) return { text: existingText, error: `client "${name}" not found` };
  delete parsed.map[name];
  return { text: `${JSON.stringify(parsed.map, null, 2)}\n`, error: null };
}
