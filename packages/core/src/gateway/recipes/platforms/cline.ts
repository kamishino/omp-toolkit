import type { ClientRecipe, RecipeContext } from "../../types";

export function buildClineRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model } = ctx;
  const snippet = `# Cline CLI (one-time auth, then plain runs work):
cline auth openai --apikey "${gatewayToken}" --baseurl "${base}/v1" --modelid "${model}"
cline "your task"

# VS Code extension: Settings -> API Provider = "OpenAI Compatible",
# Base URL = ${base}/v1, API Key = your token, Model ID = ${model}`;
  return { platform: "cline", title: "Cline (CLI auth / VS Code settings)", snippet };
}
