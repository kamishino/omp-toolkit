import { describe, expect, test } from "bun:test";
import { providerLogo } from "./provider-logos";

describe("provider-logos mapping", () => {
  test("returns logo mapping for muse-code", () => {
    const logo = providerLogo("muse-code");
    expect(logo).toEqual({ light: "muse-code.svg" });
  });

  test("returns logo mapping for all active providers", () => {
    expect(providerLogo("google-antigravity")).toEqual({ light: "google-gemini.svg" });
    expect(providerLogo("openai-codex")).toEqual({
      light: "openai-light.svg",
      dark: "openai-dark.svg",
    });
    expect(providerLogo("deepseek")).toEqual({ light: "deepseek.svg" });
  });

  test("returns null for unknown provider", () => {
    expect(providerLogo("unknown-provider")).toBeNull();
  });
});
