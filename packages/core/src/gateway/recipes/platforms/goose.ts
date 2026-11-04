import type { ClientRecipe, RecipeContext } from "../../types";

export function buildGooseRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model } = ctx;
  const snippet = `# Environment (or run: goose configure -> OpenAI, custom host)
$env:GOOSE_PROVIDER = "openai"
$env:GOOSE_MODEL = "${model}"
$env:OPENAI_HOST = "${base}"
$env:OPENAI_BASE_PATH = "v1/chat/completions"
$env:OPENAI_API_KEY = "${gatewayToken}"
goose session`;
  return { platform: "goose", title: "Goose (OpenAI provider, custom host)", snippet };
}
