import type { ClientRecipe, RecipeContext } from "../../types";

export function buildOpencodeRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model } = ctx;
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
