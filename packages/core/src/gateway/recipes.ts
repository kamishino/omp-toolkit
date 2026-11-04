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

    case "codex": {
      // Codex speaks Responses only. Tool turns verified on the Muse
      // backend model; Gemini backends fail tool continuation upstream.
      const snippet = `# ~/.codex/config.toml  (set OMP_GATEWAY_TOKEN in the environment)
model = "${model}"
model_provider = "omp-gateway"

[model_providers.omp-gateway]
name = "OMP Gateway (loopback)"
base_url = "${base}/v1"
env_key = "OMP_GATEWAY_TOKEN"
wire_api = "responses"`;
      return { platform: "codex", title: "Muse (~/.codex/config.toml)", snippet };
    }

    case "pi": {
      const snippet = `{
  "providers": {
    "omp-gateway": {
      "baseUrl": "${base}/v1",
      "api": "openai-completions",
      "apiKey": "${gatewayToken}",
      "models": [
        {
          "id": "${model}",
          "name": "${model} via OMP Gateway",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 1048576,
          "maxTokens": 65536,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
# save as ~/.pi/agent/models.json, then: pi --model omp-gateway/${model}`;
      return { platform: "pi", title: "pi / Pi-family (~/.pi/agent/models.json)", snippet };
    }

    case "cline": {
      const snippet = `# Cline CLI (one-time auth, then plain runs work):
cline auth openai --apikey "${gatewayToken}" --baseurl "${base}/v1" --modelid "${model}"
cline "your task"

# VS Code extension: Settings -> API Provider = "OpenAI Compatible",
# Base URL = ${base}/v1, API Key = your token, Model ID = ${model}`;
      return { platform: "cline", title: "Cline (CLI auth / VS Code settings)", snippet };
    }

    case "aider": {
      const snippet = `# ~/.aider.conf.yml  (the openai/ prefix selects the OpenAI-compatible client)
openai-api-base: ${base}/v1
openai-api-key: ${gatewayToken}
model: openai/${model}`;
      return { platform: "aider", title: "Aider (~/.aider.conf.yml)", snippet };
    }

    case "goose": {
      const snippet = `# Environment (or run: goose configure -> OpenAI, custom host)
$env:GOOSE_PROVIDER = "openai"
$env:GOOSE_MODEL = "${model}"
$env:OPENAI_HOST = "${base}"
$env:OPENAI_BASE_PATH = "v1/chat/completions"
$env:OPENAI_API_KEY = "${gatewayToken}"
goose session`;
      return { platform: "goose", title: "Goose (OpenAI provider, custom host)", snippet };
    }

    case "crush": {
      const snippet = `{
  "$schema": "https://charm.land/crush.json",
  "providers": {
    "omp-gateway": {
      "type": "openai-compat",
      "base_url": "${base}/v1",
      "api_key": "${gatewayToken}",
      "models": [{ "id": "${model}", "name": "${model} via OMP Gateway" }]
    }
  },
  "models": {
    "large": { "model": "${model}", "provider": "omp-gateway" },
    "small": { "model": "${model}", "provider": "omp-gateway" }
  }
}`;
      return { platform: "crush", title: "Crush (crush.json)", snippet };
    }

    case "qwen-code": {
      const snippet = `# Environment (OpenAI-compatible auth type)
$env:OPENAI_BASE_URL = "${base}/v1"
$env:OPENAI_API_KEY = "${gatewayToken}"
$env:OPENAI_MODEL = "${model}"
qwen`;
      return { platform: "qwen-code", title: "Qwen Code (OpenAI-compatible env)", snippet };
    }

    case "hermes": {
      const snippet = `# ~/.hermes/config.yaml (key goes in ~/.hermes/.env as OPENAI_API_KEY)
model:
  provider: "custom"
  base_url: "${base}/v1"
  default: "${model}"

# ~/.hermes/.env
# OPENAI_API_KEY=${gatewayToken}`;
      return { platform: "hermes", title: "Hermes Agent (~/.hermes/config.yaml)", snippet };
    }

    case "dsh": {
      // Verified live: the DeepSeek-native llm-deepseek route sends x-api-key,
      // which the gateway rejects (401). The pi-ai hand-declared route speaks
      // openai-completions with a Bearer [REDACTED]
      const snippet = `# $DSH_HOME/cordis.patch.yml (home patch: every profile incl. desktop)
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      omp-gateway:
        displayName: OMP Gateway
        apiKeyEnv: OMP_GATEWAY_TOKEN
        api: openai-completions
        baseURL: ${base}/v1
        models:
          - id: ${model}
            name: ${model} (OMP)
            contextWindow: 1048576
            maxTokens: 65536
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: omp-gateway
    model: ${model}

# environment: OMP_GATEWAY_TOKEN=${gatewayToken} (launch env wins; restart DSH Desktop)`;
      return {
        platform: "dsh",
        title: "DeepSeek Harness / dsh ($DSH_HOME/cordis.patch.yml)",
        snippet,
      };
    }
  }
}
