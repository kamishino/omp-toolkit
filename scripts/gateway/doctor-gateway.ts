import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CloudflareAccessCredentials } from "../../packages/core/src/gateway/types";

export interface GatewayDoctorDependencies {
  fetchFn?: typeof fetch;
  execFileFn?: (
    file: string,
    args: string[],
    options?: { timeout?: number; windowsHide?: boolean },
  ) => Promise<{ stdout: string | Buffer; stderr?: string | Buffer }>;
  readTextFile?: (filePath: string) => string;
  fileExists?: (filePath: string) => boolean;
  env?: Record<string, string | undefined>;
  brokerPort?: number;
  gatewayPort?: number;
  domain?: string;
}

export interface GatewayDoctorResult {
  lines: string[];
  exitCode: 0 | 1;
}

function execFilePromise(
  file: string,
  args: string[],
  options: { timeout?: number; windowsHide?: boolean } = {},
): Promise<{ stdout: string | Buffer; stderr?: string | Buffer }> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    stdout: string | Buffer;
    stderr?: string | Buffer;
  }>();
  execFile(file, args, options, (error, stdout, stderr) => {
    if (error) {
      reject(error);
    } else {
      resolve({ stdout, stderr });
    }
  });
  return promise;
}

export async function runGatewayDoctor(
  deps: GatewayDoctorDependencies = {},
): Promise<GatewayDoctorResult> {
  const lines: string[] = [];
  let allPass = true;

  const fetcher = deps.fetchFn ?? fetch;
  const exec = deps.execFileFn ?? execFilePromise;
  const fileExists = deps.fileExists ?? fs.existsSync;
  const readText = deps.readTextFile ?? ((p: string) => fs.readFileSync(p, "utf-8"));
  const env = deps.env ?? process.env;

  const brokerPort = deps.brokerPort ?? 8765;
  const gatewayPort = deps.gatewayPort ?? 4000;
  const domain = deps.domain ?? env.OMP_GATEWAY_DOMAIN ?? "gateway.example.com";

  const homeDir = env.USERPROFILE ?? os.homedir();
  const ompDir = path.join(homeDir, ".omp");
  const gatewayTokenPath = path.join(ompDir, "auth-gateway.token");
  const cfAccessPath = path.join(ompDir, "cf-access.json");

  function pass(name: string, detail?: string): void {
    lines.push(`PASS ${name}${detail ? `: ${detail}` : ""}`);
  }

  function warn(name: string, reason: string): void {
    lines.push(`WARN ${name}: ${reason}`);
  }

  function fail(name: string, reason: string): void {
    allPass = false;
    lines.push(`FAIL ${name}: ${reason}`);
  }

  // 1. Broker Local Liveness
  try {
    const res = await fetcher(`http://127.0.0.1:${brokerPort}/v1/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean; version?: string };
      pass("Broker Liveness", `127.0.0.1:${brokerPort} healthy (v${data.version ?? "unknown"})`);
    } else {
      fail("Broker Liveness", `127.0.0.1:${brokerPort} responded with HTTP ${res.status}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("Broker Liveness", `Cannot reach 127.0.0.1:${brokerPort}: ${msg}`);
  }

  // 2. Gateway Local Liveness
  try {
    const res = await fetcher(`http://127.0.0.1:${gatewayPort}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean; version?: string };
      pass("Gateway Liveness", `127.0.0.1:${gatewayPort} healthy (v${data.version ?? "unknown"})`);
    } else {
      fail("Gateway Liveness", `127.0.0.1:${gatewayPort} responded with HTTP ${res.status}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("Gateway Liveness", `Cannot reach 127.0.0.1:${gatewayPort}: ${msg}`);
  }

  // 3. Gateway Inbound Bearer Auth Enforcement
  try {
    const unauthRes = await fetcher(`http://127.0.0.1:${gatewayPort}/v1/models`, {
      signal: AbortSignal.timeout(2000),
    });
    if (unauthRes.status === 401) {
      pass("Gateway Auth Gate", "Unauthenticated request rejected with HTTP 401");
    } else {
      warn("Gateway Auth Gate", `Expected HTTP 401 without token, got HTTP ${unauthRes.status}`);
    }
  } catch {
    // Already flagged in Gateway Liveness
  }

  // 4. Model Catalog Resolution via Bearer Token
  let gatewayToken = "";
  if (fileExists(gatewayTokenPath)) {
    try {
      gatewayToken = readText(gatewayTokenPath).trim();
    } catch {
      warn("Gateway Token", `Could not read ${gatewayTokenPath}`);
    }
  }

  if (gatewayToken) {
    try {
      const authRes = await fetcher(`http://127.0.0.1:${gatewayPort}/v1/models`, {
        headers: { Authorization: `Bearer ${gatewayToken}` },
        signal: AbortSignal.timeout(3000),
      });
      if (authRes.ok) {
        const catalog = (await authRes.json()) as { data?: unknown[] };
        const count = catalog.data?.length ?? 0;
        pass("Model Catalog", `${count} models available via gateway`);
      } else {
        fail("Model Catalog", `Authenticated request failed with HTTP ${authRes.status}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      fail("Model Catalog", `Failed to resolve models: ${msg}`);
    }
  } else {
    warn(
      "Gateway Token",
      `No gateway token found at ${gatewayTokenPath}. Start gateway to mint token.`,
    );
  }

  // 5. Cloudflared Process Check
  try {
    const { stdout } = await exec("tasklist", [], { timeout: 3000 });
    const text = typeof stdout === "string" ? stdout : stdout.toString();
    if (/cloudflared\.exe/i.test(text)) {
      pass("Cloudflare Tunnel Process", "cloudflared.exe running in background");
    } else {
      warn("Cloudflare Tunnel Process", "cloudflared.exe not detected in running process table");
    }
  } catch {
    // On non-Windows or restricted environments, gracefully skip
  }

  // 6. Public Cloudflare Access (Two-Tier Check)
  let cfClientId = env.CF_ACCESS_CLIENT_ID;
  let cfClientSecret = env.CF_ACCESS_CLIENT_SECRET;

  if ((!cfClientId || !cfClientSecret) && fileExists(cfAccessPath)) {
    try {
      const raw = JSON.parse(readText(cfAccessPath)) as CloudflareAccessCredentials;
      cfClientId = cfClientId ?? raw.clientId;
      cfClientSecret = cfClientSecret ?? raw.clientSecret;
    } catch {
      // Ignored
    }
  }

  try {
    const pubUnauth = await fetcher(`https://${domain}/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    if (pubUnauth.status === 403 || pubUnauth.status === 302) {
      pass(
        "Cloudflare Access Gate",
        `Perimeter protected (unauthenticated request blocked with HTTP ${pubUnauth.status})`,
      );
    } else if (pubUnauth.ok) {
      warn(
        "Cloudflare Access Gate",
        `Domain https://${domain} answered HTTP 200 without Service Token headers`,
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOTFOUND|getaddrinfo|Could not resolve host/i.test(msg)) {
      warn(
        "Public DNS Route",
        `Domain ${domain} does not resolve in public DNS yet. Ensure CNAME points to your tunnel.`,
      );
    } else {
      warn("Cloudflare Access Gate", `Probe failed: ${msg}`);
    }
  }

  if (cfClientId && cfClientSecret) {
    try {
      const pubAuth = await fetcher(`https://${domain}/healthz`, {
        headers: {
          "CF-Access-Client-Id": cfClientId,
          "CF-Access-Client-Secret": cfClientSecret,
        },
        signal: AbortSignal.timeout(4000),
      });
      if (pubAuth.ok) {
        pass("Cloudflare Service Token", "Service Token admitted by Cloudflare Access");
      } else {
        fail(
          "Cloudflare Service Token",
          `Rejected by Cloudflare Access with HTTP ${pubAuth.status}`,
        );
      }
    } catch {
      // DNS or network timeout already warned above
    }
  }

  return { lines, exitCode: allPass ? 0 : 1 };
}

if (import.meta.main) {
  const result = await runGatewayDoctor();
  for (const line of result.lines) {
    if (line.startsWith("PASS")) {
      console.log(`\x1b[32m${line}\x1b[0m`);
    } else if (line.startsWith("WARN")) {
      console.log(`\x1b[33m${line}\x1b[0m`);
    } else {
      console.log(`\x1b[31m${line}\x1b[0m`);
    }
  }
  process.exit(result.exitCode);
}
