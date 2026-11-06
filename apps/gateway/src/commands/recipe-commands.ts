import { type ClientRecipePlatform, generateClientRecipe } from "@omp-toolkit/core";
import { bindToBaseUrl } from "../config";
import type { CommandContext } from "./context";
import { print } from "./output";
import { createGatewayWrites } from "./write-commands";

export const SUPPORTED_RECIPE_PLATFORMS: ClientRecipePlatform[] = [
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
  const { config } = ctx;
  const wanted = config.target;
  if (!wanted || !SUPPORTED_RECIPE_PLATFORMS.includes(wanted as ClientRecipePlatform)) {
    console.error(
      `usage: gateway:ctl connect <platform> [name] (expected platform: ${SUPPORTED_RECIPE_PLATFORMS.join(", ")})`,
    );
    process.exit(2);
  }
  const platform = wanted as ClientRecipePlatform;
  const clientName = config.positionals[1] || platform;

  const writes = createGatewayWrites(ctx);
  const addResult = await writes.clientsAdd(clientName, {
    models: config.models,
    accountIds: config.accountIds,
    force: config.force,
  });

  const baseUrl = config.baseUrl ?? bindToBaseUrl(config.gatewayBind);

  if (!addResult.ok) {
    if (addResult.lines.some((l) => l.includes("already exists"))) {
      const recipe = generateClientRecipe(platform, {
        domain: "",
        gatewayToken: "omp_gw_<your-saved-token>",
        baseUrl,
        ...(platform === "codex" && !config.recipeModel
          ? { model: "google-antigravity/claude-sonnet-4-6" }
          : {}),
        ...(config.recipeModel ? { model: config.recipeModel } : {}),
        ...(config.cfClientId ? { cfClientId: config.cfClientId } : {}),
        ...(config.cfClientSecret ? { cfClientSecret: config.cfClientSecret } : {}),
      });

      print(
        config,
        {
          ok: false,
          clientName,
          error: `Client "${clientName}" already exists.`,
          recipe,
        },
        [
          `Notice: Client "${clientName}" is already registered.`,
          `To replace with a fresh token, run: gateway:ctl connect ${platform} ${clientName} --force`,
          "",
          `--- Setup Recipe: ${recipe.title} ---`,
          recipe.snippet,
        ],
      );
      return;
    }

    console.error(addResult.lines.join("\n"));
    process.exit(1);
  }

  const token = addResult.clientToken ?? "omp_gw_<generated-token>";
  const recipe = generateClientRecipe(platform, {
    domain: "",
    gatewayToken: token,
    baseUrl,
    ...(platform === "codex" && !config.recipeModel
      ? { model: "google-antigravity/claude-sonnet-4-6" }
      : {}),
    ...(config.recipeModel ? { model: config.recipeModel } : {}),
    ...(config.cfClientId ? { cfClientId: config.cfClientId } : {}),
    ...(config.cfClientSecret ? { cfClientSecret: config.cfClientSecret } : {}),
  });

  print(
    config,
    {
      ok: true,
      clientName,
      token,
      recipe,
    },
    [
      `============================================================`,
      ` GATEWAY CONNECT: ${recipe.title.toUpperCase()}`,
      `============================================================`,
      `Client: "${clientName}" registered in gateway-clients.json`,
      `Token:  ${token} (keep secure, shown once)`,
      ``,
      `Run these commands to bind ${recipe.title} to the gateway:`,
      `------------------------------------------------------------`,
      recipe.snippet,
      `------------------------------------------------------------`,
      `Verify connectivity with:`,
      `  curl ${baseUrl}/v1/models`,
      `============================================================`,
    ],
  );
}
