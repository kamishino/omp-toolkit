import { describe, expect, test } from "bun:test";
import { providerLogo } from "./provider-logos";

describe("providerLogo", () => {
  test("returns null for unknown provider", () => {
    expect(providerLogo("unknown-provider")).toBeNull();
  });
});
