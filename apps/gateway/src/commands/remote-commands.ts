import { buildDshRemotePack, renderDshRemotePackText } from "@omp-toolkit/core";
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
  const { config } = ctx;
  const platform = config.target || "claude-code";
  const clientName = config.positionals[1] || `remote-${platform}`;

  const writes = createGatewayWrites(ctx);
  const addResult = await writes.clientsAdd(clientName, {
    models: config.models,
    accountIds: config.accountIds,
    force: config.force,
  });

  const token =
    addResult.clientToken ?? (addResult.ok ? "omp_gw_<new-token>" : "omp_gw_<saved-token>");
  const baseUrl = config.baseUrl ?? "https://<your-tunnel-domain>";
  const cfId = config.cfClientId ?? "<cf-access-client-id>";
  const cfSecret = config.cfClientSecret ?? "<cf-access-client-secret>";

  const ps1Script = `$env:ANTHROPIC_BASE_URL='${baseUrl}'; $env:ANTHROPIC_API_KEY='${token}'; $env:CF_ACCESS_CLIENT_ID='${cfId}'; $env:CF_ACCESS_CLIENT_SECRET='${cfSecret}'; curl -s $env:ANTHROPIC_BASE_URL/v1/models -H "Authorization: Bearer $env:ANTHROPIC_API_KEY" -H "CF-Access-Client-Id: $env:CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $env:CF_ACCESS_CLIENT_SECRET"`;

  const bashScript = `export ANTHROPIC_BASE_URL='${baseUrl}' ANTHROPIC_API_KEY='${token}' CF_ACCESS_CLIENT_ID='${cfId}' CF_ACCESS_CLIENT_SECRET='${cfSecret}'; curl -s $ANTHROPIC_BASE_URL/v1/models -H "Authorization: Bearer $ANTHROPIC_API_KEY" -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET"`;

  print(
    config,
    {
      ok: addResult.ok,
      clientName,
      token,
      baseUrl,
      powershell: ps1Script,
      bash: bashScript,
    },
    [
      `============================================================`,
      ` REMOTE PAIRING PAYLOAD: ${platform.toUpperCase()} (${clientName})`,
      `============================================================`,
      addResult.ok
        ? `Client "${clientName}" registered in gateway-clients.json`
        : `Client "${clientName}" already exists (reusing registration)`,
      `Gateway URL: ${baseUrl}`,
      `Token:       ${token}`,
      ``,
      `--- Windows (PowerShell) One-Liner ---`,
      ps1Script,
      ``,
      `--- macOS / Linux (Bash) One-Liner ---`,
      bashScript,
      `============================================================`,
    ],
  );
}
