import { describe, expect, it } from "bun:test";
import { parseBackupCliArgs } from "./config";

describe("apps/backup/config", () => {
  it("parses export command flags", () => {
    const parsed = parseBackupCliArgs([
      "export",
      "--destination",
      "/backup/dir",
      "--profile",
      "omp-portable",
      "--no-latest-copy",
    ]);

    expect(parsed.action).toBe("export");
    if (parsed.action === "export") {
      expect(parsed.destination).toBe("/backup/dir");
      expect(parsed.profile).toBe("omp-portable");
      expect(parsed.noLatestCopy).toBe(true);
    }
  });

  it("throws when export destination is missing", () => {
    expect(() => parseBackupCliArgs(["export"])).toThrow(
      "Missing required flag '--destination <dir>'.",
    );
  });

  it("parses import command flags", () => {
    const parsedPreview = parseBackupCliArgs([
      "import",
      "--snapshot",
      "/path/to/snap.enc",
      "--preview",
    ]);
    expect(parsedPreview.action).toBe("import");
    if (parsedPreview.action === "import") {
      expect(parsedPreview.snapshotPath).toBe("/path/to/snap.enc");
      expect(parsedPreview.preview).toBe(true);
    }

    const parsedRestore = parseBackupCliArgs(["import", "--snapshot", "/path/to/snap.enc"]);
    expect(parsedRestore.action).toBe("import");
    if (parsedRestore.action === "import") {
      expect(parsedRestore.preview).toBe(false);
    }
  });

  it("parses launch and check-runtime commands", () => {
    const runtime = parseBackupCliArgs(["check-runtime", "--omp-path", "C:\\omp\\omp.exe"]);
    expect(runtime.action).toBe("check-runtime");
    if (runtime.action === "check-runtime") {
      expect(runtime.ompPath).toBe("C:\\omp\\omp.exe");
    }

    const launch = parseBackupCliArgs(["launch", "--", "config", "path"]);
    expect(launch.action).toBe("launch");
    if (launch.action === "launch") {
      expect(launch.args).toEqual(["config", "path"]);
    }
  });

  it("rejects forbidden flags in launch", () => {
    expect(() => parseBackupCliArgs(["launch", "--", "--profile", "work"])).toThrow(
      "Argument '--profile' is not permitted with direct launch",
    );
    expect(() => parseBackupCliArgs(["launch", "--", "--config=custom.yml"])).toThrow(
      "Argument '--config=custom.yml' is not permitted with direct launch",
    );
  });

  it("handles help flag and command", () => {
    expect(parseBackupCliArgs([])).toEqual({ action: "help" });
    expect(parseBackupCliArgs(["help"])).toEqual({ action: "help" });
    expect(parseBackupCliArgs(["--help"])).toEqual({ action: "help" });
  });
});
