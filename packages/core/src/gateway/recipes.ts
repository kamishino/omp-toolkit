import type { ClientRecipe, ClientRecipePlatform, RecipeOptions } from "./types";

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
