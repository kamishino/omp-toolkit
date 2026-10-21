/**
 * Boundary stub for the OMP runtime types.
 *
 * The real interfaces are provided by the OMP host when the extension loads.
 * These declarations cover only the surface this adapter calls, without
 * vendoring OMP internals or disabling type checking with `any`.
 */

declare module "@oh-my-pi/pi-coding-agent" {
  export interface ZodSchema {
    describe(text: string): ZodSchema;
    default(value: unknown): ZodSchema;
  }

  export interface ZodLike {
    boolean(): ZodSchema;
    string(): ZodSchema;
    object(shape: Record<string, ZodSchema>): ZodSchema;
  }

  export interface ExtensionModel {
    provider: string;
    id: string;
  }

  export interface ExtensionModels {
    current(): ExtensionModel | undefined;
  }

  export interface ExtensionUI {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setStatus(key: string, text: string | undefined): void;
    setWidget(
      key: string,
      lines: string[] | undefined,
      options?: { placement?: "aboveEditor" | "belowEditor" },
    ): void;
  }

  export interface ExtensionContext {
    agent: {
      kind: "main" | "sub";
      id: string;
      name: string;
      depth: number;
      parentId?: string;
    };
    mode: "tui" | "rpc" | "json" | "print";
    hasUI: boolean;
    ui: ExtensionUI;
    model?: ExtensionModel;
    models: ExtensionModels;
    setTimeout(callback: () => void, delayMs: number): unknown;
    reload?: () => Promise<void>;
  }

  export interface GeminiHealthToolParams {
    heal?: boolean;
    confirm?: boolean;
  }
  export interface ExtensionFetchResponse {
    ok: boolean;
    json(): Promise<unknown>;
  }

  export interface ExtensionUsageParams {
    credential: { apiKey?: string; email?: string; accountId?: string };
    baseUrl?: string;
    signal?: AbortSignal;
  }

  export interface ExtensionUsageContext {
    fetch(
      input: string,
      init?: { headers?: Record<string, string>; signal?: AbortSignal },
    ): Promise<ExtensionFetchResponse>;
  }

  export interface ExtensionUsageProvider {
    id: string;
    cacheVersion?: number;
    fetchUsage(params: ExtensionUsageParams, ctx: ExtensionUsageContext): Promise<unknown>;
  }

  export interface ExtensionProviderConfig {
    apiKey?: string;
    usage?: ExtensionUsageProvider;
  }

  export interface ExtensionAPI {
    readonly zod: ZodLike;
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown): void;
    registerCommand(
      name: string,
      options: {
        description: string;
        handler: (args: string, ctx: ExtensionContext) => unknown;
      },
    ): void;
    registerTool(options: {
      name: string;
      label: string;
      description: string;
      parameters: ZodSchema;
      loadMode?: string;
      approval?: string;
      execute: (
        id: string,
        params: GeminiHealthToolParams,
        signal: unknown,
        onUpdate: unknown,
        ctx: ExtensionContext,
      ) => unknown;
    }): void;
    sendMessage(
      message: {
        customType: string;
        content: string;
        display?: boolean;
        attribution?: "user" | "agent";
      },
      options?: { triggerTurn?: boolean },
    ): void;
    registerProvider(name: string, config: ExtensionProviderConfig): void;
    unregisterProvider(name: string): void;
  }
}
