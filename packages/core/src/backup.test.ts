import { describe, expect, it } from "bun:test";
import {
  applyPortableSettings,
  assertSupportedAuthSchemaVersion,
  type BackupSnapshotPayload,
  decryptBackupPayload,
  encryptBackupPayload,
  extractPortableSettings,
  validateBackupRuntimeVersion,
  validateCredentialRecord,
} from "./backup";

describe("core/backup", () => {
  const passphrase = Buffer.from("synthetic-test-passphrase-5678", "utf8");

  describe("validateBackupRuntimeVersion", () => {
    it("accepts and normalizes valid versions >= 18.18.2", () => {
      expect(validateBackupRuntimeVersion("18.18.2")).toBe("18.18.2");
      expect(validateBackupRuntimeVersion("18.18.3")).toBe("18.18.3");
      expect(validateBackupRuntimeVersion("omp/18.18.3")).toBe("18.18.3");
      expect(validateBackupRuntimeVersion("  omp/18.18.3  \r\n")).toBe("18.18.3");
      expect(validateBackupRuntimeVersion("18.19.0")).toBe("18.19.0");
      expect(validateBackupRuntimeVersion("19.0.0")).toBe("19.0.0");
    });

    it("rejects versions < 18.18.2", () => {
      expect(() => validateBackupRuntimeVersion("18.18.1")).toThrow(
        "Unsupported OMP version 18.18.1",
      );
      expect(() => validateBackupRuntimeVersion("18.17.99")).toThrow(
        "Unsupported OMP version 18.17.99",
      );
      expect(() => validateBackupRuntimeVersion("17.0.0")).toThrow(
        "Unsupported OMP version 17.0.0",
      );
    });

    it("rejects invalid formats, empty, prerelease, and multiline output", () => {
      expect(() => validateBackupRuntimeVersion("")).toThrow("Unrecognized OMP version output");
      expect(() => validateBackupRuntimeVersion("   ")).toThrow("Unrecognized OMP version output");
      expect(() => validateBackupRuntimeVersion("not-a-version")).toThrow(
        "Unrecognized OMP version output",
      );
      expect(() => validateBackupRuntimeVersion("18.18")).toThrow(
        "Unrecognized OMP version output",
      );
      expect(() => validateBackupRuntimeVersion("18.18.3-beta.1")).toThrow(
        "Unrecognized OMP version output",
      );
      expect(() => validateBackupRuntimeVersion("omp/18.18.3\nextra line")).toThrow(
        "Unrecognized OMP version output",
      );
    });
  });

  describe("assertSupportedAuthSchemaVersion", () => {
    it("accepts schema version 8 and rejects others", () => {
      expect(() => assertSupportedAuthSchemaVersion(8)).not.toThrow();
      expect(() => assertSupportedAuthSchemaVersion(7)).toThrow(
        "Unsupported authentication schema 7",
      );
      expect(() => assertSupportedAuthSchemaVersion(9)).toThrow(
        "Unsupported authentication schema 9",
      );
      expect(() => assertSupportedAuthSchemaVersion(null)).toThrow(
        "Unsupported authentication schema missing/invalid",
      );
    });
  });

  describe("validateCredentialRecord", () => {
    it("accepts valid API key and OAuth records", () => {
      expect(() =>
        validateCredentialRecord({
          provider: "openai",
          credential_type: "api_key",
          data: JSON.stringify({ key: "sk-test" }),
          identity_key: null,
        }),
      ).not.toThrow();

      expect(() =>
        validateCredentialRecord({
          provider: "google-antigravity",
          credential_type: "oauth",
          data: JSON.stringify({ access: "a", refresh: "r", expires: 1900000000000 }),
          identity_key: "email:dev@example.invalid",
        }),
      ).not.toThrow();
    });

    it("rejects broker sentinel refresh tokens", () => {
      expect(() =>
        validateCredentialRecord({
          provider: "google-antigravity",
          credential_type: "oauth",
          data: JSON.stringify({ access: "a", refresh: "__remote__", expires: 1900000000000 }),
          identity_key: "email:dev@example.invalid",
        }),
      ).toThrow("Broker credentials cannot be exported");
    });

    it("rejects invalid types and empty keys", () => {
      expect(() =>
        validateCredentialRecord({
          provider: "openai",
          credential_type: "token",
          data: "{}",
          identity_key: null,
        }),
      ).toThrow("Invalid credential type");

      expect(() =>
        validateCredentialRecord({
          provider: "openai",
          credential_type: "api_key",
          data: JSON.stringify({ key: "   " }),
          identity_key: null,
        }),
      ).toThrow("has no valid key string");
    });
  });

  describe("extractPortableSettings & applyPortableSettings", () => {
    it("extracts allowed portable keys and nested leaves, rejecting unportable presets", () => {
      const source = {
        modelRoles: { default: "anthropic/claude-sonnet-4-5" },
        defaultThinkingLevel: "medium",
        theme: { dark: "titanium" },
        edit: { mode: "apply_patch", fuzzyMatch: true }, // fuzzyMatch is local, mode is portable
        plan: { defaultOnStartup: true, extraOption: "local" },
        shellPath: "/bin/bash", // machine-local
        setupVersion: 3, // machine-local
        auth: { accountPolicies: [{ provider: "google-antigravity", reservePct: 10 }] },
      };

      const extracted = extractPortableSettings(source);
      expect(extracted.modelRoles).toEqual({ default: "anthropic/claude-sonnet-4-5" });
      expect(extracted.defaultThinkingLevel).toBe("medium");
      expect(extracted.theme).toEqual({ dark: "titanium" });
      expect((extracted.edit as Record<string, unknown>)?.mode).toBe("apply_patch");
      expect((extracted.edit as Record<string, unknown>)?.fuzzyMatch).toBeUndefined();
      expect((extracted.plan as Record<string, unknown>)?.defaultOnStartup).toBe(true);
      expect((extracted.plan as Record<string, unknown>)?.extraOption).toBeUndefined();
      expect(extracted.shellPath).toBeUndefined();
      expect(extracted.setupVersion).toBeUndefined();
    });

    it("applies portable settings while preserving machine-local sibling settings and clearing broker config", () => {
      const target = {
        shellPath: "/usr/local/bin/bash",
        dev: { autoqaConsent: "yes" },
        edit: { fuzzyMatch: true, mode: "replace" }, // fuzzyMatch must survive, mode must be updated
        plan: { customFlag: 123 }, // customFlag must survive
        theme: { dark: "dracula" }, // whole key must be replaced
        auth: {
          broker: { url: "http://target-broker:8765" },
          accountPolicies: [{ provider: "old-p", reservePct: 50 }],
        },
        "auth.broker.url": "http://target-broker:8765",
      };

      const incomingPortable = {
        theme: { dark: "titanium" },
        edit: { mode: "apply_patch" },
        plan: { defaultOnStartup: true },
        auth: { accountPolicies: [{ provider: "google-antigravity", reservePct: 10 }] },
      };

      const result = applyPortableSettings(target, incomingPortable);
      expect(result.shellPath).toBe("/usr/local/bin/bash");
      expect((result.dev as Record<string, unknown>)?.autoqaConsent).toBe("yes");
      expect((result.theme as Record<string, unknown>)?.dark).toBe("titanium");
      expect((result.edit as Record<string, unknown>)?.mode).toBe("apply_patch");
      expect((result.edit as Record<string, unknown>)?.fuzzyMatch).toBe(true);
      expect((result.plan as Record<string, unknown>)?.defaultOnStartup).toBe(true);
      expect((result.plan as Record<string, unknown>)?.customFlag).toBe(123);
      expect((result.auth as Record<string, unknown>)?.broker).toBeUndefined();
      expect(result["auth.broker.url"]).toBeUndefined();
      expect((result.auth as Record<string, unknown>)?.accountPolicies).toEqual([
        { provider: "google-antigravity", reservePct: 10 },
      ]);
    });
  });

  describe("encryptBackupPayload & decryptBackupPayload", () => {
    const payload: BackupSnapshotPayload = {
      formatVersion: 1,
      kind: "portable",
      createdAt: new Date().toISOString(),
      sourceHost: "source-pc",
      sourceProfile: "default",
      ompVersion: "18.18.3",
      authSchemaVersion: 8,
      portableSettings: { defaultThinkingLevel: "high" },
      credentials: [
        {
          provider: "openai",
          credential_type: "api_key",
          data: JSON.stringify({ key: "sk-fixture" }),
          identity_key: null,
        },
      ],
    };

    it("round-trips encrypted payload cleanly", () => {
      const encrypted = encryptBackupPayload(payload, passphrase);
      expect(encrypted.byteLength).toBeGreaterThan(68);
      expect(Buffer.from(encrypted.buffer, encrypted.byteOffset, 8).toString("ascii")).toBe(
        "OMPBAK01",
      );

      const decrypted = decryptBackupPayload(encrypted, passphrase) as BackupSnapshotPayload;
      expect(decrypted.kind).toBe("portable");
      expect(decrypted.ompVersion).toBe("18.18.3");
      expect(decrypted.credentials).toHaveLength(1);
      expect(decrypted.credentials[0].provider).toBe("openai");
    });

    it("generates distinct salt and ciphertext on repeated encryptions", () => {
      const enc1 = encryptBackupPayload(payload, passphrase);
      const enc2 = encryptBackupPayload(payload, passphrase);
      expect(Buffer.from(enc1).equals(Buffer.from(enc2))).toBe(false);
    });

    it("fails decryption with wrong passphrase or corrupted bytes", () => {
      const encrypted = encryptBackupPayload(payload, passphrase);
      const wrongPass = Buffer.from("wrong-passphrase", "utf8");
      expect(() => decryptBackupPayload(encrypted, wrongPass)).toThrow("Decryption failed");

      const corrupted = new Uint8Array(encrypted);
      corrupted[corrupted.length - 1] ^= 0xff;
      expect(() => decryptBackupPayload(corrupted, passphrase)).toThrow("Decryption failed");
    });
  });
});
