import fs from "node:fs";
import path from "node:path";
import {
  type AccountPolicyLike,
  type ClientRecipePlatform,
  generateClientRecipe,
} from "@omp-toolkit/core";
import { createHistoryAudit } from "./audit";
import { createAutostart } from "./autostart";
import { createBrokerClient } from "./broker-client";
import {
  bindToBaseUrl,
  GATEWAY_USAGE,
  type GatewayCtlConfig,
  parseGatewayCtlConfig,
} from "./config";
import { createFileRecordStore, type DaemonKind, DaemonManager } from "./daemon";
import { renderDoctorText, runDoctorChecks } from "./doctor";
import { createOmpAdapter } from "./omp-adapter";
import {
  getAccountsOutput,
  getClientsOutput,
  renderAccountsText,
  renderClientsText,
  renderPoolText,
  type ViewsDependencies,
} from "./views";
import { GatewayWrites } from "./writes";

const POLICY_KEY = "auth.accountPolicies";
const DEFAULT_BLOCK_SECONDS = 900;

function print(config: GatewayCtlConfig, payload: unknown, lines: string[]): void {
  if (config.json) console.log(JSON.stringify(payload, null, 2));
  else for (const line of lines) console.log(line);
}

function writeTextFileAtomic(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, filePath);
}

async function main(): Promise<void> {
  const config = parseGatewayCtlConfig();
  if (config.unknown.length > 0) {
    console.error(`unknown flag(s): ${config.unknown.join(", ")}`);
    console.error(GATEWAY_USAGE);
    process.exit(2);
  }

  const adapter = createOmpAdapter(config.ompBin);
  const client = createBrokerClient(config);
  const doctorDeps = { adapter, client, config };
  const readPoliciesRaw = async (): Promise<string> => {
    const out = await adapter.runOmpText(["config", "get", POLICY_KEY]);
    if (out === null) throw new Error("omp config get auth.accountPolicies failed");
    return out;
  };
  const getPolicies = async (): Promise<AccountPolicyLike[]> => {
    const parsed: unknown = JSON.parse((await readPoliciesRaw()).trim() || "[]");
    return Array.isArray(parsed) ? (parsed as AccountPolicyLike[]) : [];
  };
  const viewsDeps: ViewsDependencies = {
    client,
    readTextFile: (p) => fs.readFileSync(p, "utf-8"),
    fileExists: fs.existsSync,
    clientsPath: config.clientsPath,
    provider: config.provider,
    getPolicies,
  };

  switch (config.command) {
    case "help": {
      console.log(GATEWAY_USAGE);
      return;
    }
    case "doctor": {
      const report = await runDoctorChecks(doctorDeps, true);
      print(config, { passed: report.passed, checks: report.checks }, renderDoctorText(report));
      process.exit(report.exitCode);
      return;
    }
    case "start":
    case "stop":
    case "restart":
    case "status": {
      const manager = new DaemonManager({
        adapter,
        store: createFileRecordStore(config.runDir),
        probe: (kind: DaemonKind) =>
          kind === "broker" ? client.brokerHealth() : client.gatewayHealth(),
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
      return;
    }
    case "accounts":
    case "pool": {
      const output = await getAccountsOutput(viewsDeps);
      print(
        config,
        output,
        config.command === "accounts" ? renderAccountsText(output) : renderPoolText(output),
      );
      return;
    }
    case "clients": {
      const { clients, error } = getClientsOutput(viewsDeps);
      if (error) {
        console.error(`clients file invalid: ${error}`);
        process.exit(1);
      }
      print(config, { clients }, renderClientsText(clients));
      return;
    }
    case "recipe": {
      const all: ClientRecipePlatform[] = [
        "claude-code",
        "codex",
        "opencode",
        "pi",
        "cline",
        "aider",
        "goose",
        "crush",
        "qwen-code",
        "hermes",
        "dsh",
        "curl",
        "python-openai",
        "python-anthropic",
        "vscode-continue",
      ];
      const wanted = config.target;
      if (wanted !== null && !all.includes(wanted as ClientRecipePlatform)) {
        console.error(`unknown recipe platform: ${wanted} (expected one of ${all.join(", ")})`);
        process.exit(2);
      }
      const platforms = wanted
        ? [wanted as ClientRecipePlatform]
        : (["claude-code", "opencode", "curl"] as const);
      // Tool-safe defaults per harness path (research §11): Codex tool turns
      // only round-trip on the Muse backend; every other path is verified
      // or documented against gemini-3.8-flash.
      const recipes = platforms.map((platform) =>
        generateClientRecipe(platform, {
          domain: "",
          gatewayToken: "omp_gw_<your-client-token>",
          baseUrl: bindToBaseUrl(config.gatewayBind),
          ...(platform === "codex" ? { model: "google-antigravity/claude-sonnet-4-6" } : {}),
        }),
      );
      print(
        config,
        { recipes },
        recipes.flatMap((r) => [`--- ${r.title} ---`, r.snippet, ""]),
      );
      return;
    }
    case "autostart-install":
    case "autostart-remove":
    case "autostart-status": {
      const autostart = createAutostart();
      const result =
        config.command === "autostart-install"
          ? await autostart.install()
          : config.command === "autostart-remove"
            ? await autostart.remove()
            : await autostart.status();
      print(config, result, result.lines);
      process.exit(result.ok ? 0 : 1);
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
      const writes = new GatewayWrites({
        client,
        readPoliciesRaw,
        writePolicies: async (policies) => {
          const out = await adapter.runOmpText([
            "config",
            "set",
            POLICY_KEY,
            JSON.stringify(policies),
          ]);
          if (out === null) throw new Error("omp config set auth.accountPolicies failed");
        },
        readTextFile: (p) => fs.readFileSync(p, "utf-8"),
        writeTextFileAtomic,
        fileExists: fs.existsSync,
        clientsPath: config.clientsPath,
        provider: config.provider,
        audit: createHistoryAudit(config.historyDbPath, config.machinePath),
      });
      const seconds = config.durationSeconds ?? DEFAULT_BLOCK_SECONDS;
      const targetId = config.target !== null ? Number(config.target) : Number.NaN;
      const needId = (): number => {
        if (!Number.isInteger(targetId) || targetId <= 0) {
          throw new Error(`usage: gateway:ctl ${config.command} <account-id> (see accounts)`);
        }
        return targetId;
      };
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
          lines: result.lines,
          ...(result.clientToken ? { clientToken: result.clientToken } : {}),
        },
        result.lines,
      );
      process.exit(result.ok ? 0 : 1);
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
