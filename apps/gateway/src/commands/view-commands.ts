import {
  type AccountsOutput,
  getAccountsOutput,
  getClientsOutput,
  renderAccountsText,
  renderClientsText,
  renderPoolText,
  SnapshotUnavailableError,
} from "../views";
import type { CommandContext } from "./context";
import { print } from "./output";

export async function runAccountsCommand(ctx: CommandContext): Promise<void> {
  const { config, viewsDeps } = ctx;
  let output: AccountsOutput;
  try {
    output = await getAccountsOutput(viewsDeps);
  } catch (error) {
    if (error instanceof SnapshotUnavailableError) {
      if (config.json)
        console.log(JSON.stringify({ ok: false, error: "snapshot-unavailable" }, null, 2));
      else console.log("Account snapshot unavailable; no pool assessment was made.");
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  print(
    config,
    output,
    config.command === "accounts" ? renderAccountsText(output) : renderPoolText(output),
  );
}

export async function runClientsCommand(ctx: CommandContext): Promise<void> {
  const { config, viewsDeps } = ctx;
  const { clients, error } = getClientsOutput(viewsDeps);
  if (error) {
    console.error(`clients file invalid: ${error}`);
    process.exit(1);
  }
  print(config, { clients }, renderClientsText(clients));
}

export async function runModelsCommand(ctx: CommandContext): Promise<void> {
  const { config, client } = ctx;
  let models: string[];
  try {
    models = await client.getModels();
  } catch (err) {
    console.error(
      `models: gateway unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  print(config, { models }, models);
}
