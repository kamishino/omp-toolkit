import { createFileRecordStore, type DaemonKind, DaemonManager } from "../daemon";
import { runDoctorChecks } from "../doctor";
import type { CommandContext } from "./context";
import { print } from "./output";

export async function runLifecycleCommand(ctx: CommandContext): Promise<void> {
  const { config, adapter, client, doctorDeps } = ctx;
  const manager = new DaemonManager({
    adapter,
    store: createFileRecordStore(config.runDir),
    probe: (kind: DaemonKind) =>
      kind === "broker"
        ? client.brokerHealth()
        : kind === "gateway"
          ? client.gatewayHealth()
          : client.tunnelHealth(),
    runDoctor: () => runDoctorChecks(doctorDeps, false),
    readBrokerToken: () => client.readBrokerToken(),
    config,
  });
  const result =
    config.command === "start"
      ? await manager.start()
      : config.command === "stop"
        ? await manager.stop()
        : config.command === "restart"
          ? await manager.restart()
          : await manager.status();
  print(config, { ok: result.ok, lines: result.lines }, result.lines);
  process.exit(result.ok ? 0 : 1);
}
