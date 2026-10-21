import { describe, expect, test } from "bun:test";
import { providerLogo } from "./provider-logos";

describe("providerLogo mapping", () => {
  test("returns logo files for supported providers", () => {
    expect(providerLogo("google-antigravity")).toEqual({
      light: "google-gemini.svg",
    });
    expect(providerLogo("openai-codex")).toEqual({
      light: "openai-light.svg",
      dark: "openai-dark.svg",
    });
    expect(providerLogo("deepseek")).toEqual({ light: "deepseek.svg" });
  });

  test("returns null for providers without a brand logo (e.g. muse-code)", () => {
    expect(providerLogo("muse-code")).toBeNull();
    expect(providerLogo("unknown-provider")).toBeNull();
  });
});
