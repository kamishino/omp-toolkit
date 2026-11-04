import type { ClientRecipe, RecipeContext } from "../../types";

export function buildVscodeContinueRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model, cfClientId, cfClientSecret, hasCfAccess } = ctx;
  const extraHeaders = hasCfAccess
    ? `,\n      "requestOptions": {\n        "extraHeaders": {\n          "CF-Access-Client-Id": "${cfClientId}",\n          "CF-Access-Client-Secret": "${cfClientSecret}"\n        }\n      }`
    : "";

  const snippet = `{
  "models": [
    {
      "title": "${model} (OMP Gateway)",
      "provider": "openai",
      "model": "${model}",
      "apiBase": "${base}/v1",
      "apiKey": "${gatewayToken}"${extraHeaders}
    }
  ]
}`;

  return {
    platform: "vscode-continue",
    title: "VS Code Extensions (Continue / Cline config.json)",
    snippet,
  };
}
