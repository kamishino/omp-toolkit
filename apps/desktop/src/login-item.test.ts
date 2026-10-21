import { describe, expect, test } from "bun:test";
import {
  autostartDesktopEntry,
  desktopQuote,
  launchAgentPlist,
  xmlEscape,
} from "./login-item-files";

describe("login item files and escaping", () => {
  test("xmlEscape escapes XML entities", () => {
    expect(xmlEscape("a & b < c > d \"e\" 'f'")).toBe(
      "a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;",
    );
  });

  test("desktopQuote escapes backslashes, quotes, shell variables and percent signs", () => {
    expect(desktopQuote('/usr/bin/my app "quoted" $VAR `cmd` 100%')).toBe(
      '"/usr/bin/my app \\"quoted\\" \\$VAR \\`cmd\\` 100%%"',
    );
  });

  test("launchAgentPlist generates valid plist XML with escaped strings and arguments", () => {
    const plist = launchAgentPlist({
      label: "dev.omp-toolkit.desktop-widget",
      electronPath: "/Applications/Electron App.app/Contents/MacOS/Electron",
      appPath: "/Users/dev/OMP & Tools/apps/desktop",
    });

    expect(plist).toContain("<key>Label</key>");
    expect(plist).toContain("<string>dev.omp-toolkit.desktop-widget</string>");
    expect(plist).toContain("/Users/dev/OMP &amp; Tools/apps/desktop");
    expect(plist).toContain("<string>--hidden</string>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<true/>");
    expect(plist).toContain("<key>ProcessType</key>");
    expect(plist).toContain("<string>Interactive</string>");
  });

  test("autostartDesktopEntry generates valid XDG desktop entry", () => {
    const entry = autostartDesktopEntry({
      electronPath: "/usr/bin/electron",
      appPath: "/home/user/omp-toolkit/apps/desktop",
      iconPath: "/home/user/omp-toolkit/apps/desktop/dist/assets/app-icon.png",
    });

    expect(entry).toContain("[Desktop Entry]");
    expect(entry).toContain("Type=Application");
    expect(entry).toContain("Name=OMP Provider Usage");
    expect(entry).toContain(
      'Exec="/usr/bin/electron" "/home/user/omp-toolkit/apps/desktop" --hidden',
    );
    expect(entry).toContain("Terminal=false");
    expect(entry).toContain("Icon=/home/user/omp-toolkit/apps/desktop/dist/assets/app-icon.png");
    expect(entry).toContain("X-GNOME-Autostart-enabled=true");
  });
});
