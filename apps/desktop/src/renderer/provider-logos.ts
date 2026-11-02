export interface ProviderLogo {
  light: string;
  dark?: string;
}

// Vendored offline from @lobehub/icons-static-svg@1.102.0 (MIT), except
// muse-code.svg which predates the set. See assets/providers/SOURCES.md.
// Color marks ship one file; mono glyphs ship a #000/#fff light/dark pair.
const PROVIDER_LOGOS: Record<string, ProviderLogo> = {
  "google-antigravity": { light: "google-gemini.svg" },
  "openai-codex": { light: "openai-light.svg", dark: "openai-dark.svg" },
  deepseek: { light: "deepseek.svg" },
  "muse-code": { light: "muse-code.svg" },
  anthropic: { light: "anthropic-light.svg", dark: "anthropic-dark.svg" },
  claude: { light: "claude.svg" },
  mistral: { light: "mistral.svg" },
  xai: { light: "xai-light.svg", dark: "xai-dark.svg" },
  grok: { light: "grok-light.svg", dark: "grok-dark.svg" },
  meta: { light: "meta.svg" },
  cohere: { light: "cohere.svg" },
  perplexity: { light: "perplexity.svg" },
  groq: { light: "groq-light.svg", dark: "groq-dark.svg" },
  qwen: { light: "qwen.svg" },
  ollama: { light: "ollama-light.svg", dark: "ollama-dark.svg" },
  openrouter: { light: "openrouter-light.svg", dark: "openrouter-dark.svg" },
};

export function providerLogo(providerId: string): ProviderLogo | null {
  return PROVIDER_LOGOS[providerId] ?? null;
}
