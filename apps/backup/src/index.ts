import { homedir } from "node:os";
import { BACKUP_USAGE, parseBackupCliArgs } from "./config";
import { type BackupContext, createBackupRuntime } from "./omp-adapter";
import {
  exportBackupSnapshot,
  importBackupSnapshot,
  inspectBackupSnapshot,
  launchPortableProfile,
} from "./operations";

export async function readStdinJson(): Promise<Record<string, unknown>> {
  const text = await new Response(Bun.stdin.stream()).text();
  if (!text.trim()) {
    throw new Error("Expected JSON input on stdin, but received empty input.");
  }
  return JSON.parse(text);
}

export async function runBackupCli(
  argv: string[] = process.argv.slice(2),
  context?: BackupContext,
): Promise<void> {
  const ctx: BackupContext = context ?? {
    home: homedir(),
    env: process.env,
    runtime: createBackupRuntime(),
  };

  const config = parseBackupCliArgs(argv);

  switch (config.action) {
    case "help": {
      console.log(BACKUP_USAGE);
      return;
    }

    case "check-runtime": {
      const ompVersion = await ctx.runtime.getVersion(config.ompPath);
      console.log(JSON.stringify({ success: true, ompVersion }));
      return;
    }

    case "export": {
      const input = await readStdinJson();
      const passphraseStr = typeof input.passphrase === "string" ? input.passphrase : "";
      if (!passphraseStr) {
        throw new Error("Missing 'passphrase' in stdin JSON input.");
      }

      const result = await exportBackupSnapshot(
        {
          profile: config.profile,
          destinationDir: config.destination,
          noLatestCopy: config.noLatestCopy,
          passphrase: Buffer.from(passphraseStr, "utf8"),
        },
        ctx,
      );

      console.log(JSON.stringify({ success: true, ...result }));
      return;
    }

    case "import": {
      const input = await readStdinJson();
      const passphraseStr = typeof input.passphrase === "string" ? input.passphrase : "";
      if (!passphraseStr) {
        throw new Error("Missing 'passphrase' in stdin JSON input.");
      }

      if (config.preview) {
        const summary = await inspectBackupSnapshot({
          snapshotPath: config.snapshotPath,
          passphrase: Buffer.from(passphraseStr, "utf8"),
        });

        console.log(JSON.stringify({ success: true, summary }));
        return;
      }

      const confirmedSha256 =
        typeof input.confirmedSha256 === "string" ? input.confirmedSha256 : "";
      if (!confirmedSha256) {
        throw new Error("Missing 'confirmedSha256' fingerprint in stdin JSON input.");
      }

      const result = await importBackupSnapshot(
        {
          snapshotPath: config.snapshotPath,
          confirmedSha256,
          passphrase: Buffer.from(passphraseStr, "utf8"),
        },
        ctx,
      );

      console.log(JSON.stringify({ success: true, ...result }));
      return;
    }

    case "launch": {
      const exitCode = await launchPortableProfile(config.args, ctx, config.ompPath);
      process.exit(exitCode);
    }
  }
}

if (import.meta.main) {
  runBackupCli().catch((err: unknown) => {
    const errorObj = err as Error;
    const msg = errorObj?.message || String(err);
    console.error(JSON.stringify({ success: false, error: msg }));
    process.exit(msg.includes("Usage:") || msg.includes("Missing required flag") ? 2 : 1);
  });
}
