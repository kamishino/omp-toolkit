import { buildDshRemotePack, renderDshRemotePackText } from "@omp-toolkit/core";
import { setupGatewayClient } from "../client-setup";
import type { CommandContext } from "./context";
import { print } from "./output";
import { createGatewayWrites } from "./write-commands";

const SUPPORTED = ["dsh"] as const;

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

export async function runRemotePackCommand(ctx: CommandContext): Promise<void> {
  const { config } = ctx;
  const wanted = config.target;
  if (wanted === null || !(SUPPORTED as readonly string[]).includes(wanted)) {
    fail(`usage: gateway:ctl remote-pack <platform> (supported: ${SUPPORTED.join(", ")})`);
  }
  if (!config.baseUrl) {
    fail("remote-pack needs --base-url=https://<tunnel-host> (the public gateway URL)");
  }
  if (!config.packGatewayToken) {
    fail(
      "remote-pack needs the client token via --gateway-token=<tok> or OMP_GATEWAY_TOKEN " +
        "(tokens are shown once at clients-add; reissue if lost)",
    );
  }
  if (!config.cfClientId || !config.cfClientSecret) {
    fail(
      "remote-pack needs --cf-client-id/--cf-client-secret or OMP_CF_CLIENT_ID/OMP_CF_CLIENT_SECRET env",
    );
  }
  const pack = buildDshRemotePack({
    baseUrl: config.baseUrl,
    gatewayToken: config.packGatewayToken,
    cfClientId: config.cfClientId,
    cfClientSecret: config.cfClientSecret,
    ...(config.recipeModel ? { model: config.recipeModel } : {}),
  });
  print(
    config,
    {
      platform: pack.platform,
      baseUrl: pack.baseUrl,
      powershell: pack.powershell,
      sh: pack.sh,
      patch: pack.patch,
      verifyPrompt: pack.verifyPrompt,
    },
    renderDshRemotePackText(pack),
  );
}

export async function runRemotePairCommand(ctx: CommandContext): Promise<void> {
  const writes = createGatewayWrites(ctx);
  const result = await setupGatewayClient(ctx.config, "remote-pair", writes);
  print(ctx.config, result.payload, result.lines);
  process.exitCode = result.exitCode;
}
