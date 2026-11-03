export interface CloudflareAccessCredentials {
  clientId: string;
  clientSecret: string;
  domain: string;
}

export type ClientRecipePlatform =
  | "curl"
  | "python-openai"
  | "python-anthropic"
  | "vscode-continue";

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
}
