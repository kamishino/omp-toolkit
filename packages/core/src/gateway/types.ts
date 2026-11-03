export interface CloudflareAccessCredentials {
  clientId: string;
  clientSecret: string;
  domain: string;
}

export type ClientRecipePlatform =
  | "curl"
  | "python-openai"
  | "python-anthropic"
  | "vscode-continue"
  | "claude-code"
  | "opencode";

export interface ClientRecipe {
  platform: ClientRecipePlatform;
  title: string;
  snippet: string;
}

export interface RecipeOptions {
  domain: string;
  gatewayToken: string;
  cfClientId?: string;
  cfClientSecret?: string;
  model?: string;
  /** Full gateway base URL (e.g. http://127.0.0.1:4000). Overrides https://<domain>. */
  baseUrl?: string;
}
