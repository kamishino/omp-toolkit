import type { ClientRecipe, RecipeContext } from "../../types";

export function buildClaudeCodeRecipe(ctx: RecipeContext): ClientRecipe {
  const { base, gatewayToken, model } = ctx;
  // Anthropic-protocol clients must avoid Gemini 2.5 models for tool use:
  // the gateway translator drops thought signatures, which 2.5 enforces
  // (research §11). gemini-3.8-flash and claude-* backends round-trip.
  const snippet = `# PowerShell (Windows)
$env:ANTHROPIC_BASE_URL = "${base}"
$env:ANTHROPIC_AUTH_TOKEN = "${gatewayToken}"
$env:ANTHROPIC_MODEL = "${model}"
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = "${model}"
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = "${model}"
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = "${model}"
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"
Muse

# bash (macOS / Linux)
# export ANTHROPIC_BASE_URL="${base}"
# export ANTHROPIC_AUTH_TOKEN="${gatewayToken}"
# export ANTHROPIC_MODEL="${model}"
# export ANTHROPIC_DEFAULT_HAIKU_MODEL="${model}"
# export ANTHROPIC_DEFAULT_SONNET_MODEL="${model}"
# export ANTHROPIC_DEFAULT_OPUS_MODEL="${model}"
# export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"
# Muse`;
  return { platform: "claude-code", title: "Muse (loopback gateway)", snippet };
}
