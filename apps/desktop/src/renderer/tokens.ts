import tokens from "../../../../design/tokens.json";
import type { DesktopTheme } from "../settings";

interface TokenEntry {
  $value: string | number;
}

type TokenGroup = Readonly<Record<string, TokenEntry>>;

function kebab(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function setTokenGroup(root: HTMLElement, prefix: string, group: TokenGroup, unit = ""): void {
  for (const [key, token] of Object.entries(group)) {
    root.style.setProperty(`--${prefix}-${kebab(key)}`, `${token.$value}${unit}`);
  }
}

export function applyTheme(mode: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = mode;

  const desktop = tokens.desktop;
  const palette = desktop.color[mode];

  setTokenGroup(root, "color", palette);
  setTokenGroup(root, "space", desktop.space, "px");
  setTokenGroup(root, "radius", desktop.radius, "px");

  root.style.setProperty("--font-sans", desktop.font.sans.$value);
  root.style.setProperty("--font-mono", desktop.font.mono.$value);

  setTokenGroup(root, "font-size", desktop.font.size, "px");
  setTokenGroup(root, "font-weight", desktop.font.weight);
  setTokenGroup(root, "line-height", desktop.font.lineHeight);
  setTokenGroup(root, "letter-spacing", desktop.font.letterSpacing);
  setTokenGroup(root, "size", desktop.size, "px");
  setTokenGroup(root, "measure", desktop.measure);
  setTokenGroup(root, "breakpoint", desktop.breakpoint, "px");

  setTokenGroup(root, "duration", desktop.motion.duration, "ms");
  setTokenGroup(root, "easing", desktop.motion.easing);
  root.style.setProperty("--motion-press-scale", String(desktop.motion.pressScale.$value));
  root.style.setProperty("--motion-reveal-distance", `${desktop.motion.revealDistance.$value}px`);

  setTokenGroup(root, "opacity", desktop.opacity);
  setTokenGroup(root, "shadow", desktop.elevation);
  setTokenGroup(root, "layer", desktop.layer);
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

export function applyThemePreference(theme: DesktopTheme): void {
  themeManager.apply(theme);
}
