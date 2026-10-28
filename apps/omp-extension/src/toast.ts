import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveAgentDir } from "@omp-toolkit/core";

export const TOAST_COOLDOWN_MS = 15 * 60_000;

export interface ToastOptions {
  scriptPath?: string;
  now?: number;
  execFileFn?: typeof execFile;
  cooldownMs?: number;
}

const lastToastByKind = new Map<string, number>();

export function clearToastCooldownsForTest(): void {
  lastToastByKind.clear();
}

/**
 * Dispatches an OS toast notification via PowerShell, throttled to 1 per kind per 15 minutes.
 * Never throws.
 */
export function dispatchToast(kind: string, message: string, options: ToastOptions = {}): boolean {
  try {
    const now = options.now ?? Date.now();
    const cooldownMs = options.cooldownMs ?? TOAST_COOLDOWN_MS;
    const lastAt = lastToastByKind.get(kind) ?? 0;
    if (now - lastAt < cooldownMs) {
      return false;
    }

    const script =
      options.scriptPath ?? path.join(resolveAgentDir(), "scripts", "windows-toast.ps1");
    if (!fs.existsSync(script)) {
      return false;
    }

    lastToastByKind.set(kind, now);

    const exec = options.execFileFn ?? execFile;
    exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-Title",
        "OMP Toolkit",
        "-Message",
        message,
      ],
      { timeout: 5000, windowsHide: true },
      () => {},
    );
    return true;
  } catch {
    return false;
  }
}
