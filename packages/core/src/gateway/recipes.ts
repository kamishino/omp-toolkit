import type { ClientRecipe, ClientRecipePlatform, RecipeOptions } from "./types";

export function generateClientRecipe(
  platform: ClientRecipePlatform,
  options: RecipeOptions,
): ClientRecipe {
  const domain = options.domain || "gateway.example.com";
  const base = options.baseUrl || `https://${domain}`;
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

      const snippet = `curl -X POST ${base}/v1/chat/completions \\
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
    base_url="${base}/v1",
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
    base_url="${base}",
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
      "apiBase": "${base}/v1",
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

    case "claude-code": {
      // Anthropic-protocol clients must avoid Gemini 2.5 models for tool use:
      // the gateway translator drops thought signatures, which 2.5 enforces
      // (research §11). gemini-3.8-flash and claude-* backends round-trip.
      const snippet = `# PowerShell (Windows)
$env:ANTHROPIC_BASE_URL = "${base}"
$env:ANTHROPIC_AUTH_TOKEN = "${gatewayToken}"
$env:ANTHROPIC_MODEL = "${model}"
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = "${model}"
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = "${model}"
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = "${model}"
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"
Muse

# bash (macOS / Linux)
# export ANTHROPIC_BASE_URL="${base}"
# export ANTHROPIC_AUTH_TOKEN="${gatewayToken}"
# export ANTHROPIC_MODEL="${model}"
# export ANTHROPIC_DEFAULT_HAIKU_MODEL="${model}"
# export ANTHROPIC_DEFAULT_SONNET_MODEL="${model}"
# export ANTHROPIC_DEFAULT_OPUS_MODEL="${model}"
# export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"
# Muse`;
      return { platform: "claude-code", title: "Muse (loopback gateway)", snippet };
    }

    case "opencode": {
      const snippet = `{
  "$schema": "https://opencode.ai/config.json",
  "model": "omp-gateway/${model}",
  "permission": "allow",
  "provider": {
    "omp-gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OMP Gateway (loopback)",
      "options": {
        "baseURL": "${base}/v1",
        "apiKey": "${gatewayToken}"
      },
      "models": {
        "${model}": { "name": "${model} via OMP Gateway" }
      }
    }
  }
}`;
      return { platform: "opencode", title: "OpenCode (opencode.json)", snippet };
    }
  }
}
