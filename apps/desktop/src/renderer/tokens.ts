import tokens from "../../../../design/tokens.json";
import type { DesktopTheme } from "../settings";

function kebab(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export function applyTheme(mode: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = mode;

  const desktop = tokens.desktop;
  const palette = desktop.color[mode] as Record<string, { $value: string }>;

  for (const [key, token] of Object.entries(palette)) {
    root.style.setProperty(`--color-${kebab(key)}`, token.$value);
  }

  for (const [key, token] of Object.entries(desktop.space)) {
    root.style.setProperty(`--space-${key}`, `${token.$value}px`);
  }

  for (const [key, token] of Object.entries(desktop.radius)) {
    root.style.setProperty(`--radius-${key}`, `${token.$value}px`);
  }

  root.style.setProperty("--font-sans", desktop.font.sans.$value);
  root.style.setProperty("--font-mono", desktop.font.mono.$value);

  for (const [key, token] of Object.entries(desktop.font.size)) {
    root.style.setProperty(`--font-size-${key}`, `${token.$value}px`);
  }

  for (const [key, token] of Object.entries(desktop.size)) {
    root.style.setProperty(`--size-${kebab(key)}`, `${token.$value}px`);
  }
}

/**
 * Deep Theme Coordinator for Desktop Renderer.
 *
 * Encapsulates:
 * - Operating system dark/light media query observation
 * - User theme preference tracking (system, light, dark)
 * - Live DOM CSS variable property injection from design tokens
 * - Lifecycle cleanup of media query change listeners
 */
export class ThemeManager {
  private activePreference: DesktopTheme = "system";
  private mediaQuery: MediaQueryList | null = null;
  private changeListener: ((e: MediaQueryListEvent) => void) | null = null;

  init(): void {
    if (typeof window === "undefined" || !window.matchMedia) {
      applyTheme("light");
      return;
    }
    if (this.mediaQuery) return;

    this.mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    this.changeListener = (e: MediaQueryListEvent) => {
      if (this.activePreference === "system") {
        applyTheme(e.matches ? "dark" : "light");
      }
    };
    this.mediaQuery.addEventListener("change", this.changeListener);
    this.apply(this.activePreference);
  }

  getPreference(): DesktopTheme {
    return this.activePreference;
  }

  apply(theme: DesktopTheme): void {
    this.activePreference = theme;
    if (theme === "system") {
      const isDark =
        typeof window !== "undefined" &&
        Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches);
      applyTheme(isDark ? "dark" : "light");
    } else {
      applyTheme(theme);
    }
  }

  destroy(): void {
    if (this.mediaQuery && this.changeListener) {
      this.mediaQuery.removeEventListener("change", this.changeListener);
      this.changeListener = null;
      this.mediaQuery = null;
    }
  }
}

export const themeManager = new ThemeManager();

export function getActiveThemePreference(): DesktopTheme {
  return themeManager.getPreference();
}

export function applyThemePreference(theme: DesktopTheme): void {
  themeManager.apply(theme);
}
