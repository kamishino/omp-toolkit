import type { ClientRecipe, RecipeContext } from "../../types";

export function buildPythonOpenAiRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model, cfClientId, cfClientSecret, hasCfAccess } = ctx;
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
