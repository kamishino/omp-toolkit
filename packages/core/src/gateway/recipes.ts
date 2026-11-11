import { buildAiderRecipe } from "./recipes/platforms/aider";
import { buildClaudeCodeRecipe } from "./recipes/platforms/claude-code";
import { buildClineRecipe } from "./recipes/platforms/cline";
import { buildCodexRecipe } from "./recipes/platforms/codex";
import { buildCrushRecipe } from "./recipes/platforms/crush";
import { buildCurlRecipe } from "./recipes/platforms/curl";
import { buildDshRecipe } from "./recipes/platforms/dsh";
import { buildGooseRecipe } from "./recipes/platforms/goose";
import { buildHermesRecipe } from "./recipes/platforms/hermes";
import { buildOmpRecipe } from "./recipes/platforms/omp";
import { buildOpencodeRecipe } from "./recipes/platforms/opencode";
import { buildPiRecipe } from "./recipes/platforms/pi";
import { buildPythonAnthropicRecipe } from "./recipes/platforms/python-anthropic";
import { buildPythonOpenAiRecipe } from "./recipes/platforms/python-openai";
import { buildQwenCodeRecipe } from "./recipes/platforms/qwen-code";
import { buildVscodeContinueRecipe } from "./recipes/platforms/vscode-continue";
import type { ClientRecipe, ClientRecipePlatform, RecipeContext, RecipeOptions } from "./types";

type RecipeBuilder = (ctx: RecipeContext) => ClientRecipe;

// Exhaustive over ClientRecipePlatform: adding a platform to the union
// fails compilation until its builder is registered here.
const BUILDERS: Record<ClientRecipePlatform, RecipeBuilder> = {
  curl: buildCurlRecipe,
  "python-openai": buildPythonOpenAiRecipe,
  "python-anthropic": buildPythonAnthropicRecipe,
  "vscode-continue": buildVscodeContinueRecipe,
  "claude-code": buildClaudeCodeRecipe,
  opencode: buildOpencodeRecipe,
  codex: buildCodexRecipe,
  pi: buildPiRecipe,
  cline: buildClineRecipe,
  aider: buildAiderRecipe,
  goose: buildGooseRecipe,
  crush: buildCrushRecipe,
  "qwen-code": buildQwenCodeRecipe,
  hermes: buildHermesRecipe,
  dsh: buildDshRecipe,
  omp: buildOmpRecipe,
};
/** Platforms with a first-class client setup recipe, in canonical display order. */
export const SUPPORTED_RECIPE_PLATFORMS: readonly ClientRecipePlatform[] = [
  "claude-code",
  "codex",
  "opencode",
  "pi",
  "cline",
  "aider",
  "goose",
  "crush",
  "qwen-code",
  "hermes",
  "dsh",
  "curl",
  "python-openai",
  "python-anthropic",
  "vscode-continue",
  "omp",
];

/**
 * Recipe platforms whose builders emit Cloudflare Access credentials when
 * provided. Remote setup carrying Access credentials is limited to these;
 * other platforms must use ordinary loopback connect.
 */
export const CF_ACCESS_RECIPE_PLATFORMS: readonly ClientRecipePlatform[] = [
  "curl",
  "dsh",
  "omp",
  "python-openai",
  "python-anthropic",
  "vscode-continue",
];

export function generateClientRecipe(
  platform: ClientRecipePlatform,
  options: RecipeOptions,
): ClientRecipe {
  const domain = options.domain || "gateway.example.com";
  const base = options.baseUrl || `https://${domain}`;
  const gatewayToken = options.gatewayToken || "<YOUR_OMP_GATEWAY_TOKEN>";
  const model = options.model || "google-antigravity/gemini-3.8-flash";
  const cfClientId = options.cfClientId;
  const cfClientSecret = options.cfClientSecret;

  const hasCfAccess = Boolean(cfClientId && cfClientSecret);

  return BUILDERS[platform]({
    base,
    gatewayToken,
    model,
    cfClientId,
    cfClientSecret,
    hasCfAccess,
    envRefs: options.envRefs ?? false,
  });
}
