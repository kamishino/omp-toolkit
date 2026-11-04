import { describe, expect, test } from "bun:test";
import { buildDshRemotePack, renderDshRemotePackText } from "./remote-pack";

const INPUTS = {
  baseUrl: "https://gw.example.com",
  gatewayToken: "omp_gw_tok",
  cfClientId: "id.access",
  cfClientSecret: "s3cret",
};

describe("buildDshRemotePack", () => {
  test("renders env commands with real values and a secret-free patch", () => {
    const pack = buildDshRemotePack(INPUTS);
    expect(pack.powershell).toEqual([
      'setx OMP_GATEWAY_TOKEN "omp_gw_tok"',
      'setx OMP_CF_CLIENT_ID "id.access"',
      'setx OMP_CF_CLIENT_SECRET "s3cret"',
    ]);
    expect(pack.sh[0]).toContain('export OMP_GATEWAY_TOKEN="omp_gw_tok"');
    expect(pack.patch).toContain("baseURL: https://gw.example.com/v1");
    expect(pack.patch).toContain("!!js process.env.OMP_CF_CLIENT_ID");
    expect(pack.patch).not.toContain("s3cret");
    expect(pack.patch).not.toContain("omp_gw_tok");
  });

  test("text render orders env, patch, verify", () => {
    const lines = renderDshRemotePackText(buildDshRemotePack(INPUTS)).join("\n");
    const envAt = lines.indexOf("setx OMP_GATEWAY_TOKEN");
    const patchAt = lines.indexOf("- id: llm-pi-ai");
    const verifyAt = lines.indexOf("PC2-OK");
    expect(envAt).toBeGreaterThan(-1);
    expect(patchAt).toBeGreaterThan(envAt);
    expect(verifyAt).toBeGreaterThan(patchAt);
  });
});
