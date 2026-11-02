import { execFile } from "node:child_process";
import path from "node:path";
import { generateClientRecipe } from "@omp-toolkit/core";

export interface GatewayCommandDependencies {
  runScript?: (
    action: string,
    args?: string[],
  ) => Promise<{ stdout: string; stderr?: string; exitCode: number }>;
}

function defaultRunScript(
  action: string,
  args: string[] = [],
): Promise<{ stdout: string; stderr?: string; exitCode: number }> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    stdout: string;
    stderr?: string;
    exitCode: number;
  }>();

  // Resolve root scripts/gateway/omp-gateway.ps1 relative to current file
  const scriptPath = path.resolve(__dirname, "../../../scripts/gateway/omp-gateway.ps1");
  const psArgs = ["-ExecutionPolicy", "Bypass", "-File", scriptPath, action, ...args];

  execFile(
    "powershell",
    psArgs,
    { timeout: 30_000, windowsHide: true },
    (error, stdout, stderr) => {
      const outStr = typeof stdout === "string" ? stdout : String(stdout ?? "");
      const errStr = typeof stderr === "string" ? stderr : String(stderr ?? "");
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "number"
          ? error.code
          : error
            ? 1
            : 0;

      if (error && code !== 0) {
        resolve({ stdout: outStr, stderr: errStr, exitCode: code });
      } else if (error) {
        reject(error);
      } else {
        resolve({ stdout: outStr, stderr: errStr, exitCode: 0 });
      }
    },
  );

  return promise;
}

export async function handleGatewayCommand(
  rawArgs: string[],
  deps: GatewayCommandDependencies = {},
): Promise<string> {
  const run = deps.runScript ?? defaultRunScript;
  const action = (rawArgs[0] || "status").toLowerCase();
  const subArgs = rawArgs.slice(1);

  switch (action) {
    case "status": {
      const res = await run("status", subArgs);
      return res.stdout || res.stderr || "No status output from gateway manager.";
    }

    case "start": {
      const res = await run("start", subArgs);
      return res.stdout || "Gateway start command initiated.";
    }

    case "stop": {
      const res = await run("stop", subArgs);
      return res.stdout || "Gateway stop command initiated.";
    }

    case "restart": {
      const res = await run("restart", subArgs);
      return res.stdout || "Gateway restarted.";
    }

    case "client-add": {
      const clientName = subArgs[0]?.trim();
      if (!clientName) {
        return "Usage: /gateway client-add <name> [--models <model1,model2>]";
      }
      const res = await run("client-add", subArgs);
      return res.stdout || res.stderr || `Client '${clientName}' configuration generated.`;
    }

    case "recipe": {
      const platform = (subArgs[0] || "curl").toLowerCase();
      const validPlatforms = [
        "curl",
        "python-openai",
        "python-anthropic",
        "vscode-continue",
      ] as const;
      const matched = validPlatforms.find((p) => p === platform) ?? "curl";
      const recipe = generateClientRecipe(matched, {
        domain: "gateway.example.com",
        gatewayToken: "<YOUR_OMP_GATEWAY_TOKEN>",
      });
      return `[Gateway Recipe: ${recipe.title}]\n\n${recipe.snippet}`;
    }

    default: {
      return [
        "Usage: /gateway <action> [options]",
        "",
        "Actions:",
        "  /gateway status                 Show broker, gateway, and tunnel health",
        "  /gateway start                  Start broker, gateway, and cloudflared daemons",
        "  /gateway stop                   Stop all gateway background daemons",
        "  /gateway restart                Restart all gateway background daemons",
        "  /gateway client-add <name>      Issue scoped bearer token & setup pack for a PC",
        "  /gateway recipe [platform]      Show quick recipe (curl, python-openai, continue)",
      ].join("\n");
    }
  }
}
