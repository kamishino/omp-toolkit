import type { ClientRecipe, RecipeContext } from "../../types";

export function buildPiRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model } = ctx;
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
