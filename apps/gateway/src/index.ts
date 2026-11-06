import { runAutostartCommand } from "./commands/autostart-commands";
import { createCommandContext } from "./commands/context";
import { runLifecycleCommand } from "./commands/lifecycle-commands";
import { print } from "./commands/output";
import { runConnectCommand, runRecipeCommand } from "./commands/recipe-commands";
import { runRemotePackCommand, runRemotePairCommand } from "./commands/remote-commands";
import { runAccountsCommand, runClientsCommand, runModelsCommand } from "./commands/view-commands";
import { runWriteCommand } from "./commands/write-commands";
import { GATEWAY_USAGE, parseGatewayCtlConfig } from "./config";
import { renderDoctorText, runDoctorChecks, runRemoteDoctorChecks } from "./doctor";

async function main(): Promise<void> {
  const config = parseGatewayCtlConfig();
  if (config.unknown.length > 0) {
    console.error(`unknown flag(s): ${config.unknown.join(", ")}`);
    console.error(GATEWAY_USAGE);
    process.exit(2);
  }

  const ctx = createCommandContext(config);

  switch (config.command) {
    case "help": {
      console.log(GATEWAY_USAGE);
      return;
    }
    case "doctor": {
      const report = config.remote
        ? await runRemoteDoctorChecks(ctx.doctorDeps)
        : await runDoctorChecks(ctx.doctorDeps, true);
      print(config, { passed: report.passed, checks: report.checks }, renderDoctorText(report));
      process.exit(report.exitCode);
      return;
    }
    case "start":
    case "stop":
    case "restart":
    case "status": {
      await runLifecycleCommand(ctx);
      return;
    }
    case "accounts":
    case "pool": {
      await runAccountsCommand(ctx);
      return;
    }
    case "clients": {
      await runClientsCommand(ctx);
      return;
    }
    case "models": {
      await runModelsCommand(ctx);
      return;
    }
    case "recipe": {
      await runRecipeCommand(ctx);
      return;
    }
    case "connect": {
      await runConnectCommand(ctx);
      return;
    }
    case "remote-pack": {
      await runRemotePackCommand(ctx);
      return;
    }
    case "remote-pair": {
      await runRemotePairCommand(ctx);
      return;
    }
    case "autostart-install":
    case "autostart-remove":
    case "autostart-status": {
      await runAutostartCommand(ctx);
      return;
    }
    case "clients-add":
    case "clients-revoke":
    case "block":
    case "unblock":
    case "drain":
    case "undrain":
    case "drain-all":
    case "unblock-all":
    case "policy": {
      await runWriteCommand(ctx);
      return;
    }
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
