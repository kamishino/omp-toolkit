import type { UsageColumn, UsageLimit } from "./types";

/**
 * Extensible provider adapter interface for usage aggregation,
 * column selection, and provider-specific limit filtering.
 */
export interface UsageProviderAdapter {
  readonly provider: string;
  readonly displayName?: string;
  readonly shortName?: string;
  filterLimit?(limit: UsageLimit): boolean;
  orderColumns?(columns: UsageColumn[]): UsageColumn[];
}

const registry = new Map<string, UsageProviderAdapter>();

// Register default built-in adapters
export const GOOGLE_ANTIGRAVITY_ADAPTER: UsageProviderAdapter = {
  provider: "google-antigravity",
  displayName: "GOOGLE ANTIGRAVITY",
  shortName: "antigravity",
  filterLimit(limit: UsageLimit): boolean {
    return /gemini/i.test(limit.label ?? "") || /gemini/i.test(limit.id ?? "");
  },
};

export const DEEPSEEK_ADAPTER: UsageProviderAdapter = {
  provider: "deepseek",
  displayName: "DEEPSEEK",
  shortName: "deepseek",
};

export const OPENAI_CODEX_ADAPTER: UsageProviderAdapter = {
  provider: "openai-codex",
  displayName: "OPENAI CODEX",
  shortName: "codex",
};

export const MUSE_CODE_ADAPTER: UsageProviderAdapter = {
  provider: "muse-code",
  displayName: "MUSE CODE",
  shortName: "muse",
};

registerUsageProviderAdapter(GOOGLE_ANTIGRAVITY_ADAPTER);
registerUsageProviderAdapter(DEEPSEEK_ADAPTER);
registerUsageProviderAdapter(OPENAI_CODEX_ADAPTER);
registerUsageProviderAdapter(MUSE_CODE_ADAPTER);

export function registerUsageProviderAdapter(adapter: UsageProviderAdapter): void {
  registry.set(adapter.provider, adapter);
}

export function getUsageProviderAdapter(provider: string): UsageProviderAdapter | undefined {
  return registry.get(provider);
}

export function getAllUsageProviderAdapters(): UsageProviderAdapter[] {
  return Array.from(registry.values());
}
