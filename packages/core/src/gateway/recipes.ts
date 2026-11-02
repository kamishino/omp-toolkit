import { createHash, randomBytes } from "node:crypto";
import type {
  ClientBundle,
  ClientPack,
  ClientPackOptions,
  ClientRecipe,
  ClientRecipePlatform,
  RecipeOptions,
} from "./types";

export function generateClientRecipe(
  platform: ClientRecipePlatform,
  options: RecipeOptions,
): ClientRecipe {
  const domain = options.domain || "gateway.example.com";
  const gatewayToken = options.gatewayToken || "<YOUR_OMP_GATEWAY_TOKEN>";
  const model = options.model || "google-antigravity/gemini-3.8-flash";
  const cfClientId = options.cfClientId;
  const cfClientSecret = options.cfClientSecret;

  const hasCfAccess = Boolean(cfClientId && cfClientSecret);

  switch (platform) {
    case "curl": {
      const headers = [
        hasCfAccess ? `  -H "CF-Access-Client-Id: ${cfClientId}" \\` : null,
        hasCfAccess ? `  -H "CF-Access-Client-Secret: ${cfClientSecret}" \\` : null,
        `  -H "Authorization: Bearer ${gatewayToken}" \\`,
        '  -H "Content-Type: application/json"',
      ]
        .filter(Boolean)
        .join("\n");

      const snippet = `curl -X POST https://${domain}/v1/chat/completions \\
${headers} \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'`;

      return {
        platform: "curl",
        title: "cURL (Bash / Terminal)",
        snippet,
      };
    }

    case "python-openai": {
      const defaultHeaders = hasCfAccess
        ? `\n    default_headers={\n        "CF-Access-Client-Id": "${cfClientId}",\n        "CF-Access-Client-Secret": "${cfClientSecret}",\n    },`
        : "";

      const snippet = `from openai import OpenAI

client = OpenAI(
    base_url="https://${domain}/v1",
    api_key="${gatewayToken}",${defaultHeaders}
)

response = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True,
)
for chunk in response:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`;

      return {
        platform: "python-openai",
        title: "Python (OpenAI SDK)",
        snippet,
      };
    }

    case "python-anthropic": {
      const defaultHeaders = hasCfAccess
        ? `\n    default_headers={\n        "CF-Access-Client-Id": "${cfClientId}",\n        "CF-Access-Client-Secret": "${cfClientSecret}",\n    },`
        : "";

      const snippet = `import anthropic

client = anthropic.Anthropic(
    base_url="https://${domain}",
    api_key="${gatewayToken}",${defaultHeaders}
)

message = client.messages.create(
    model="${model}",
    max_tokens=1000,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)`;

      return {
        platform: "python-anthropic",
        title: "Python (Anthropic SDK)",
        snippet,
      };
    }

    case "vscode-continue": {
      const extraHeaders = hasCfAccess
        ? `,\n      "requestOptions": {\n        "extraHeaders": {\n          "CF-Access-Client-Id": "${cfClientId}",\n          "CF-Access-Client-Secret": "${cfClientSecret}"\n        }\n      }`
        : "";

      const snippet = `{
  "models": [
    {
      "title": "${model} (OMP Gateway)",
      "provider": "openai",
      "model": "${model}",
      "apiBase": "https://${domain}/v1",
      "apiKey": "${gatewayToken}"${extraHeaders}
    }
  ]
}`;

      return {
        platform: "vscode-continue",
        title: "VS Code Extensions (Continue / Cline config.json)",
        snippet,
      };
    }
  }
}

/**
 * Generates a high-entropy bearer token for gateway clients.
 */
export function generateClientToken(): string {
  return `omp_gw_${randomBytes(24).toString("hex")}`;
}

/**
 * Computes the SHA-256 hex digest of a client token for storage in gateway-clients.json.
 */
export function hashClientToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generates a complete, zero-leak client configuration pack for secondary PCs.
 */
export function generateClientPack(options: ClientPackOptions): ClientPack {
  const domain = options.domain || "gateway.example.com";
  const bearerToken = options.gatewayToken || generateClientToken();
  const model = options.model || "google-antigravity/gemini-3.8-flash";
  const cfClientId = options.cfClientId ?? "";
  const cfClientSecret = options.cfClientSecret ?? "";
  const hasCf = Boolean(cfClientId && cfClientSecret);

  // 1. Bash env script
  const envScriptBash = [
    `# Client Environment Configuration for ${options.clientName}`,
    `export OPENAI_BASE_URL="https://${domain}/v1"`,
    `export OPENAI_API_KEY="${bearerToken}"`,
    hasCf ? `export CF_ACCESS_CLIENT_ID="${cfClientId}"` : null,
    hasCf ? `export CF_ACCESS_CLIENT_SECRET="${cfClientSecret}"` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // 2. PowerShell env script
  const envScriptPs1 = [
    `# Client Environment Configuration for ${options.clientName}`,
    `$env:OPENAI_BASE_URL = "https://${domain}/v1"`,
    `$env:OPENAI_API_KEY = "${bearerToken}"`,
    hasCf ? `$env:CF_ACCESS_CLIENT_ID = "${cfClientId}"` : null,
    hasCf ? `$env:CF_ACCESS_CLIENT_SECRET = "${cfClientSecret}"` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // 3. VS Code Continue config JSON
  const continueHeaders: Record<string, string> = {};
  if (hasCf) {
    continueHeaders["CF-Access-Client-Id"] = cfClientId;
    continueHeaders["CF-Access-Client-Secret"] = cfClientSecret;
  }
  const continueConfig = {
    models: [
      {
        title: `${model} (OMP Gateway)`,
        provider: "openai",
        model,
        apiBase: `https://${domain}/v1`,
        apiKey: bearerToken,
        requestOptions: {
          headers: continueHeaders,
        },
      },
    ],
  };

  // 4. OMP custom provider JSON
  const ompHeaders: Record<string, string> = {
    Authorization: `Bearer ${bearerToken}`,
  };
  if (hasCf) {
    ompHeaders["CF-Access-Client-Id"] = cfClientId;
    ompHeaders["CF-Access-Client-Secret"] = cfClientSecret;
  }
  const ompProviderConfig = {
    id: "omp-gateway",
    name: "OMP Remote Gateway",
    baseUrl: `https://${domain}/v1`,
    apiKey: bearerToken,
    headers: ompHeaders,
    models: options.allowedModels ?? [model],
  };

  // 5. cURL snippet
  const curlRecipe = generateClientRecipe("curl", {
    domain,
    gatewayToken: bearerToken,
    cfClientId,
    cfClientSecret,
    model,
  });

  return {
    clientName: options.clientName,
    bearerToken,
    envScriptBash,
    envScriptPs1,
    continueConfigJson: JSON.stringify(continueConfig, null, 2),
    ompProviderConfigJson: JSON.stringify(ompProviderConfig, null, 2),
    curlSnippet: curlRecipe.snippet,
  };
}

/**
 * Generates 1-click self-installing onboarding scripts for secondary PCs.
 */
export function exportClientBundle(options: ClientPackOptions): ClientBundle {
  const pack = generateClientPack(options);
  const domain = options.domain || "gateway.example.com";
  const token = pack.bearerToken;
  const cid = options.cfClientId ?? "";
  const sec = options.cfClientSecret ?? "";
  const hasCf = Boolean(cid && sec);

  const scriptPs1 = [
    `# OMP Gateway 1-Click Client Onboarding Script (Windows)`,
    `# Target Client: ${options.clientName}`,
    `Write-Host "Configuring OMP Gateway client for ${options.clientName}..." -ForegroundColor Cyan`,
    `[Environment]::SetEnvironmentVariable("OPENAI_BASE_URL", "https://${domain}/v1", "User")`,
    `[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "${token}", "User")`,
    hasCf ? `[Environment]::SetEnvironmentVariable("CF_ACCESS_CLIENT_ID", "${cid}", "User")` : null,
    hasCf
      ? `[Environment]::SetEnvironmentVariable("CF_ACCESS_CLIENT_SECRET", "${sec}", "User")`
      : null,
    `$env:OPENAI_BASE_URL = "https://${domain}/v1"`,
    `$env:OPENAI_API_KEY = "${token}"`,
    hasCf ? `$env:CF_ACCESS_CLIENT_ID = "${cid}"` : null,
    hasCf ? `$env:CF_ACCESS_CLIENT_SECRET = "${sec}"` : null,
    `Write-Host "Environment variables configured persistently for current user." -ForegroundColor Green`,
  ]
    .filter(Boolean)
    .join("\n");

  const scriptSh = [
    `#!/usr/bin/env bash`,
    `# OMP Gateway 1-Click Client Onboarding Script (macOS / Linux)`,
    `# Target Client: ${options.clientName}`,
    `echo "Configuring OMP Gateway client for ${options.clientName}..."`,
    `ENV_FILE="$HOME/.bashrc"`,
    `[ -f "$HOME/.zshrc" ] && ENV_FILE="$HOME/.zshrc"`,
    `cat << 'EOF' >> "$ENV_FILE"`,
    `export OPENAI_BASE_URL="https://${domain}/v1"`,
    `export OPENAI_API_KEY="${token}"`,
    hasCf ? `export CF_ACCESS_CLIENT_ID="${cid}"` : null,
    hasCf ? `export CF_ACCESS_CLIENT_SECRET="${sec}"` : null,
    `EOF`,
    `echo "Environment variables appended to $ENV_FILE"`,
  ]
    .filter(Boolean)
    .join("\n");

  return { scriptPs1, scriptSh };
}
