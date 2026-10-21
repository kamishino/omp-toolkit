import tokens from "../../../../design/tokens.json";

function kebab(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export function applyTheme(mode: "light" | "dark"): void {
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
