import { describe, expect, test } from "bun:test";
import { classifyHttpResponse, inspectProbeStream } from "./probe-stream";

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
}

describe("inspectProbeStream and error classification", () => {
  test("classifies in-band SSE 401/403 error payload as auth", async () => {
    const stream = makeStream([
      'data: {"error":{"code":401,"status":"UNAUTHENTICATED","message":"Invalid credential"}}\n\n',
    ]);
    const verdict = await inspectProbeStream(stream, new AbortController().signal);
    expect(verdict.status).toBe("auth");
    expect(verdict.failureKind).toBe("auth");
    expect(verdict.detail).toContain("UNAUTHENTICATED");
  });

  test("classifies in-band SSE 429 RESOURCE_EXHAUSTED as rate-limit", async () => {
    const stream = makeStream([
      'data: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}\n\n',
    ]);
    const verdict = await inspectProbeStream(stream, new AbortController().signal);
    expect(verdict.status).toBe("error");
    expect(verdict.failureKind).toBe("rate-limit");
    expect(verdict.detail).toContain("RESOURCE_EXHAUSTED");
  });

  test("classifies in-band transient error (503/UNAVAILABLE) as transient", async () => {
    const stream = makeStream([
      'data: {"error":{"code":503,"status":"UNAVAILABLE","message":"Backend overloaded"}}\n\n',
    ]);
    const verdict = await inspectProbeStream(stream, new AbortController().signal);
    expect(verdict.status).toBe("error");
    expect(verdict.failureKind).toBe("transient");
  });

  test("returns ok for fragmented SSE chunks with comments and valid candidate output", async () => {
    const stream = makeStream([
      ": comment ping\n",
      'data: {"candidates":[{"content":{"parts":[{"text":"O"}]}}]}\n\n',
      ": another comment\n",
      'data: {"candidates":[{"content":{"parts":[{"text":"K"}]},"finishReason":"STOP"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const verdict = await inspectProbeStream(stream, new AbortController().signal);
    expect(verdict.status).toBe("ok");
    expect(verdict.failureKind).toBeNull();
  });

  test("rejects [DONE] alone without text or finishReason", async () => {
    const stream = makeStream(["data: [DONE]\n\n"]);
    const verdict = await inspectProbeStream(stream, new AbortController().signal);
    expect(verdict.status).toBe("error");
    expect(verdict.failureKind).toBe("protocol");
    expect(verdict.detail).toContain("without model text");
  });

  test("rejects thought-only candidate parts", async () => {
    const stream = makeStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"thinking...","thought":true}]},"finishReason":"STOP"}]}\n\n',
    ]);
    const verdict = await inspectProbeStream(stream, new AbortController().signal);
    expect(verdict.status).toBe("error");
    expect(verdict.failureKind).toBe("protocol");
    expect(verdict.detail).toContain("without model text");
  });

  test("rejects stream closed before terminal finishReason", async () => {
    const stream = makeStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\n\n',
    ]);
    const verdict = await inspectProbeStream(stream, new AbortController().signal);
    expect(verdict.status).toBe("error");
    expect(verdict.failureKind).toBe("protocol");
    expect(verdict.detail).toContain("before terminal finishReason");
  });

  test("rejects stream when candidate finishReason is SAFETY or blocked", async () => {
    const stream = makeStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]},"finishReason":"SAFETY"}]}\n\n',
    ]);
    const verdict = await inspectProbeStream(stream, new AbortController().signal);
    expect(verdict.status).toBe("error");
    expect(verdict.failureKind).toBe("protocol");
    expect(verdict.detail).toContain("SAFETY");
  });

  test("prioritizes in-band error even if model text was emitted earlier", async () => {
    const stream = makeStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
      'data: {"error":{"code":401,"status":"UNAUTHENTICATED","message":"Session revoked"}}\n\n',
    ]);
    const verdict = await inspectProbeStream(stream, new AbortController().signal);
    expect(verdict.status).toBe("auth");
    expect(verdict.failureKind).toBe("auth");
  });

  test("rejects single event exceeding 64 KiB buffer bound", async () => {
    const hugeChunk = "a".repeat(70 * 1024);
    const stream = makeStream([`data: ${hugeChunk}\n\n`]);
    const verdict = await inspectProbeStream(stream, new AbortController().signal);
    expect(verdict.status).toBe("error");
    expect(verdict.failureKind).toBe("protocol");
    expect(verdict.detail).toContain("exceeded 64 KiB");
  });

  test("handles CRLF multiline data framing", async () => {
    const stream = makeStream([
      'data: {\r\ndata: "candidates": [{"content": {"parts": [{"text": "Done"}]}, "finishReason": "MAX_TOKENS"}]\r\ndata: }\r\n\r\n',
    ]);
    const verdict = await inspectProbeStream(stream, new AbortController().signal);
    expect(verdict.status).toBe("ok");
    expect(verdict.failureKind).toBeNull();
  });

  test("classifyHttpResponse classifies 401, 404, 429, 503 and in-band JSON body", () => {
    expect(classifyHttpResponse(401, "Unauthorized").status).toBe("auth");
    expect(classifyHttpResponse(404, "Not Found").status).toBe("model-error");
    expect(classifyHttpResponse(429, "Too Many Requests").failureKind).toBe("rate-limit");
    expect(classifyHttpResponse(503, "Service Unavailable").failureKind).toBe("transient");

    // In-band JSON inside 200 or 500
    const inBand = JSON.stringify({
      error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Out of quota" },
    });
    const parsed = classifyHttpResponse(200, inBand);
    expect(parsed.failureKind).toBe("rate-limit");
  });
});
