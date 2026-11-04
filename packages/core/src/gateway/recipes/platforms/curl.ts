import type { ClientRecipe, RecipeContext } from "../../types";

export function buildCurlRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model, cfClientId, cfClientSecret, hasCfAccess } = ctx;
  const headers = [
    hasCfAccess ? `  -H "CF-Access-Client-Id: ${cfClientId}" \\` : null,
    hasCfAccess ? `  -H "CF-Access-Client-Secret: ${cfClientSecret}" \\` : null,
    `  -H "Authorization: Bearer ${gatewayToken}" \\`,
    '  -H "Content-Type: application/json"',
  ]
    .filter(Boolean)
    .join("\n");

  const snippet = `curl -X POST ${base}/v1/chat/completions \\
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
