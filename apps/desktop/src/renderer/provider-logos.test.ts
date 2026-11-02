import { describe, expect, test } from "bun:test";
import { providerLogo } from "./provider-logos";

describe("provider-logos mapping", () => {
  test("returns logo mapping for muse-code", () => {
    const logo = providerLogo("muse-code");
    expect(logo).toEqual({ light: "muse-code.svg" });
  });

  test("returns logo mapping for all active providers", () => {
    expect(providerLogo("google-antigravity")).toEqual({ light: "google-gemini.svg" });
    expect(providerLogo("openai-codex")).toEqual({
      light: "openai-light.svg",
      dark: "openai-dark.svg",
    });
    expect(providerLogo("deepseek")).toEqual({ light: "deepseek.svg" });
  });

  test("returns vendored logos for future providers", () => {
    expect(providerLogo("anthropic")).toEqual({
      light: "anthropic-light.svg",
      dark: "anthropic-dark.svg",
    });
    expect(providerLogo("claude")).toEqual({ light: "claude.svg" });
    expect(providerLogo("mistral")).toEqual({ light: "mistral.svg" });
    expect(providerLogo("xai")).toEqual({ light: "xai-light.svg", dark: "xai-dark.svg" });
    expect(providerLogo("grok")).toEqual({ light: "grok-light.svg", dark: "grok-dark.svg" });
    expect(providerLogo("meta")).toEqual({ light: "meta.svg" });
    expect(providerLogo("cohere")).toEqual({ light: "cohere.svg" });
    expect(providerLogo("perplexity")).toEqual({ light: "perplexity.svg" });
    expect(providerLogo("groq")).toEqual({ light: "groq-light.svg", dark: "groq-dark.svg" });
    expect(providerLogo("qwen")).toEqual({ light: "qwen.svg" });
    expect(providerLogo("ollama")).toEqual({ light: "ollama-light.svg", dark: "ollama-dark.svg" });
    expect(providerLogo("openrouter")).toEqual({
      light: "openrouter-light.svg",
      dark: "openrouter-dark.svg",
    });
  });

  test("returns null for unknown provider", () => {
    expect(providerLogo("unknown-provider")).toBeNull();
  });
});
