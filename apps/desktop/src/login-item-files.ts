export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(options.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(options.electronPath)}</string>
    <string>${xmlEscape(options.appPath)}</string>
    <string>--hidden</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`;
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
