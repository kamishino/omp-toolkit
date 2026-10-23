import { describe, expect, test } from "bun:test";
import {
  GOOGLE_ANTIGRAVITY_ADAPTER,
  getAllUsageProviderAdapters,
  getUsageProviderAdapter,
  registerUsageProviderAdapter,
  type UsageProviderAdapter,
} from "./usage-providers";

describe("UsageProviderRegistry", () => {
  test("contains built-in adapters with display names", () => {
    const google = getUsageProviderAdapter("google-antigravity");
    expect(google).toBeDefined();
    expect(google?.displayName).toBe("GOOGLE ANTIGRAVITY");
    expect(google?.shortName).toBe("antigravity");

    const deepseek = getUsageProviderAdapter("deepseek");
    expect(deepseek).toBeDefined();
    expect(deepseek?.displayName).toBe("DEEPSEEK");

    const codex = getUsageProviderAdapter("openai-codex");
    expect(codex).toBeDefined();
    expect(codex?.shortName).toBe("codex");

    const muse = getUsageProviderAdapter("muse-code");
    expect(muse).toBeDefined();
    expect(muse?.shortName).toBe("muse");
  });

  test("google-antigravity adapter filters out non-Gemini limits", () => {
    expect(
      GOOGLE_ANTIGRAVITY_ADAPTER.filterLimit?.({
        id: "gemini-weekly",
        label: "Gemini",
      }),
    ).toBe(true);

    expect(
      GOOGLE_ANTIGRAVITY_ADAPTER.filterLimit?.({
        id: "claude-weekly",
        label: "Claude Sonnet",
      }),
    ).toBe(false);
  });

  test("allows registering and retrieving custom provider adapters", () => {
    const customAdapter: UsageProviderAdapter = {
      provider: "anthropic",
      displayName: "ANTHROPIC",
      shortName: "claude",
      filterLimit: (l) => l.label?.includes("Sonnet") ?? false,
    };

    registerUsageProviderAdapter(customAdapter);
    const retrieved = getUsageProviderAdapter("anthropic");
    expect(retrieved).toEqual(customAdapter);
  });

  test("getAllUsageProviderAdapters returns all registered adapters", () => {
    const all = getAllUsageProviderAdapters();
    expect(all.length).toBeGreaterThanOrEqual(4);
    const providers = all.map((a) => a.provider);
    expect(providers).toContain("google-antigravity");
    expect(providers).toContain("deepseek");
  });
});
