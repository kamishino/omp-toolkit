import {
  type ClientRecipePlatform,
  generateClientRecipe,
  SUPPORTED_RECIPE_PLATFORMS,
} from "@omp-toolkit/core";
import { setupGatewayClient } from "../client-setup";
import { bindToBaseUrl } from "../config";
import type { CommandContext } from "./context";
import { print } from "./output";
import { createGatewayWrites } from "./write-commands";

export async function runRecipeCommand(ctx: CommandContext): Promise<void> {
  const { config } = ctx;
  const all = SUPPORTED_RECIPE_PLATFORMS;
  const wanted = config.target;
  if (wanted !== null && !all.includes(wanted as ClientRecipePlatform)) {
    console.error(`unknown recipe platform: ${wanted} (expected one of ${all.join(", ")})`);
    process.exit(2);
  }
  const platforms = wanted
    ? [wanted as ClientRecipePlatform]
    : (["claude-code", "opencode", "curl"] as const);
  // Tool-safe defaults per harness path (research §11): Codex tool turns
  // only round-trip on the Muse backend; every other path is verified
  // or documented against gemini-3.8-flash.
  const recipes = platforms.map((platform) =>
    generateClientRecipe(platform, {
      domain: "",
      gatewayToken: "omp_gw_<your-client-token>",
      baseUrl: config.baseUrl ?? bindToBaseUrl(config.gatewayBind),
      ...(platform === "codex" && !config.recipeModel
        ? { model: "google-antigravity/claude-sonnet-4-6" }
        : {}),
      ...(config.recipeModel ? { model: config.recipeModel } : {}),
      ...(config.cfClientId ? { cfClientId: config.cfClientId } : {}),
      ...(config.cfClientSecret ? { cfClientSecret: config.cfClientSecret } : {}),
    }),
  );
  print(
    config,
    { recipes },
    recipes.flatMap((r) => [`--- ${r.title} ---`, r.snippet, ""]),
  );
}

export async function runConnectCommand(ctx: CommandContext): Promise<void> {
  const writes = createGatewayWrites(ctx);
  const result = await setupGatewayClient(ctx.config, "connect", writes);
  print(ctx.config, result.payload, result.lines);
  process.exitCode = result.exitCode;
}
