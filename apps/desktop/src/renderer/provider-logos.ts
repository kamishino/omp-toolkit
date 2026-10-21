export interface ProviderLogo {
  light: string;
  dark?: string;
}

const PROVIDER_LOGOS: Record<string, ProviderLogo> = {
  "google-antigravity": { light: "google-gemini.svg" },
  "openai-codex": { light: "openai-light.svg", dark: "openai-dark.svg" },
  deepseek: { light: "deepseek.svg" },
};

export function providerLogo(providerId: string): ProviderLogo | null {
  return PROVIDER_LOGOS[providerId] ?? null;
}
