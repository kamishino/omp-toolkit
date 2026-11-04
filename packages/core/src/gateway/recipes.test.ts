import { describe, expect, test } from "bun:test";
import { generateClientRecipe } from "./recipes";

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

  test("generates Muse loopback recipe with a tool-safe default model", () => {
    const recipe = generateClientRecipe("claude-code", {
      domain: "",
      gatewayToken: "tok123",
      baseUrl: "http://127.0.0.1:4000",
    });
    expect(recipe.snippet).toContain('ANTHROPIC_BASE_URL = "http://127.0.0.1:4000"');
    expect(recipe.snippet).toContain("google-antigravity/gemini-3.8-flash");
    expect(recipe.snippet).toContain("ANTHROPIC_AUTH_TOKEN");
  });

  test("generates OpenCode loopback provider config", () => {
    const recipe = generateClientRecipe("opencode", {
      domain: "",
      gatewayToken: "tok123",
      baseUrl: "http://127.0.0.1:4000",
      model: "google-antigravity/gemini-2.5-flash",
    });
    const parsed = JSON.parse(recipe.snippet) as {
      model: string;
      provider: Record<string, { options: { baseURL: string } }>;
    };
    expect(parsed.model).toBe("omp-gateway/google-antigravity/gemini-2.5-flash");
    expect(parsed.provider["omp-gateway"]?.options.baseURL).toBe("http://127.0.0.1:4000/v1");
  });

  test("generates Codex Responses provider TOML", () => {
    const recipe = generateClientRecipe("codex", {
      domain: "",
      gatewayToken: "tok123",
      baseUrl: "http://127.0.0.1:4000",
      model: "google-antigravity/claude-sonnet-4-6",
    });
    expect(recipe.snippet).toContain('wire_api = "responses"');
    expect(recipe.snippet).toContain('base_url = "http://127.0.0.1:4000/v1"');
    expect(recipe.snippet).toContain("claude-sonnet-4-6");
  });

  test("generates pi, cline, aider, goose, crush, qwen, hermes, and dsh recipes", () => {
    const opts = { domain: "", gatewayToken: "tok123", baseUrl: "http://127.0.0.1:4000" };
    expect(generateClientRecipe("pi", opts).snippet).toContain('"api": "openai-completions"');
    expect(generateClientRecipe("cline", opts).snippet).toContain("cline auth openai");
    expect(generateClientRecipe("aider", opts).snippet).toContain(
      "model: openai/google-antigravity/gemini-3.8-flash",
    );
    expect(generateClientRecipe("goose", opts).snippet).toContain("OPENAI_BASE_PATH");
    expect(
      JSON.parse(generateClientRecipe("crush", opts).snippet).providers["omp-gateway"].type,
    ).toBe("openai-compat");
    expect(generateClientRecipe("qwen-code", opts).snippet).toContain("OPENAI_BASE_URL");
    expect(generateClientRecipe("hermes", opts).snippet).toContain('provider: "custom"');
    expect(generateClientRecipe("dsh", opts).snippet).toContain("apiKeyEnv: OMP_GATEWAY_TOKEN");
  });

  test("baseUrl overrides the https domain in curl recipes", () => {
    const recipe = generateClientRecipe("curl", {
      domain: "gateway.example.com",
      gatewayToken: "tok123",
      baseUrl: "http://127.0.0.1:4000",
    });
    expect(recipe.snippet).toContain("http://127.0.0.1:4000/v1/chat/completions");
  });
});
