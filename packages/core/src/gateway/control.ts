// Pure control-plane domain for the gateway app (ADR-0010).
// No I/O: callers fetch facts (processes, HTTP payloads, files) and pass them in.

export const MIN_OMP_VERSION: readonly [number, number, number] = [18, 16, 0];

// ---------------------------------------------------------------- version

export function parseOmpVersion(text: string): [number, number, number] | null {
  const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function versionAtLeast(
  version: readonly [number, number, number],
  floor: readonly [number, number, number],
): boolean {
  for (let i = 0; i < 3; i++) {
    if ((version[i] ?? 0) !== (floor[i] ?? 0)) return (version[i] ?? 0) > (floor[i] ?? 0);
  }
  return true;
}

// ----------------------------------------------------------------- doctor

export type EndpointHealth = "ok" | "down" | "unknown";

export interface DoctorFacts {
  ompPath: string | null;
  versionText: string | null;
  brokerHelp: string | null;
  gatewayHelp: string | null;
  brokerTokenPresent: boolean;
  gatewayTokenPresent: boolean;
  brokerHealth: EndpointHealth;
  gatewayHealth: EndpointHealth;
  /** Full command line of a running auth-gateway serve process, if any. */
  gatewayArgv: string | null;
  expectedGatewayBind: string;
  expectedClientsPath: string;
  requireRunning: boolean;
}

export interface DoctorCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

export function evaluateDoctorChecks(facts: DoctorFacts): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const pass = (id: string, detail: string) => checks.push({ id, status: "pass", detail });
  const warn = (id: string, detail: string) => checks.push({ id, status: "warn", detail });
  const fail = (id: string, detail: string) => checks.push({ id, status: "fail", detail });

  if (!facts.ompPath) {
    fail("omp-binary", "omp not found on PATH; install Oh My Pi >= 18.16.0 first");
    fail("omp-version", "cannot check version without the omp binary");
    fail("broker-capabilities", "cannot check auth-broker without the omp binary");
    fail("gateway-capabilities", "cannot check auth-gateway without the omp binary");
  } else {
    pass("omp-binary", facts.ompPath);
    const parsed = facts.versionText ? parseOmpVersion(facts.versionText) : null;
    if (!parsed)
      fail("omp-version", `could not parse version from: ${facts.versionText ?? "no output"}`);
    else if (!versionAtLeast(parsed, MIN_OMP_VERSION))
      fail(
        "omp-version",
        `omp ${parsed.join(".")} is below the verified floor ${MIN_OMP_VERSION.join(".")}; upgrade omp`,
      );
    else pass("omp-version", `omp ${parsed.join(".")}`);

    const brokerOk =
      facts.brokerHelp !== null &&
      ["serve", "token", "status", "list"].every((a) => facts.brokerHelp?.includes(a));
    if (brokerOk) pass("broker-capabilities", "auth-broker serve/token/status/list present");
    else
      fail(
        "broker-capabilities",
        "omp auth-broker is missing serve/token/status/list; upgrade omp",
      );

    const gatewayOk =
      facts.gatewayHelp !== null &&
      ["serve", "stdio", "token", "status", "check", "--clients"].every((a) =>
        facts.gatewayHelp?.includes(a),
      );
    if (gatewayOk)
      pass("gateway-capabilities", "auth-gateway serve/token/status/check + --clients present");
    else
      fail(
        "gateway-capabilities",
        "omp auth-gateway is missing serve/token/status/check or --clients; upgrade omp",
      );
  }

  if (facts.brokerTokenPresent && facts.gatewayTokenPresent)
    pass("token-files", "broker and gateway token files are readable (values not shown)");
  else
    fail(
      "token-files",
      `missing token file(s):${facts.brokerTokenPresent ? "" : " auth-broker.token"}${facts.gatewayTokenPresent ? "" : " auth-gateway.token"}; start the broker/gateway once via omp to create them`,
    );

  const healthCheck = (id: string, label: string, state: EndpointHealth) => {
    if (state === "ok") pass(id, `${label} healthy`);
    else if (facts.requireRunning) fail(id, `${label} not reachable; run: gateway:ctl start`);
    else warn(id, `${label} not running; start will launch it`);
  };
  healthCheck("broker-health", "broker", facts.brokerHealth);
  healthCheck("gateway-health", "gateway", facts.gatewayHealth);

  if (facts.gatewayArgv === null) {
    pass("gateway-argv", "no running gateway process to drift-check");
  } else {
    const argv = normalizePath(facts.gatewayArgv);
    const bindOk = argv.includes(`--bind=${facts.expectedGatewayBind.toLowerCase()}`);
    const clientsOk = argv.includes(`--clients=${normalizePath(facts.expectedClientsPath)}`);
    if (bindOk && clientsOk)
      pass("gateway-argv", "running gateway bind and --clients match the expected deployment");
    else
      fail(
        "gateway-argv",
        `running gateway drift:${bindOk ? "" : ` bind is not ${facts.expectedGatewayBind};`}${clientsOk ? "" : ` --clients does not point at ${facts.expectedClientsPath};`} scoped client tokens will not work until it is restarted by the daemon manager`,
      );
  }

  return checks;
}

export function doctorPassed(checks: readonly DoctorCheck[]): boolean {
  return checks.every((c) => c.status !== "fail");
}

// --------------------------------------------------------------- identities

export function maskIdentityKey(identity: string): string {
  const colon = identity.indexOf(":");
  const hasPrefix = colon > 0 && !identity.slice(0, colon).includes("@");
  const prefix = hasPrefix ? identity.slice(0, colon) : null;
  const value = hasPrefix ? identity.slice(colon + 1) : identity;
  const maskedValue = maskValue(value);
  return prefix ? `${prefix}:${maskedValue}` : maskedValue;
}

function maskValue(value: string): string {
  const at = value.indexOf("@");
  if (at > 0) {
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    const dot = domain.lastIndexOf(".");
    const host = dot > 0 ? domain.slice(0, dot) : domain;
    const tld = dot > 0 ? domain.slice(dot) : "";
    return `${local.slice(0, 1)}***@${host.slice(0, 1)}***${tld}`;
  }
  return `${value.slice(0, 3)}***`;
}

export function emailFromIdentityKey(identityKey: string | null | undefined): string | null {
  if (!identityKey) return null;
  const value = identityKey.includes(":")
    ? identityKey.slice(identityKey.indexOf(":") + 1)
    : identityKey;
  return value.includes("@") ? value.toLowerCase() : null;
}

// ------------------------------------------------------------------- views

export interface SnapshotBlockLike {
  providerKey: string;
  blockScope: string;
  blockedUntilMs: number;
}

export interface SnapshotEntryLike {
  id: number;
  provider: string;
  identityKey?: string | null;
  blocks?: SnapshotBlockLike[];
}

export interface CredentialCheckLike {
  id: number;
  provider: string;
  ok?: boolean;
}

export interface UsageLimitLike {
  id?: string;
  label?: string;
  status?: string;
  amount?: { remainingFraction?: number; usedFraction?: number };
  window?: { label?: string; resetsAt?: number };
}

export interface UsageReportLike {
  provider: string;
  metadata?: { email?: string };
  limits?: UsageLimitLike[];
}

export interface AccountBlockView {
  scope: string;
  blockedUntilMs: number;
}

export interface AccountLimitView {
  label: string;
  windowLabel: string | null;
  status: string;
  remainingFraction: number | null;
  resetsAtMs: number | null;
}

export interface AccountPolicyView {
  priority: number | null;
  reservePct: number | null;
  drained: boolean;
}

export interface AccountView {
  id: number;
  provider: string;
  identityMasked: string;
  ok: boolean | null;
  blocked: boolean;
  blocks: AccountBlockView[];
  limits: AccountLimitView[];
  earliestResetMs: number | null;
  policy: AccountPolicyView | null;
}

export interface AccountPolicyLike {
  provider?: string;
  account?: { email?: string; accountId?: string; projectId?: string };
  reservePct?: number;
  priority?: number;
  [key: string]: unknown;
}

export interface BuildAccountViewsInput {
  nowMs: number;
  snapshot: readonly SnapshotEntryLike[];
  checks: readonly CredentialCheckLike[];
  usage: readonly UsageReportLike[];
  policies?: readonly AccountPolicyLike[];
  provider?: string;
}

export function buildAccountViews(input: BuildAccountViewsInput): AccountView[] {
  const provider = input.provider ?? "google-antigravity";
  const checkById = new Map(input.checks.map((c) => [c.id, c]));
  const usageByEmail = new Map<string, UsageReportLike>();
  for (const report of input.usage) {
    const email = report.metadata?.email?.toLowerCase();
    if (report.provider === provider && email) usageByEmail.set(email, report);
  }
  const policyByEmail = new Map<string, AccountPolicyLike>();
  for (const policy of input.policies ?? []) {
    const email = policy.account?.email?.toLowerCase();
    if ((policy.provider ?? provider) === provider && email) policyByEmail.set(email, policy);
  }

  return input.snapshot
    .filter((entry) => entry.provider === provider)
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((entry) => {
      const activeBlocks = (entry.blocks ?? [])
        .filter((b) => b.blockedUntilMs > input.nowMs)
        .map((b) => ({ scope: b.blockScope, blockedUntilMs: b.blockedUntilMs }));
      const email = emailFromIdentityKey(entry.identityKey);
      const report = email ? usageByEmail.get(email) : undefined;
      const limits: AccountLimitView[] = (report?.limits ?? []).map((limit) => ({
        label: limit.label ?? limit.id ?? "limit",
        windowLabel: limit.window?.label ?? null,
        status: limit.status ?? "unknown",
        remainingFraction:
          typeof limit.amount?.remainingFraction === "number"
            ? limit.amount.remainingFraction
            : null,
        resetsAtMs: typeof limit.window?.resetsAt === "number" ? limit.window.resetsAt : null,
      }));

      const resetCandidates: number[] = activeBlocks.map((b) => b.blockedUntilMs);
      for (const limit of limits) {
        if (limit.remainingFraction === 0 && limit.resetsAtMs !== null)
          resetCandidates.push(limit.resetsAtMs);
      }

      return {
        id: entry.id,
        provider: entry.provider,
        identityMasked: entry.identityKey
          ? maskIdentityKey(entry.identityKey)
          : `(credential ${entry.id})`,
        ok: checkById.get(entry.id)?.ok ?? null,
        blocked: activeBlocks.length > 0,
        blocks: activeBlocks,
        limits,
        earliestResetMs: resetCandidates.length ? Math.min(...resetCandidates) : null,
        policy: (() => {
          const policy = email ? policyByEmail.get(email) : undefined;
          if (!policy) return null;
          return {
            priority: typeof policy.priority === "number" ? policy.priority : null,
            reservePct: typeof policy.reservePct === "number" ? policy.reservePct : null,
            drained: (policy.reservePct ?? 0) >= 100,
          };
        })(),
      };
    });
}

export function earliestResetMs(accounts: readonly AccountView[]): number | null {
  let min: number | null = null;
  for (const account of accounts) {
    if (account.earliestResetMs === null) continue;
    min = min === null ? account.earliestResetMs : Math.min(min, account.earliestResetMs);
  }
  return min;
}

export interface PoolView {
  total: number;
  blocked: number;
  available: number;
  exhausted: boolean;
  earliestResetMs: number | null;
}

export function buildPoolView(accounts: readonly AccountView[]): PoolView {
  const blocked = accounts.filter((a) => a.blocked).length;
  return {
    total: accounts.length,
    blocked,
    available: accounts.length - blocked,
    exhausted: accounts.length > 0 && blocked === accounts.length,
    earliestResetMs: earliestResetMs(accounts),
  };
}

// ----------------------------------------------------------------- clients

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

// ------------------------------------------------------------------ sticky

export interface StickyRowLike {
  key: string;
  value: string;
}

export interface StickySummaryEntry {
  credentialId: number;
  sessions: number;
}

export function summarizeSticky(
  rows: readonly StickyRowLike[],
  provider: string,
): StickySummaryEntry[] {
  const counts = new Map<number, number>();
  const prefix = `session:sticky:${provider}:`;
  for (const row of rows) {
    if (!row.key.startsWith(prefix)) continue;
    let id: number | null = null;
    const raw = row.value.trim();
    if (/^\d+$/.test(raw)) id = Number(raw);
    else {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === "number") id = parsed;
        else if (typeof parsed === "object" && parsed !== null) {
          const rec = parsed as Record<string, unknown>;
          const candidate = rec.id ?? rec.credentialId ?? rec.rowId;
          if (typeof candidate === "number") id = candidate;
        }
      } catch {
        id = null;
      }
    }
    if (id === null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([credentialId, sessions]) => ({ credentialId, sessions }))
    .sort((a, b) => b.sessions - a.sessions || a.credentialId - b.credentialId);
}

// ------------------------------------------------------------------ writes

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

export interface PolicyUpsertInput {
  provider: string;
  email: string;
  priority?: number;
  reservePct?: number;
}

export function upsertAccountPolicy(
  policies: readonly AccountPolicyLike[],
  input: PolicyUpsertInput,
): { policies: AccountPolicyLike[]; prior: AccountPolicyLike | null } {
  const email = input.email.toLowerCase();
  let prior: AccountPolicyLike | null = null;
  const next = policies.map((policy) => {
    if (
      (policy.provider ?? "") === input.provider &&
      policy.account?.email?.toLowerCase() === email
    ) {
      prior = policy;
      return {
        ...policy,
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.reservePct !== undefined ? { reservePct: input.reservePct } : {}),
      };
    }
    return policy;
  });
  if (prior === null) {
    next.push({
      provider: input.provider,
      account: { email: input.email },
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.reservePct !== undefined ? { reservePct: input.reservePct } : {}),
    });
  }
  return { policies: next, prior };
}

export function removeAccountPolicy(
  policies: readonly AccountPolicyLike[],
  provider: string,
  email: string,
): AccountPolicyLike[] {
  const lower = email.toLowerCase();
  return policies.filter(
    (p) => !((p.provider ?? "") === provider && p.account?.email?.toLowerCase() === lower),
  );
}

export const MIN_BLOCK_SECONDS = 5;
export const MAX_BLOCK_SECONDS = 86_400;

/** Operator blocks always expire; permanent blocks are drains (policies). */
export function computeBlockedUntil(nowMs: number, durationSeconds: number): number | null {
  if (!Number.isFinite(durationSeconds)) return null;
  if (durationSeconds < MIN_BLOCK_SECONDS || durationSeconds > MAX_BLOCK_SECONDS) return null;
  return nowMs + Math.round(durationSeconds) * 1_000;
}
