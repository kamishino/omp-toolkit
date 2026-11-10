import type { BackupSourceProfile } from "@omp-toolkit/core/backup";

export type BackupCliAction = "export" | "import" | "launch" | "check-runtime" | "help";

export interface ExportCommandConfig {
  action: "export";
  destination: string;
  profile: BackupSourceProfile;
  noLatestCopy: boolean;
}

export interface ImportCommandConfig {
  action: "import";
  snapshotPath: string;
  preview: boolean;
}

export interface LaunchCommandConfig {
  action: "launch";
  ompPath: string;
  args: string[];
}

export interface CheckRuntimeCommandConfig {
  action: "check-runtime";
  ompPath: string;
}

export interface HelpCommandConfig {
  action: "help";
}

export type BackupCliConfig =
  | ExportCommandConfig
  | ImportCommandConfig
  | LaunchCommandConfig
  | CheckRuntimeCommandConfig
  | HelpCommandConfig;

export const BACKUP_USAGE = `
Usage:
  bun apps/backup/src/index.ts export --destination <dir> [--profile default|omp-portable] [--no-latest-copy]
  bun apps/backup/src/index.ts import --snapshot <file> [--preview]
  bun apps/backup/src/index.ts launch [--omp-path <path>] -- [omp arguments...]
  bun apps/backup/src/index.ts check-runtime [--omp-path <path>]
  bun apps/backup/src/index.ts help
`.trim();

export function parseBackupCliArgs(argv: string[]): BackupCliConfig {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help") || argv[0] === "help") {
    return { action: "help" };
  }

  const action = argv[0];

  function getArg(flag: string): string | undefined {
    const idx = argv.indexOf(flag);
    if (idx !== -1 && idx + 1 < argv.length && !argv[idx + 1].startsWith("-")) {
      return argv[idx + 1];
    }
    return undefined;
  }

  if (action === "export") {
    const destination = getArg("--destination");
    if (!destination) {
      throw new Error("Missing required flag '--destination <dir>'.");
    }
    const profileArg = getArg("--profile") ?? "default";
    if (profileArg !== "default" && profileArg !== "omp-portable") {
      throw new Error(
        `Invalid '--profile': expected 'default' or 'omp-portable', received '${profileArg}'.`,
      );
    }
    const noLatestCopy = argv.includes("--no-latest-copy");
    return {
      action: "export",
      destination,
      profile: profileArg as BackupSourceProfile,
      noLatestCopy,
    };
  }

  if (action === "import") {
    const snapshotPath = getArg("--snapshot");
    if (!snapshotPath) {
      throw new Error("Missing required flag '--snapshot <file>'.");
    }
    const preview = argv.includes("--preview");
    return {
      action: "import",
      snapshotPath,
      preview,
    };
  }

  if (action === "check-runtime") {
    const ompPath = getArg("--omp-path") ?? "omp";
    return {
      action: "check-runtime",
      ompPath,
    };
  }

  if (action === "launch") {
    const ompPath = getArg("--omp-path") ?? "omp";
    const doubleDashIdx = argv.indexOf("--");
    const childArgs = doubleDashIdx !== -1 ? argv.slice(doubleDashIdx + 1) : [];

    // Reject arguments altering profile or configuration roots
    for (const arg of childArgs) {
      if (
        arg === "--profile" ||
        arg.startsWith("--profile=") ||
        arg === "--config" ||
        arg.startsWith("--config=")
      ) {
        throw new Error(
          `Argument '${arg}' is not permitted with direct launch. Direct launcher forces '--profile omp-portable'.`,
        );
      }
    }

    return {
      action: "launch",
      ompPath,
      args: childArgs,
    };
  }

  throw new Error(`Unknown command '${action}'.\n${BACKUP_USAGE}`);
}
