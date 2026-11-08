import type { HealthResult } from "@omp-toolkit/core";

export type StreamProbeVerdict = Pick<HealthResult, "status" | "failureKind" | "detail">;

export function classifyInBandError(err: unknown): StreamProbeVerdict {
  if (!err || typeof err !== "object") {
    return {
      status: "error",
      failureKind: "protocol",
      detail: "unrecognized stream error payload",
    };
  }

  const errObj = err as Record<string, unknown>;
  const codeNum = typeof errObj.code === "number" ? errObj.code : Number(errObj.code);
  const statusStr = typeof errObj.status === "string" ? errObj.status.trim() : "";
  const msgStr = typeof errObj.message === "string" ? errObj.message.trim() : "";
  const detail =
    `${statusStr ? `${statusStr}: ` : ""}${msgStr || String(codeNum || "error")}`.slice(0, 150);

  // 1. Quota & Rate Limit (explicit quota takes precedence)
  if (
    codeNum === 429 ||
    statusStr === "RESOURCE_EXHAUSTED" ||
    /RESOURCE_EXHAUSTED/i.test(statusStr) ||
    /resource has been exhausted|quota exceeded|rate limit/i.test(msgStr)
  ) {
    return { status: "error", failureKind: "rate-limit", detail };
  }

  // 2. Authentication & Authorization
  if (
    codeNum === 401 ||
    codeNum === 403 ||
    statusStr === "UNAUTHENTICATED" ||
    statusStr === "PERMISSION_DENIED" ||
    /UNAUTHENTICATED|PERMISSION_DENIED/i.test(statusStr)
  ) {
    return { status: "auth", failureKind: "auth", detail };
  }

  // 3. Model Error
  if (codeNum === 404 || statusStr === "NOT_FOUND" || /NOT_FOUND/i.test(statusStr)) {
    return { status: "model-error", failureKind: "model", detail };
  }

  // 4. Transient / Retryable
  if (
    codeNum === 408 ||
    codeNum === 500 ||
    codeNum === 502 ||
    codeNum === 503 ||
    codeNum === 504 ||
    statusStr === "UNAVAILABLE" ||
    statusStr === "DEADLINE_EXCEEDED" ||
    statusStr === "INTERNAL" ||
    /UNAVAILABLE|DEADLINE_EXCEEDED|INTERNAL/i.test(statusStr)
  ) {
    return { status: "error", failureKind: "transient", detail };
  }

  // 5. Other / Protocol
  return { status: "error", failureKind: "protocol", detail };
}

export function classifyHttpResponse(httpStatus: number, bodyText: string): StreamProbeVerdict {
  // If response body contains a structured error payload, inspect it first
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      const innerErr =
        parsed.error ?? (parsed.response as Record<string, unknown> | undefined)?.error;
      if (innerErr && typeof innerErr === "object") {
        return classifyInBandError(innerErr);
      }
    } catch {
      // Non-JSON fallback below
    }
  }

  const snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 150);
  const detail = `${httpStatus}${snippet ? ` ${snippet}` : ""}`;

  if (httpStatus === 429) {
    return { status: "error", failureKind: "rate-limit", detail };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { status: "auth", failureKind: "auth", detail };
  }
  if (httpStatus === 404) {
    return { status: "model-error", failureKind: "model", detail };
  }
  if (
    httpStatus === 408 ||
    httpStatus === 500 ||
    httpStatus === 502 ||
    httpStatus === 503 ||
    httpStatus === 504
  ) {
    return { status: "error", failureKind: "transient", detail };
  }

  return { status: "error", failureKind: "protocol", detail };
}

const MAX_EVENT_BUFFER_BYTES = 64 * 1024; // 64 KiB bound

/**
 * Parses an SSE stream from Google Antigravity and verifies completed model response.
 *
 * Requirements:
 * - Frames events by blank lines (\n\n or \r\n\r\n) across arbitrary chunks
 * - Bounded buffer: single event exceeding 64 KiB fails with protocol error
 * - Inspects root and envelope errors before candidate output
 * - Accumulates non-whitespace, non-thought model text from one candidate
 * - Requires terminal finishReason ("STOP" | "MAX_TOKENS") and clean stream end before OK
 * - Closes and cancels reader on all exit paths
 */
export async function inspectProbeStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<StreamProbeVerdict> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");

  const { promise: abortPromise, reject: abortReject } = Promise.withResolvers<never>();
  const onAbort = () => {
    void reader.cancel().catch(() => {});
    abortReject(signal.reason ?? new Error("The operation was aborted"));
  };

  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  let rawBuffer = "";
  let accumulatedText = "";
  let terminalReasonFound = false;
  let seenCandidate = false;

  const processEventBlock = (block: string): StreamProbeVerdict | null => {
    const lines = block.split(/\r?\n/);
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith(":")) {
        // SSE comment, ignore
        continue;
      }
      if (line.startsWith("data:")) {
        const payload = line.slice(5).replace(/^ /, "");
        dataLines.push(payload);
      }
    }

    if (dataLines.length === 0) {
      return null;
    }

    const joinedData = dataLines.join("\n").trim();
    if (joinedData === "[DONE]") {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(joinedData);
    } catch {
      return {
        status: "error",
        failureKind: "protocol",
        detail: "malformed JSON in SSE event",
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return {
        status: "error",
        failureKind: "protocol",
        detail: "empty or invalid SSE payload object",
      };
    }

    const payloadObj = parsed as Record<string, unknown>;

    // 1. Check in-band error (root or envelope)
    const inBandError =
      payloadObj.error ??
      (payloadObj.response && typeof payloadObj.response === "object"
        ? (payloadObj.response as Record<string, unknown>).error
        : undefined);

    if (inBandError && typeof inBandError === "object") {
      return classifyInBandError(inBandError);
    }

    // 2. Unpack candidate responses (direct or wrapped in response envelope)
    const container =
      payloadObj.response && typeof payloadObj.response === "object"
        ? (payloadObj.response as Record<string, unknown>)
        : payloadObj;

    const candidates = container.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      if (container.promptFeedback && typeof container.promptFeedback === "object") {
        const feedback = container.promptFeedback as { blockReason?: string };
        if (feedback.blockReason) {
          return {
            status: "error",
            failureKind: "protocol",
            detail: `prompt blocked: ${feedback.blockReason}`,
          };
        }
      }
      return null;
    }

    seenCandidate = true;
    const cand = candidates[0] as {
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      finishReason?: string;
    };

    if (cand && typeof cand === "object") {
      const parts = cand.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part && typeof part === "object" && typeof part.text === "string" && !part.thought) {
            accumulatedText += part.text;
          }
        }
      }

      if (cand.finishReason) {
        if (cand.finishReason === "STOP" || cand.finishReason === "MAX_TOKENS") {
          terminalReasonFound = true;
        } else {
          return {
            status: "error",
            failureKind: "protocol",
            detail: `generation blocked: ${cand.finishReason}`,
          };
        }
      }
    }

    return null;
  };

  try {
    while (true) {
      const readResult = await Promise.race([reader.read(), abortPromise]);
      const { value, done } = readResult;
      if (done) {
        break;
      }

      rawBuffer += decoder.decode(value, { stream: true });

      if (rawBuffer.length > MAX_EVENT_BUFFER_BYTES) {
        return {
          status: "error",
          failureKind: "protocol",
          detail: "SSE event buffer exceeded 64 KiB",
        };
      }

      while (true) {
        const idxCrlf = rawBuffer.indexOf("\r\n\r\n");
        const idxLf = rawBuffer.indexOf("\n\n");

        if (idxCrlf === -1 && idxLf === -1) {
          break;
        }

        let delimiterIndex: number;
        let delimLength = 2;
        if (idxCrlf !== -1 && (idxLf === -1 || idxCrlf < idxLf)) {
          delimiterIndex = idxCrlf;
          delimLength = 4;
        } else {
          delimiterIndex = idxLf;
          delimLength = 2;
        }

        const eventBlock = rawBuffer.slice(0, delimiterIndex);
        rawBuffer = rawBuffer.slice(delimiterIndex + delimLength);

        if (eventBlock.trim().length > 0) {
          const earlyVerdict = processEventBlock(eventBlock);
          if (earlyVerdict) {
            return earlyVerdict;
          }
        }
      }
    }

    // Flush any remaining final event at EOF
    const remaining = rawBuffer.trim();
    if (remaining.length > 0) {
      const finalVerdict = processEventBlock(remaining);
      if (finalVerdict) {
        return finalVerdict;
      }
    }

    if (signal.aborted) {
      throw signal.reason ?? new Error("The operation was aborted");
    }

    // Check completed model response criteria
    if (!seenCandidate || accumulatedText.trim().length === 0) {
      return {
        status: "error",
        failureKind: "protocol",
        detail: "stream closed without model text",
      };
    }

    if (!terminalReasonFound) {
      return {
        status: "error",
        failureKind: "protocol",
        detail: "stream closed before terminal finishReason",
      };
    }

    return {
      status: "ok",
      failureKind: null,
    };
  } finally {
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
  }
}
