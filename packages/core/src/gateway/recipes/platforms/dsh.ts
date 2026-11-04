import type { ClientRecipe, RecipeContext } from "../../types";

export function buildDshRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model, cfClientId, cfClientSecret, hasCfAccess, envRefs } = ctx;
  // Verified live: the DeepSeek-native llm-deepseek route sends x-api-key,
  // which the gateway rejects (401). The pi-ai hand-declared route speaks
  // openai-completions with a Bearer [REDACTED] profile `headers` dict carries
  // Cloudflare Access service-token headers for remote use.
  const accessHeaders =
    hasCfAccess && !envRefs
      ? `        headers:
          CF-Access-Client-Id: ${cfClientId}
          CF-Access-Client-Secret: ${cfClientSecret}
`
      : envRefs
        ? `        headers:
          CF-Access-Client-Id: !!js process.env.OMP_CF_CLIENT_ID
          CF-Access-Client-Secret: !!js process.env.OMP_CF_CLIENT_SECRET
`
        : "";
  const envComment = envRefs
    ? "# secrets: OMP_GATEWAY_TOKEN + OMP_CF_CLIENT_ID/SECRET from the environment (set once, then restart DSH)"
    : `# environment: OMP_GATEWAY_TOKEN=${gatewayToken} (launch env wins; restart DSH Desktop)`;
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
${accessHeaders}        models:
          - id: ${model}
            name: ${model} (OMP)
            contextWindow: 1048576
            maxTokens: 65536
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: omp-gateway
    model: ${model}

${envComment}`;
  return {
    platform: "dsh",
    title: "DeepSeek Harness / dsh ($DSH_HOME/cordis.patch.yml)",
    snippet,
  };
}
