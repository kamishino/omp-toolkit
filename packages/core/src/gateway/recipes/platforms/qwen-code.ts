import type { ClientRecipe, RecipeContext } from "../../types";

export function buildQwenCodeRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model } = ctx;
  const snippet = `# Environment (OpenAI-compatible auth type)
$env:OPENAI_BASE_URL = "${base}/v1"
$env:OPENAI_API_KEY = "${gatewayToken}"
$env:OPENAI_MODEL = "${model}"
qwen`;
  return { platform: "qwen-code", title: "Qwen Code (OpenAI-compatible env)", snippet };
}
