import type { ClientRecipe, RecipeContext } from "../../types";

export function buildHermesRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model } = ctx;
  const snippet = `# ~/.hermes/config.yaml (key goes in ~/.hermes/.env as OPENAI_API_KEY)
model:
  provider: "custom"
  base_url: "${base}/v1"
  default: "${model}"

# ~/.hermes/.env
# OPENAI_API_KEY=${gatewayToken}`;
  return { platform: "hermes", title: "Hermes Agent (~/.hermes/config.yaml)", snippet };
}
