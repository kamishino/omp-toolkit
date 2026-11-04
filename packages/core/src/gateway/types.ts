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
  | "opencode"
  | "codex"
  | "pi"
  | "cline"
  | "aider"
  | "goose"
  | "crush"
  | "qwen-code"
  | "hermes"
  | "dsh";

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

/** Resolved per-recipe inputs: defaults applied, one value per field. */
export interface RecipeContext {
  base: string;
  gatewayToken: string;
  model: string;
  cfClientId?: string;
  cfClientSecret?: string;
  hasCfAccess: boolean;
}
