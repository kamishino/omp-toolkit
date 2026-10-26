import fs from "node:fs";
import path from "node:path";
import { parseInterval } from "./interval";

export type DesktopTheme = "system" | "dark" | "light";

export interface DesktopSettings {
  intervalSeconds: number;
  balanceAlert: {
    cny: number;
    usd: number;
  };
  theme: DesktopTheme;
  openAtLogin: boolean;
}

export const MIN_INTERVAL_SECONDS = 30;
export const MAX_INTERVAL_SECONDS = 3600;

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  intervalSeconds: 300,
  balanceAlert: {
    cny: 10,
    usd: 10,
  },
  theme: "system",
  openAtLogin: false,
};

const VALID_THEMES: Record<string, true> = {
  system: true,
  dark: true,
  light: true,
};

export function validateDesktopSettings(candidate: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!candidate || typeof candidate !== "object") {
    return { valid: false, errors: ["Settings payload must be an object"] };
  }

  const s = candidate as Partial<DesktopSettings>;

  if (
    typeof s.intervalSeconds !== "number" ||
    !Number.isFinite(s.intervalSeconds) ||
    s.intervalSeconds < MIN_INTERVAL_SECONDS ||
    s.intervalSeconds > MAX_INTERVAL_SECONDS
  ) {
    errors.push(
      `intervalSeconds must be a number between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS}`,
    );
  }

  if (!s.balanceAlert || typeof s.balanceAlert !== "object") {
    errors.push("balanceAlert must be an object with cny and usd thresholds");
  } else {
    if (
      typeof s.balanceAlert.cny !== "number" ||
      !Number.isFinite(s.balanceAlert.cny) ||
      s.balanceAlert.cny < 0
    ) {
      errors.push("balanceAlert.cny must be a non-negative number");
    }
    if (
      typeof s.balanceAlert.usd !== "number" ||
      !Number.isFinite(s.balanceAlert.usd) ||
      s.balanceAlert.usd < 0
    ) {
      errors.push("balanceAlert.usd must be a non-negative number");
    }
  }

  if (typeof s.theme !== "string" || !VALID_THEMES[s.theme]) {
    errors.push("theme must be 'system', 'dark', or 'light'");
  }

  if (typeof s.openAtLogin !== "boolean") {
    errors.push("openAtLogin must be a boolean");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function settingsFilePath(userDataDir: string): string {
  return path.join(userDataDir, "settings.json");
}

export function saveDesktopSettings(userDataDir: string, settings: DesktopSettings): void {
  const file = settingsFilePath(userDataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  try {
    fs.renameSync(temp, file);
  } catch {
    fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Best-effort temp cleanup
    }
  }
}

export function loadDesktopSettings(options: {
  userDataDir: string;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  loginItemEnabled?: boolean;
}): DesktopSettings {
  const { userDataDir, argv = [], env = process.env, loginItemEnabled } = options;
  const file = settingsFilePath(userDataDir);

  // 1. Start with defaults
  const settings: DesktopSettings = {
    ...DEFAULT_DESKTOP_SETTINGS,
    balanceAlert: { ...DEFAULT_DESKTOP_SETTINGS.balanceAlert },
  };

  // 2. Apply environment variable defaults
  const envInterval = Number(env.OMP_WIDGET_INTERVAL_SECONDS);
  if (Number.isFinite(envInterval) && envInterval >= MIN_INTERVAL_SECONDS) {
    settings.intervalSeconds = Math.min(MAX_INTERVAL_SECONDS, envInterval);
  }
  const envCny = Number(env.DEEPSEEK_BALANCE_ALERT_CNY);
  if (Number.isFinite(envCny) && envCny >= 0) {
    settings.balanceAlert.cny = envCny;
  }
  const envUsd = Number(env.DEEPSEEK_BALANCE_ALERT_USD);
  if (Number.isFinite(envUsd) && envUsd >= 0) {
    settings.balanceAlert.usd = envUsd;
  }
  if (loginItemEnabled !== undefined) {
    settings.openAtLogin = loginItemEnabled;
  }

  // 3. Apply settings.json if present and valid
  try {
    if (fs.existsSync(file)) {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object") {
        const p = parsed as Partial<DesktopSettings>;
        if (
          typeof p.intervalSeconds === "number" &&
          Number.isFinite(p.intervalSeconds) &&
          p.intervalSeconds >= MIN_INTERVAL_SECONDS &&
          p.intervalSeconds <= MAX_INTERVAL_SECONDS
        ) {
          settings.intervalSeconds = p.intervalSeconds;
        }

        if (p.balanceAlert && typeof p.balanceAlert === "object") {
          if (
            typeof p.balanceAlert.cny === "number" &&
            Number.isFinite(p.balanceAlert.cny) &&
            p.balanceAlert.cny >= 0
          ) {
            settings.balanceAlert.cny = p.balanceAlert.cny;
          }
          if (
            typeof p.balanceAlert.usd === "number" &&
            Number.isFinite(p.balanceAlert.usd) &&
            p.balanceAlert.usd >= 0
          ) {
            settings.balanceAlert.usd = p.balanceAlert.usd;
          }
        }

        if (typeof p.theme === "string" && VALID_THEMES[p.theme]) {
          settings.theme = p.theme as DesktopTheme;
        }

        if (typeof p.openAtLogin === "boolean") {
          settings.openAtLogin = p.openAtLogin;
        }
      }
    }
  } catch {
    // If settings.json is corrupt, proceed with env/defaults
  }

  // 4. CLI flags have highest precedence
  const intervalArg = argv.find((arg) => arg.startsWith("--interval="));
  if (intervalArg) {
    const parsedInterval = parseInterval(intervalArg.slice("--interval=".length), env);
    settings.intervalSeconds = Math.max(
      MIN_INTERVAL_SECONDS,
      Math.min(MAX_INTERVAL_SECONDS, parsedInterval),
    );
  }

  return settings;
}
