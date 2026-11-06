import { describe, expect, test } from "bun:test";
import {
  generateFontRegistryEntry,
  NERD_FONT_CATALOG,
  patchWindowsTerminalFont,
  resolveNerdFontDownloadUrl,
  resolveUserFontDirectory,
  resolveWindowsTerminalSettingsCandidates,
} from "./fonts";

describe("fonts domain & catalog", () => {
  test("NERD_FONT_CATALOG contains curated font families", () => {
    expect(NERD_FONT_CATALOG.JetBrainsMono).toBeDefined();
    expect(NERD_FONT_CATALOG.JetBrainsMono.primaryFontFace).toBe("JetBrainsMono NFM");
    expect(NERD_FONT_CATALOG.CascadiaCode).toBeDefined();
    expect(NERD_FONT_CATALOG.FiraCode).toBeDefined();
  });

  test("resolveNerdFontDownloadUrl constructs latest and tagged asset URLs", () => {
    expect(resolveNerdFontDownloadUrl("JetBrainsMono")).toBe(
      "https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip",
    );
    expect(resolveNerdFontDownloadUrl("CascadiaCode.zip")).toBe(
      "https://github.com/ryanoasis/nerd-fonts/releases/latest/download/CascadiaCode.zip",
    );
    expect(resolveNerdFontDownloadUrl("JetBrainsMono", "v3.2.1")).toBe(
      "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.2.1/JetBrainsMono.zip",
    );
    expect(resolveNerdFontDownloadUrl("JetBrainsMono", "3.2.1")).toBe(
      "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.2.1/JetBrainsMono.zip",
    );
  });

  test("resolveUserFontDirectory resolves platform font store without elevation", () => {
    const fakeHome = "C:/Users/fake";
    const winDir = resolveUserFontDirectory(
      "win32",
      { LOCALAPPDATA: "C:/Users/fake/AppData/Local" },
      fakeHome,
    );
    expect(winDir.replace(/\\/g, "/")).toBe("C:/Users/fake/AppData/Local/Microsoft/Windows/Fonts");

    const macDir = resolveUserFontDirectory("darwin", {}, "/Users/fake");
    expect(macDir.replace(/\\/g, "/")).toBe("/Users/fake/Library/Fonts");

    const linuxDir = resolveUserFontDirectory(
      "linux",
      { XDG_DATA_HOME: "/home/fake/.local/share" },
      "/home/fake",
    );
    expect(linuxDir.replace(/\\/g, "/")).toBe("/home/fake/.local/share/fonts/NerdFonts");
  });

  test("resolveWindowsTerminalSettingsCandidates provides standard paths", () => {
    const candidates = resolveWindowsTerminalSettingsCandidates(
      { LOCALAPPDATA: "C:/Users/fake/AppData/Local" },
      "C:/Users/fake",
    );
    expect(candidates).toHaveLength(3);
    expect(candidates[0].replace(/\\/g, "/")).toContain("Microsoft.WindowsTerminal_8wekyb3d8bbwe");
  });

  test("generateFontRegistryEntry generates TrueType and OpenType registry keys", () => {
    expect(generateFontRegistryEntry("JetBrainsMonoNFM-Regular.ttf")).toEqual({
      key: "JetBrainsMonoNFM-Regular (TrueType)",
      isTrueType: true,
    });
    expect(generateFontRegistryEntry("FiraCodeNFM-Bold.otf")).toEqual({
      key: "FiraCodeNFM-Bold (OpenType)",
      isTrueType: false,
    });
  });

  test("patchWindowsTerminalFont updates font.face and handles idempotency", () => {
    const initialJson = JSON.stringify({
      profiles: {
        defaults: {
          font: {
            face: "Consolas",
          },
        },
      },
    });

    const res = patchWindowsTerminalFont(initialJson, "JetBrainsMono NFM");
    expect(res.changed).toBe(true);
    expect(JSON.parse(res.text).profiles.defaults.font.face).toBe("JetBrainsMono NFM");

    // Second call with same font face is a no-op
    const noOp = patchWindowsTerminalFont(res.text, "JetBrainsMono NFM");
    expect(noOp.changed).toBe(false);
  });

  test("patchWindowsTerminalFont creates missing profiles.defaults.font hierarchy", () => {
    const emptyJson = "{}";
    const res = patchWindowsTerminalFont(emptyJson, "CaskaydiaCove NFM");
    expect(res.changed).toBe(true);
    expect(JSON.parse(res.text).profiles.defaults.font.face).toBe("CaskaydiaCove NFM");
  });
});
