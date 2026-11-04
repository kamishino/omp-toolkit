import type { ClientRecipe, RecipeContext } from "../../types";

export function buildAiderRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model } = ctx;
  const snippet = `# ~/.aider.conf.yml  (the openai/ prefix selects the OpenAI-compatible client)
openai-api-base: ${base}/v1
openai-api-key: ${gatewayToken}
model: openai/${model}`;
  return { platform: "aider", title: "Aider (~/.aider.conf.yml)", snippet };
}
