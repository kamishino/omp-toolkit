export * from "./desktop/create-desktop-shortcut";

import { createDesktopShortcut } from "./desktop/create-desktop-shortcut";

if (import.meta.main) {
  createDesktopShortcut();
}
