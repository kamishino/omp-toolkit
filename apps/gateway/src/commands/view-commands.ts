import {
  getAccountsOutput,
  getClientsOutput,
  renderAccountsText,
  renderClientsText,
  renderPoolText,
} from "../views";
import type { CommandContext } from "./context";
import { print } from "./output";

export async function runAccountsCommand(ctx: CommandContext): Promise<void> {
  const { config, viewsDeps } = ctx;
  const output = await getAccountsOutput(viewsDeps);
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
