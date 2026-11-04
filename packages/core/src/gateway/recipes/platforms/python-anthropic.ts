import type { ClientRecipe, RecipeContext } from "../../types";

export function buildPythonAnthropicRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model, cfClientId, cfClientSecret, hasCfAccess } = ctx;
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
