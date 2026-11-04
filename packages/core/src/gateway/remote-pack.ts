// Remote setup pack: one copy-paste block per remote PC — env commands with
// real values plus a secret-free patch (DSH reads the same env at launch).

import { generateClientRecipe } from "./recipes";

export interface DshRemotePackInputs {
  baseUrl: string;
  gatewayToken: string;
  cfClientId: string;
  cfClientSecret: string;
  model?: string;
}

export interface DshRemotePack {
  platform: "dsh";
  baseUrl: string;
  powershell: string[];
  sh: string[];
  patch: string;
  verifyPrompt: string;
}

export const REMOTE_PACK_VERIFY_PROMPT = "Reply with exactly: PC2-OK";

export function buildDshRemotePack(inputs: DshRemotePackInputs): DshRemotePack {
  const recipe = generateClientRecipe("dsh", {
    domain: "",
    gatewayToken: "<set OMP_GATEWAY_TOKEN below>",
    baseUrl: inputs.baseUrl,
    ...(inputs.model ? { model: inputs.model } : {}),
    envRefs: true,
  });
  return {
    platform: "dsh",
    baseUrl: inputs.baseUrl,
    powershell: [
      `setx OMP_GATEWAY_TOKEN "${inputs.gatewayToken}"`,
      `setx OMP_CF_CLIENT_ID "${inputs.cfClientId}"`,
      `setx OMP_CF_CLIENT_SECRET "${inputs.cfClientSecret}"`,
    ],
    sh: [
      `export OMP_GATEWAY_TOKEN="${inputs.gatewayToken}"`,
      `export OMP_CF_CLIENT_ID="${inputs.cfClientId}"`,
      `export OMP_CF_CLIENT_SECRET="${inputs.cfClientSecret}"`,
    ],
    patch: recipe.snippet,
    verifyPrompt: REMOTE_PACK_VERIFY_PROMPT,
  };
}

export function renderDshRemotePackText(pack: DshRemotePack): string[] {
  return [
    "--- 1. PowerShell on the remote PC (paste once, then sign out/in or restart DSH) ---",
    ...pack.powershell,
    "",
    "--- sh/macOS/Linux alternative ---",
    ...pack.sh,
    "",
    "--- 2. ~/.dsh/cordis.patch.yml on the remote PC (home level, exact name) ---",
    pack.patch,
    "",
    `--- 3. Restart DSH Desktop, open a chat, send: ${pack.verifyPrompt} ---`,
  ];
}
