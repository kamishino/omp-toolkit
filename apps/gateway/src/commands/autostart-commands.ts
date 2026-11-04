import { createAutostart } from "../autostart";
import type { CommandContext } from "./context";
import { print } from "./output";

export async function runAutostartCommand(ctx: CommandContext): Promise<void> {
  const { config } = ctx;
  const autostart = createAutostart();
  const result =
    config.command === "autostart-install"
      ? await autostart.install()
      : config.command === "autostart-remove"
        ? await autostart.remove()
        : await autostart.status();
  print(config, result, result.lines);
  process.exit(result.ok ? 0 : 1);
}
