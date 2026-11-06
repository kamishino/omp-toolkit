import type { ClientRecipe, RecipeContext } from "../../types";

export function buildOmpRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model, cfClientId, cfClientSecret, hasCfAccess } = ctx;

  const accessHeaders = hasCfAccess
    ? `    headers:
      CF-Access-Client-Id: ${cfClientId}
      CF-Access-Client-Secret: ${cfClientSecret}
`
    : "";

  const snippet = `# 1. Add to ~/.omp/agent/models.yml (Thin Client setup on PC2, PC3, ...)
providers:
  omp-gateway:
    baseUrl: ${base}/v1
    apiKey: ${gatewayToken}
    api: openai-completions
${accessHeaders}    models:
      - id: ${model}
        name: ${model} (Gateway)
        contextWindow: 1048576
        maxTokens: 65536

# 2. Add to ~/.omp/agent/config.yml (sets as default and planning model)
modelRoles:
  default: omp-gateway/${model}
  plan: omp-gateway/${model}:high`;

  return {
    platform: "omp",
    title: "OMP / Oh My Pi Thin Client (~/.omp/agent/models.yml)",
    snippet,
  };
}
