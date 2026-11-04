import type { ClientRecipe, RecipeContext } from "../../types";

export function buildCrushRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model } = ctx;
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
