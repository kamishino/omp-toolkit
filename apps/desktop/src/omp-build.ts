import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isGeminiHealthEnabled, parseOmpVersion } from "@omp-toolkit/core";
import which from "which";
import { defaultMonitorExec, type MonitorExecFn } from "./data";
import { OMP_VERSION_CHECKPOINT, type OmpBuildView, UNKNOWN_OMP_BUILD_VIEW } from "./ipc";

const VERSION_TIMEOUT_MS = 5_000;
const GENERIC_ERROR = "OMP build information is unavailable.";
const RACE_ERROR = "OMP changed during inspection; refresh to compare.";
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export interface OmpBuildReaderOptions {
  env?: NodeJS.ProcessEnv;
  execFn?: MonitorExecFn;
  hashFileFn?: (file: string) => Promise<string>;
}

function resolveExecutable(command: string, env: NodeJS.ProcessEnv): string | null {
  const looksLikePath = path.isAbsolute(command) || command.includes("/") || command.includes("\\");
  if (looksLikePath) {
    try {
      const resolved = path.resolve(command);
      return fs.statSync(resolved).isFile() ? resolved : null;
    } catch {
      return null;
    }
  }
  try {
    return (
      which.sync(command, {
        nothrow: true,
        path: env.PATH,
        pathExt: env.PATHEXT,
      }) ?? null
    );
  } catch {
    return null;
  }
}

function hashFile(file: string): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(file);
  stream.on("error", reject);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("end", () => resolve(hash.digest("hex")));
  return promise;
}

/**
 * Reads the locally installed OMP build identity (version + executable digest)
 * and compares it to the fixed user-recorded checkpoint. Main-process only;
 * never imported by the renderer.
 */
export function createOmpBuildReader(
  options: OmpBuildReaderOptions = {},
): () => Promise<OmpBuildView> {
  const env = options.env ?? process.env;
  const execFn = options.execFn ?? defaultMonitorExec;
  const hashExecutable = options.hashFileFn ?? hashFile;
  let cached: { key: string; view: OmpBuildView } | null = null;

  return async () => {
    const healthProbesEnabled = isGeminiHealthEnabled(env);
    try {
      const executable = resolveExecutable(env.OMP_BIN ?? "omp", env);
      if (!executable) {
        return {
          ...UNKNOWN_OMP_BUILD_VIEW,
          healthProbesEnabled,
          inspectionError: GENERIC_ERROR,
        };
      }

      const before = fs.statSync(executable);
      if (!before.isFile()) {
        return {
          ...UNKNOWN_OMP_BUILD_VIEW,
          healthProbesEnabled,
          inspectionError: GENERIC_ERROR,
        };
      }

      const key = `${executable}|${before.size}|${before.mtimeMs}`;
      if (cached && cached.key === key) {
        return { ...cached.view, healthProbesEnabled };
      }

      const { stdout } = await execFn(executable, ["--version"], {
        timeoutMs: VERSION_TIMEOUT_MS,
      });
      const parsed = parseOmpVersion(String(stdout));
      const version = parsed ? parsed.join(".") : null;
      const digest = await hashExecutable(executable);
      const sha256 = SHA256_PATTERN.test(digest) ? digest.toLowerCase() : null;

      const after = fs.statSync(executable);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        cached = null;
        return {
          ...UNKNOWN_OMP_BUILD_VIEW,
          healthProbesEnabled,
          inspectionError: RACE_ERROR,
        };
      }

      const known = version !== null && sha256 !== null;
      const comparison: OmpBuildView["comparison"] = !known
        ? "unknown"
        : version === OMP_VERSION_CHECKPOINT.version && sha256 === OMP_VERSION_CHECKPOINT.sha256
          ? "same"
          : "changed";
      const view: OmpBuildView = {
        version,
        sha256,
        comparison,
        builtInAntigravityPolicy: comparison === "same" ? "documented-pause" : "unverified",
        healthProbesEnabled,
        inspectionError: known ? null : GENERIC_ERROR,
      };

      if (known) {
        cached = { key, view };
      }
      return view;
    } catch {
      return {
        ...UNKNOWN_OMP_BUILD_VIEW,
        healthProbesEnabled,
        inspectionError: GENERIC_ERROR,
      };
    }
  };
}
