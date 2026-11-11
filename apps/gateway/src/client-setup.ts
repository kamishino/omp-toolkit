import {
  CF_ACCESS_RECIPE_PLATFORMS,
  type ClientRecipe,
  type ClientRecipePlatform,
  generateClientRecipe,
  SUPPORTED_RECIPE_PLATFORMS,
} from "@omp-toolkit/core";
import { bindToBaseUrl, type GatewayCtlConfig } from "./config";
import type { WriteOutcome, WriteResult } from "./write-context";
import type { GatewayWrites } from "./writes";

export interface ClientSetupResult {
  exitCode: 0 | 1 | 2;
  payload: {
    ok: boolean;
    clientName: string;
    platform: string | null;
    outcome: WriteOutcome;
    audit: WriteResult["audit"];
    token?: string;
    recipe?: ClientRecipe;
    error?: string;
  };
  lines: string[];
}

function usageError(command: string, clientName: string, message: string): ClientSetupResult {
  return {
    exitCode: 2,
    payload: {
      ok: false,
      clientName,
      platform: null,
      outcome: "failed",
      audit: "not-attempted",
      error: message,
    },
    lines: [`usage: gateway:ctl ${command} <platform> [name]`, message],
  };
}

function normalizeRootUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return null;
  }
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return `${url.protocol}//${url.host}`;
}

export async function setupGatewayClient(
  config: GatewayCtlConfig,
  mode: "connect" | "remote-pair",
  writes: Pick<GatewayWrites, "clientsAdd">,
): Promise<ClientSetupResult> {
  const command = mode === "connect" ? "connect" : "remote-pair";
  const wanted = config.target;
  if (!wanted || !SUPPORTED_RECIPE_PLATFORMS.includes(wanted as ClientRecipePlatform)) {
    return usageError(command, "", `expected platform: ${SUPPORTED_RECIPE_PLATFORMS.join(", ")}`);
  }
  const platform = wanted as ClientRecipePlatform;
  const clientName =
    config.positionals[1] || (mode === "connect" ? platform : `remote-${platform}`);
  if (clientName.trim() === "") {
    return usageError(command, "", "client name must not be empty");
  }

  const rawBaseUrl =
    mode === "connect" ? (config.baseUrl ?? bindToBaseUrl(config.gatewayBind)) : config.baseUrl;
  if (!rawBaseUrl) {
    return usageError(
      command,
      clientName,
      mode === "connect"
        ? "no gateway URL resolved (pass --base-url or set OMP_GATEWAY_URL)"
        : "remote setup needs --base-url=https://<tunnel-host> (the public gateway URL); loopback setup uses connect",
    );
  }
  const baseUrl = normalizeRootUrl(rawBaseUrl);
  if (!baseUrl) {
    return usageError(
      command,
      clientName,
      `invalid --base-url "${rawBaseUrl}": supply the gateway root URL (e.g. https://<tunnel-host>), without /v1, query, or credentials`,
    );
  }
  if (mode === "remote-pair" && !baseUrl.startsWith("https://")) {
    return usageError(
      command,
      clientName,
      `remote setup needs an https:// URL; loopback setup uses connect (got "${rawBaseUrl}")`,
    );
  }

  const hasCfId = (config.cfClientId ?? "") !== "";
  const hasCfSecret = (config.cfClientSecret ?? "") !== "";
  if (hasCfId !== hasCfSecret) {
    return usageError(
      command,
      clientName,
      "Cloudflare Access needs both --cf-client-id and --cf-client-secret, or neither",
    );
  }
  const hasCfAccess = hasCfId && hasCfSecret;
  if (mode === "remote-pair" && !hasCfAccess) {
    return usageError(
      command,
      clientName,
      "remote setup needs both --cf-client-id and --cf-client-secret (or OMP_CF_CLIENT_ID/OMP_CF_CLIENT_SECRET); loopback setup uses connect",
    );
  }
  if (hasCfAccess && !CF_ACCESS_RECIPE_PLATFORMS.includes(platform)) {
    return usageError(
      command,
      clientName,
      `platform "${platform}" has no Cloudflare Access recipe; supported remote platforms: ${CF_ACCESS_RECIPE_PLATFORMS.join(", ")}`,
    );
  }

  const addResult = await writes.clientsAdd(clientName, {
    models: config.models,
    accountIds: config.accountIds,
    force: config.force,
  });
  if (!addResult.ok) {
    const lines = [...addResult.lines];
    if (addResult.lines.some((line) => line.includes("already exists"))) {
      lines.push(
        `To replace with a fresh token, run: gateway:ctl ${command} ${platform} ${clientName} --force`,
      );
    }
    return {
      exitCode: 1,
      payload: {
        ok: false,
        clientName,
        platform,
        outcome: addResult.outcome,
        audit: addResult.audit,
        error: addResult.lines[0] ?? "client registration failed",
      },
      lines,
    };
  }
  const token = addResult.clientToken;
  if (!token) {
    return {
      exitCode: 1,
      payload: {
        ok: false,
        clientName,
        platform,
        outcome: addResult.outcome,
        audit: addResult.audit,
        error:
          "registration acknowledged but no token was returned; the registry may have changed — inspect before retrying, do not register again",
      },
      lines: [
        `${command} ${clientName} -> failed: registration acknowledged but no token was returned; inspect the clients file before retrying`,
      ],
    };
  }
  const model =
    config.recipeModel ??
    (platform === "codex" ? "google-antigravity/claude-sonnet-4-6" : undefined);
  let recipe: ClientRecipe;
  try {
    recipe = generateClientRecipe(platform, {
      domain: "",
      gatewayToken: token,
      baseUrl,
      ...(model ? { model } : {}),
      ...(hasCfAccess
        ? { cfClientId: config.cfClientId ?? "", cfClientSecret: config.cfClientSecret ?? "" }
        : {}),
    });
  } catch {
    return {
      exitCode: 1,
      payload: {
        ok: false,
        clientName,
        platform,
        outcome: "applied",
        audit: addResult.audit,
        token,
        error:
          "client registered but the setup recipe could not be generated; keep the token below and do not register again",
      },
      lines: [
        `${command} ${clientName} -> applied with errors: client registered; recipe generation failed`,
        "Token (shown once, transmit securely):",
        token,
        "Registration changed; do not run this command again for the same client.",
      ],
    };
  }

  const verify =
    hasCfAccess && config.cfClientId && config.cfClientSecret
      ? `curl ${baseUrl}/v1/models -H "Authorization: Bearer ${token}" -H "CF-Access-Client-Id: ${config.cfClientId}" -H "CF-Access-Client-Secret: <redacted>"`
      : `curl ${baseUrl}/v1/models`;
  const lines = [
    `============================================================`,
    ` GATEWAY ${mode === "connect" ? "CONNECT" : "REMOTE PAIR"}: ${recipe.title.toUpperCase()}`,
    `============================================================`,
    `Client: "${clientName}" registered in gateway-clients.json`,
    `Token:  ${token} (keep secure, shown once)`,
    ``,
    `Run these commands to bind ${recipe.title} to the gateway:`,
    `------------------------------------------------------------`,
    recipe.snippet,
    `------------------------------------------------------------`,
    `Verify connectivity with:`,
    `  ${verify}`,
    `============================================================`,
  ];
  if (addResult.audit === "unavailable") {
    lines.push(
      "Action applied; audit recording failed. Inspect state before retry. Registration changed; do not run this command again for the same client.",
    );
  }
  return {
    exitCode: addResult.audit === "unavailable" ? 1 : 0,
    payload: {
      ok: addResult.audit !== "unavailable",
      clientName,
      platform,
      outcome: addResult.outcome,
      audit: addResult.audit,
      token,
      recipe,
    },
    lines,
  };
}
