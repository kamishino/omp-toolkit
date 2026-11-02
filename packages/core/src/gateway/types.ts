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
