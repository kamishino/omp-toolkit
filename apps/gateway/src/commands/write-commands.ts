import fs from "node:fs";
import { createHistoryAudit } from "../audit";
import { GatewayWrites } from "../writes";
import { type CommandContext, POLICY_KEY } from "./context";
import { print, writeTextFileAtomic } from "./output";

const DEFAULT_BLOCK_SECONDS = 900;

export function createGatewayWrites(ctx: CommandContext): GatewayWrites {
  const { config, adapter, client, readPoliciesRaw } = ctx;
  return new GatewayWrites({
    client,
    readPoliciesRaw,
    writePolicies: async (policies) => {
      const out = await adapter.runOmpText(["config", "set", POLICY_KEY, JSON.stringify(policies)]);
      if (out === null) throw new Error("omp config set auth.accountPolicies failed");
    },
    readTextFile: (p) => fs.readFileSync(p, "utf-8"),
    writeTextFileAtomic,
    fileExists: fs.existsSync,
    clientsPath: config.clientsPath,
    provider: config.provider,
    audit: createHistoryAudit(config.historyDbPath, config.machinePath),
  });
}

export async function runWriteCommand(ctx: CommandContext): Promise<void> {
  const { config } = ctx;
  const writes = createGatewayWrites(ctx);
  const seconds = config.durationSeconds ?? DEFAULT_BLOCK_SECONDS;
  const targetId = config.target !== null ? Number(config.target) : Number.NaN;
  const needId = (): number => {
    if (!Number.isInteger(targetId) || targetId <= 0) {
      throw new Error(`usage: gateway:ctl ${config.command} <account-id> (see accounts)`);
    }
    return targetId;
  };
  try {
    const result =
      config.command === "clients-add"
        ? await (async () => {
            if (!config.target) throw new Error("usage: gateway:ctl clients-add <name>");
            return writes.clientsAdd(config.target, {
              models: config.models,
              accountIds: config.accountIds,
              force: config.force,
            });
          })()
        : config.command === "clients-revoke"
          ? await (async () => {
              if (!config.target) throw new Error("usage: gateway:ctl clients-revoke <name>");
              return writes.clientsRevoke(config.target);
            })()
          : config.command === "block"
            ? await writes.block(needId(), seconds)
            : config.command === "unblock"
              ? await writes.unblock(needId())
              : config.command === "drain"
                ? await writes.drain(needId())
                : config.command === "undrain"
                  ? await writes.undrain(needId())
                  : config.command === "drain-all"
                    ? await writes.drainAll(seconds)
                    : config.command === "unblock-all"
                      ? await writes.unblockAll()
                      : await writes.policySet(
                          needId(),
                          {
                            ...(config.priority !== null ? { priority: config.priority } : {}),
                            ...(config.reservePct !== null
                              ? { reservePct: config.reservePct }
                              : {}),
                          },
                          "gateway.policy",
                        );
    print(
      config,
      {
        ok: result.ok,
        outcome: result.outcome,
        target: result.target,
        scope: result.scope,
        audit: result.audit,
        lines: result.lines,
        ...(result.progress ? { progress: result.progress } : {}),
        ...(result.clientToken ? { clientToken: result.clientToken } : {}),
      },
      result.lines,
    );
    process.exitCode = result.ok ? 0 : 1;
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const firstLine = message.split("\n")[0] ?? "unknown error";
    if (firstLine.startsWith("usage:")) {
      console.error(firstLine);
      process.exitCode = 2;
      return;
    }
    const target = config.target ?? config.command;
    print(config, { ok: false, outcome: "failed", error: firstLine }, [
      `${config.command} ${target} -> failed: ${firstLine}`,
    ]);
    process.exitCode = 1;
    return;
  }
}
