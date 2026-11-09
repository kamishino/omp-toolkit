import path from "node:path";

export interface ArtifactViolation {
  path: string;
  rule: string;
}

const FORBIDDEN_RULES: Array<{ rule: string; matches: (p: string) => boolean }> = [
  {
    rule: "encrypted snapshot file (*.enc)",
    matches: (p) => p.endsWith(".enc"),
  },
  {
    rule: "legacy unencrypted snapshot file (omp-config-*.zip)",
    matches: (p) => {
      const base = path.basename(p);
      return base.startsWith("omp-config-") && base.endsWith(".zip");
    },
  },
  {
    rule: "interrupted backup artifact (*.partial)",
    matches: (p) => p.endsWith(".partial"),
  },
  {
    rule: "pending restore marker (pending-restore.json)",
    matches: (p) => path.basename(p) === "pending-restore.json",
  },
  {
    rule: "plaintext credential export (credentials.json)",
    matches: (p) => path.basename(p) === "credentials.json",
  },
  {
    rule: "local override file (*.local)",
    matches: (p) => p.endsWith(".local"),
  },
  {
    rule: "environment file (.env*)",
    matches: (p) => {
      const base = path.basename(p);
      return (base === ".env" || base.startsWith(".env.")) && base !== ".env.example";
    },
  },
  {
    rule: "database file (*.db / *.sqlite)",
    matches: (p) =>
      /\.(db|db-shm|db-wal|db-journal|sqlite|sqlite3|sqlite-journal|sqlite-wal|sqlite-shm)$/i.test(
        p,
      ),
  },
  {
    rule: "private key or certificate file (*.pem / *.key / *.p12 / *.pfx / *.p8)",
    matches: (p) => /\.(pem|key|p12|pfx|p8)$/i.test(p),
  },
  {
    rule: "runtime agent directory (.omp/)",
    matches: (p) => p === ".omp" || p.startsWith(".omp/") || p.includes("/.omp/"),
  },
  {
    rule: "backup snapshot directory (backups/)",
    matches: (p) => p === "backups" || p.startsWith("backups/") || p.includes("/backups/"),
  },
  {
    rule: "generated build directory (dist/ / out/ / coverage/)",
    matches: (p) => {
      // Allow scripts/build/ (build tool script directory), but forbid dist/ and out/
      return (
        p.startsWith("dist/") ||
        p.includes("/dist/") ||
        p.startsWith("out/") ||
        p.includes("/out/") ||
        p.startsWith("coverage/") ||
        p.includes("/coverage/")
      );
    },
  },
];

export function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function findPrivateArtifacts(paths: readonly string[]): ArtifactViolation[] {
  const violations: ArtifactViolation[] = [];

  for (const rawPath of paths) {
    const normalized = normalizeRepoPath(rawPath);
    if (!normalized) continue;

    for (const { rule, matches } of FORBIDDEN_RULES) {
      if (matches(normalized)) {
        violations.push({ path: normalized, rule });
        break;
      }
    }
  }

  return violations;
}

export async function runGitLsFiles(staged = false): Promise<string[]> {
  const args = staged
    ? ["git", "diff", "--staged", "--name-only", "-z"]
    : ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"];

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`git ls-files failed with exit code ${exitCode}.`);
  }

  return stdout
    .split("\0")
    .map((p) => p.trim())
    .filter(Boolean);
}

if (import.meta.main) {
  const staged = process.argv.includes("--staged");
  runGitLsFiles(staged)
    .then((files) => {
      const violations = findPrivateArtifacts(files);
      if (violations.length > 0) {
        console.error(
          `Privacy check failed: ${violations.length} forbidden private artifact(s) detected:`,
        );
        for (const v of violations) {
          console.error(`  - ${v.path}: ${v.rule}`);
        }
        console.error("\nRemove or gitignore these private artifacts before committing.");
        process.exit(1);
      }
      console.log(`Privacy check passed: ${files.length} file(s) checked, 0 private artifacts.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
