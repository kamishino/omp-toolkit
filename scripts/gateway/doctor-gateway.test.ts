import { describe, expect, test } from "bun:test";
import { runGatewayDoctor } from "./doctor-gateway";

describe("runGatewayDoctor", () => {
  test("all checks pass in a healthy environment", async () => {
    const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);

      if (url.includes(":8765/v1/healthz")) {
        return new Response(JSON.stringify({ ok: true, version: "18.15.0" }), { status: 200 });
      }

      if (url.includes(":4000/healthz")) {
        return new Response(JSON.stringify({ ok: true, version: "18.15.0" }), { status: 200 });
      }

      if (url.includes(":4000/v1/models")) {
        const headers = init?.headers as Record<string, string> | undefined;
        if (!headers?.Authorization) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
        return new Response(JSON.stringify({ data: [{ id: "model-1" }, { id: "model-2" }] }), {
          status: 200,
        });
      }

      if (url.includes("gateway.example.com/healthz")) {
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers?.["CF-Access-Client-Id"] && headers?.["CF-Access-Client-Secret"]) {
          return new Response(JSON.stringify({ ok: true, ready: true }), { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      }

      return new Response("Not Found", { status: 404 });
    };

    const fakeExec = async () => ({
      stdout: "Image Name     PID   Session Name\ncloudflared.exe 1234 Console",
    });

    const result = await runGatewayDoctor({
      fetchFn: fakeFetch as typeof fetch,
      execFileFn: fakeExec,
      fileExists: () => true,
      readTextFile: (p) => {
        if (p.endsWith("auth-gateway.token")) return "mock-token-xyz";
        if (p.endsWith("cf-access.json")) {
          return JSON.stringify({
            clientId: "mock-id.access",
            clientSecret: "mock-secret",
            domain: "gateway.example.com",
          });
        }
        return "";
      },
      brokerPort: 8765,
      gatewayPort: 4000,
      domain: "gateway.example.com",
    });

    expect(result.exitCode).toBe(0);
    expect(result.lines.some((l) => l.includes("PASS Broker Liveness"))).toBe(true);
    expect(result.lines.some((l) => l.includes("PASS Gateway Liveness"))).toBe(true);
    expect(result.lines.some((l) => l.includes("PASS Gateway Auth Gate"))).toBe(true);
    expect(result.lines.some((l) => l.includes("PASS Model Catalog: 2 models"))).toBe(true);
    expect(result.lines.some((l) => l.includes("PASS Cloudflare Tunnel Process"))).toBe(true);
    expect(result.lines.some((l) => l.includes("PASS Cloudflare Access Gate"))).toBe(true);
    expect(result.lines.some((l) => l.includes("PASS Cloudflare Service Token"))).toBe(true);
  });

  test("fails when Broker is down", async () => {
    const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes(":8765/v1/healthz")) {
        throw new Error("Connection refused");
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const result = await runGatewayDoctor({
      fetchFn: fakeFetch as typeof fetch,
      execFileFn: async () => ({ stdout: "" }),
      fileExists: () => false,
      brokerPort: 8765,
      gatewayPort: 4000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.lines.some((l) => l.includes("FAIL Broker Liveness"))).toBe(true);
  });

  test("fails when Gateway is down", async () => {
    const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes(":8765/v1/healthz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes(":4000/healthz")) {
        throw new Error("Connection refused");
      }
      return new Response("Not Found", { status: 404 });
    };

    const result = await runGatewayDoctor({
      fetchFn: fakeFetch as typeof fetch,
      execFileFn: async () => ({ stdout: "" }),
      fileExists: () => false,
      brokerPort: 8765,
      gatewayPort: 4000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.lines.some((l) => l.includes("FAIL Gateway Liveness"))).toBe(true);
  });
});
