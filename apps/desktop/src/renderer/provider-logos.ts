export interface ProviderLogo {
  light: string;
  dark?: string;
}

// Vendored offline from @lobehub/icons-static-svg@1.102.0 (MIT), except the
// official Meta Muse Code SDK mark and Google Antigravity brand marks.
// See assets/providers/SOURCES.md.
// Marks ship as one color file, an official light/dark pair, or a derived
// #000/#fff mono pair for theme contrast.
const PROVIDER_LOGOS: Record<string, ProviderLogo> = {
  "google-antigravity": { light: "antigravity-color.svg", dark: "antigravity-white.svg" },
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
