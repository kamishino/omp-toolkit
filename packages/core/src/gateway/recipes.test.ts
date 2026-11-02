import { describe, expect, test } from "bun:test";
import {
  generateClientPack,
  generateClientRecipe,
  generateClientToken,
  hashClientToken,
} from "./recipes";

describe("generateClientRecipe", () => {
  const optionsWithCf = {
    domain: "gateway.example.com",
    gatewayToken: "test-gateway-token",
    cfClientId: "test-client-id.access",
    cfClientSecret: "test-client-secret",
    model: "google-antigravity/gemini-3.8-flash",
  };

  const optionsWithoutCf = {
    domain: "gateway.example.com",
    gatewayToken: "test-gateway-token",
    model: "google-antigravity/gemini-3.8-flash",
  };

  test("generates cURL recipe with Cloudflare Access headers", () => {
    const recipe = generateClientRecipe("curl", optionsWithCf);
    expect(recipe.platform).toBe("curl");
    expect(recipe.snippet).toContain("https://gateway.example.com/v1/chat/completions");
    expect(recipe.snippet).toContain("CF-Access-Client-Id: test-client-id.access");
    expect(recipe.snippet).toContain("CF-Access-Client-Secret: test-client-secret");
    expect(recipe.snippet).toContain("Authorization: Bearer test-gateway-token");
  });

  test("generates cURL recipe without Cloudflare Access headers", () => {
    const recipe = generateClientRecipe("curl", optionsWithoutCf);
    expect(recipe.snippet).not.toContain("CF-Access-Client-Id");
    expect(recipe.snippet).not.toContain("CF-Access-Client-Secret");
    expect(recipe.snippet).toContain("Authorization: Bearer test-gateway-token");
  });

  test("generates Python OpenAI SDK recipe with default_headers", () => {
    const recipe = generateClientRecipe("python-openai", optionsWithCf);
    expect(recipe.platform).toBe("python-openai");
    expect(recipe.snippet).toContain('base_url="https://gateway.example.com/v1"');
    expect(recipe.snippet).toContain('api_key="test-gateway-token"');
    expect(recipe.snippet).toContain('"CF-Access-Client-Id": "test-client-id.access"');
    expect(recipe.snippet).toContain('"CF-Access-Client-Secret": "test-client-secret"');
  });

  test("generates Python OpenAI SDK recipe without default_headers when CF omitted", () => {
    const recipe = generateClientRecipe("python-openai", optionsWithoutCf);
    expect(recipe.snippet).not.toContain("default_headers");
  });

  test("generates Python Anthropic SDK recipe", () => {
    const recipe = generateClientRecipe("python-anthropic", optionsWithCf);
    expect(recipe.platform).toBe("python-anthropic");
    expect(recipe.snippet).toContain('base_url="https://gateway.example.com"');
    expect(recipe.snippet).toContain('api_key="test-gateway-token"');
    expect(recipe.snippet).toContain('"CF-Access-Client-Id": "test-client-id.access"');
  });

  test("generates VS Code Continue / Cline config JSON", () => {
    const recipe = generateClientRecipe("vscode-continue", optionsWithCf);
    expect(recipe.platform).toBe("vscode-continue");
    expect(recipe.snippet).toContain('"apiBase": "https://gateway.example.com/v1"');
    expect(recipe.snippet).toContain('"apiKey": "test-gateway-token"');
    expect(recipe.snippet).toContain('"CF-Access-Client-Id": "test-client-id.access"');
  });

  test("uses fallback defaults when token or domain is empty", () => {
    const recipe = generateClientRecipe("curl", {
      domain: "",
      gatewayToken: "",
    });
    expect(recipe.snippet).toContain("https://gateway.example.com/v1/chat/completions");
    expect(recipe.snippet).toContain("<YOUR_OMP_GATEWAY_TOKEN>");
  });
});

describe("Client Token Security & Hashing (Slice 1)", () => {
  test("hashClientToken computes valid SHA-256 hex digest", () => {
    const digest = hashClientToken("test-token");
    expect(digest).toBe("4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e");
  });

  test("generateClientToken produces secure token with omp_gw_ prefix", () => {
    const token1 = generateClientToken();
    const token2 = generateClientToken();
    expect(token1).toMatch(/^omp_gw_[0-9a-f]{32,}$/);
    expect(token2).toMatch(/^omp_gw_[0-9a-f]{32,}$/);
    expect(token1).not.toBe(token2);
  });
});

describe("Multi-PC Zero-Leak Client Pack Generator (Slice 2)", () => {
  const packOptions = {
    clientName: "laptop-air",
    domain: "gateway.example.com",
    gatewayToken: "omp_gw_test_token_12345",
    cfClientId: "test-cf-id.access",
    cfClientSecret: "test-cf-secret-xyz",
    model: "google-antigravity/gemini-3.8-flash",
    allowedModels: ["google-antigravity/*", "deepseek/*"],
  };

  test("generates complete client pack with all integration targets", () => {
    const pack = generateClientPack(packOptions);
    expect(pack.clientName).toBe("laptop-air");
    expect(pack.bearerToken).toBe("omp_gw_test_token_12345");

    // Bash env script
    expect(pack.envScriptBash).toContain('export OPENAI_BASE_URL="https://gateway.example.com/v1"');
    expect(pack.envScriptBash).toContain('export OPENAI_API_KEY="omp_gw_test_token_12345"');
    expect(pack.envScriptBash).toContain('export CF_ACCESS_CLIENT_ID="test-cf-id.access"');
    expect(pack.envScriptBash).toContain('export CF_ACCESS_CLIENT_SECRET="test-cf-secret-xyz"');

    // PowerShell env script
    expect(pack.envScriptPs1).toContain('$env:OPENAI_BASE_URL = "https://gateway.example.com/v1"');
    expect(pack.envScriptPs1).toContain('$env:OPENAI_API_KEY = "omp_gw_test_token_12345"');
    expect(pack.envScriptPs1).toContain('$env:CF_ACCESS_CLIENT_ID = "test-cf-id.access"');
    expect(pack.envScriptPs1).toContain('$env:CF_ACCESS_CLIENT_SECRET = "test-cf-secret-xyz"');

    // VS Code Continue JSON
    const continueParsed = JSON.parse(pack.continueConfigJson);
    expect(continueParsed.models[0].apiBase).toBe("https://gateway.example.com/v1");
    expect(continueParsed.models[0].apiKey).toBe("omp_gw_test_token_12345");
    expect(continueParsed.models[0].requestOptions.headers["CF-Access-Client-Id"]).toBe(
      "test-cf-id.access",
    );

    // OMP custom provider JSON
    const ompParsed = JSON.parse(pack.ompProviderConfigJson);
    expect(ompParsed.baseUrl).toBe("https://gateway.example.com/v1");
    expect(ompParsed.apiKey).toBe("omp_gw_test_token_12345");
    expect(ompParsed.headers["CF-Access-Client-Id"]).toBe("test-cf-id.access");

    // cURL snippet
    expect(pack.curlSnippet).toContain("https://gateway.example.com/v1/chat/completions");
    expect(pack.curlSnippet).toContain("Authorization: Bearer omp_gw_test_token_12345");
  });

  test("zero leakage: pack contains no raw provider secrets or master keys", () => {
    const pack = generateClientPack(packOptions);
    const combined = JSON.stringify(pack);
    expect(combined).not.toContain("sk-proj");
    expect(combined).not.toContain("AIzaSy");
    expect(combined).not.toContain("refresh_token");
    expect(combined).not.toContain("agent.db");
  });
});
