import type { ClientRecipe, RecipeContext } from "../../types";

export function buildCodexRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, model } = ctx;
  // Codex speaks Responses only. Tool turns verified on the Muse
  // backend model; Gemini backends fail tool continuation upstream.
  const snippet = `# ~/.codex/config.toml  (set OMP_GATEWAY_TOKEN in the environment)
model = "${model}"
model_provider = "omp-gateway"

[model_providers.omp-gateway]
name = "OMP Gateway (loopback)"
base_url = "${base}/v1"
env_key = "OMP_GATEWAY_TOKEN"
wire_api = "responses"`;
  return { platform: "codex", title: "Muse (~/.codex/config.toml)", snippet };
}
