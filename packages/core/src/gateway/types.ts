export interface GatewayConfig {
  brokerPort: number;
  gatewayPort: number;
  domain: string;
  trustProxyHeaders: boolean;
}

export interface CloudflareAccessCredentials {
  clientId: string;
  clientSecret: string;
  domain: string;
}

export interface GatewayHealthStatus {
  brokerHealthy: boolean;
  gatewayHealthy: boolean;
  brokerVersion?: string;
  gatewayVersion?: string;
  modelCount?: number;
  tunnelConnected?: boolean;
  accessEnforced?: boolean;
  accessAuthorized?: boolean;
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

export interface GatewayClientEntry {
  tokenSha256: string;
  models?: string[];
  accounts?: Record<string, unknown>;
}

export type GatewayClientsFile = Record<string, GatewayClientEntry>;

export interface ClientPackOptions extends RecipeOptions {
  clientName: string;
  allowedModels?: string[];
}

export interface ClientPack {
  clientName: string;
  bearerToken: string;
  envScriptBash: string;
  envScriptPs1: string;
  continueConfigJson: string;
  ompProviderConfigJson: string;
  curlSnippet: string;
}
