import { build } from "plist";

export function desktopQuote(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/%/g, "%%");
  return `"${escaped}"`;
}

export function launchAgentPlist(options: {
  label: string;
  electronPath: string;
  appPath: string;
}): string {
  return build({
    Label: options.label,
    ProgramArguments: [options.electronPath, options.appPath, "--hidden"],
    RunAtLoad: true,
    ProcessType: "Interactive",
  });
}

export function autostartDesktopEntry(options: {
  electronPath: string;
  appPath: string;
  iconPath: string;
}): string {
  return `[Desktop Entry]
Type=Application
Name=OMP Provider Usage
Comment=OMP provider usage desktop widget
Exec=${desktopQuote(options.electronPath)} ${desktopQuote(options.appPath)} --hidden
Terminal=false
Icon=${options.iconPath}
X-GNOME-Autostart-enabled=true
`;
}
