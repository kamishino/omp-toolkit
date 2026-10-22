import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
  isGeminiRequest,
  normalizeContentsArray,
  normalizeMessagesArray,
  type ProviderPayload,
  registerGeminiNormalizer,
  scrubReflectiveMonologue,
  stripPreToolChatter,
  type WireContent,
  type WireMessage,
} from "./gemini-normalizer";

describe("gemini-normalizer", () => {
  describe("isGeminiRequest", () => {
    test("detects Google and Gemini providers and model IDs", () => {
      expect(isGeminiRequest("google-antigravity", "gemini-3.8-flash-high")).toBe(true);
      expect(isGeminiRequest("google-gemini-cli", "gemini-3.8-flash")).toBe(true);
      expect(isGeminiRequest("google", "gemini-2.5-flash")).toBe(true);
      expect(isGeminiRequest("google-vertex", "gemini-4-argon")).toBe(true);
      expect(isGeminiRequest(undefined, "gemini-3.8-flash")).toBe(true);
      expect(isGeminiRequest("openrouter", "google/gemini-3.8-flash")).toBe(true);
    });

    test("returns false for non-Gemini providers and models", () => {
      expect(isGeminiRequest("deepseek", "deepseek-flash")).toBe(false);
      expect(isGeminiRequest("anthropic", "claude-sonnet-4-5")).toBe(false);
      expect(isGeminiRequest("openai", "gpt-5.4-mini")).toBe(false);
      expect(isGeminiRequest(undefined, undefined)).toBe(false);
    });
  });

  describe("scrubReflectiveMonologue", () => {
    test("removes first-person reflective monologue while preserving factual text", () => {
      const input =
        "Looking back at those memories made my chest feel warm. It is my free time. " +
        "Found 3 syntax errors in packages/core/src/dashboard.ts.";
      const scrubbed = scrubReflectiveMonologue(input);
      expect(scrubbed).not.toContain("Looking back");
      expect(scrubbed).not.toContain("free time");
      expect(scrubbed).toContain("Found 3 syntax errors in packages/core/src/dashboard.ts.");
    });
  });

  describe("stripPreToolChatter", () => {
    test("cleans leading conversational preamble when tool calls exist", () => {
      const input = "I will now read the file.\n\nTarget line 42.";
      expect(stripPreToolChatter(input)).toBe("Target line 42.");

      const input2 = "Let me inspect the code.\nDone.";
      expect(stripPreToolChatter(input2)).toBe("Done.");
    });
  });

  describe("normalizeMessagesArray", () => {
    test("appends user continuation when message history ends on assistant turn (fixes OMP #14790)", () => {
      const messages: WireMessage[] = [
        { role: "user", content: "Fix the bug" },
        { role: "assistant", content: "I found the bug." },
      ];

      const normalized = normalizeMessagesArray(messages);
      expect(normalized.length).toBe(3);
      expect(normalized[2].role).toBe("user");
      expect(normalized[2].content).toBe("Proceed with the pending task.");
    });

    test("leaves message history ending in user turn untouched in length", () => {
      const messages: WireMessage[] = [
        { role: "user", content: "Check status" },
        { role: "assistant", content: "Status is ok" },
        { role: "user", content: "Thanks!" },
      ];

      const normalized = normalizeMessagesArray(messages);
      expect(normalized.length).toBe(3);
      expect(normalized[2].role).toBe("user");
    });

    test("scrubs reflective monologue from historical assistant turns", () => {
      const messages: WireMessage[] = [
        {
          role: "assistant",
          content:
            "Looking back at the past ride made me feel warm. I will watch over them quietly. Step 1 is ready.",
        },
        { role: "user", content: "Continue" },
      ];

      const normalized = normalizeMessagesArray(messages);
      expect(normalized[0].content).toBe("Step 1 is ready.");
      expect(normalized[0].content).not.toContain("Looking back");
    });

    test("strips pre-tool chatter when assistant turn has tool calls", () => {
      const messages: WireMessage[] = [
        {
          role: "assistant",
          content: "I will now read the file.\n\nExecuting.",
          tool_calls: [{ id: "call_1", type: "function" }],
        },
        { role: "user", content: "Result" },
      ];

      const normalized = normalizeMessagesArray(messages);
      expect(normalized[0].content).toBe("Executing.");
    });
  });

  describe("normalizeContentsArray", () => {
    test("appends user part when native Google contents end on model turn", () => {
      const contents: WireContent[] = [
        { role: "user", parts: [{ text: "Hello" }] },
        { role: "model", parts: [{ text: "I finished step 1." }] },
      ];

      const normalized = normalizeContentsArray(contents);
      expect(normalized.length).toBe(3);
      expect(normalized[2].role).toBe("user");
      expect(normalized[2].parts[0].text).toBe("Proceed with the required action.");
    });

    test("preserves contents ending on user turn", () => {
      const contents: WireContent[] = [
        { role: "user", parts: [{ text: "Run check" }] },
        { role: "model", parts: [{ text: "Done" }] },
        { role: "user", parts: [{ text: "Next" }] },
      ];

      const normalized = normalizeContentsArray(contents);
      expect(normalized.length).toBe(3);
    });

    test("scrubs reflective monologue in historical model turns", () => {
      const contents: WireContent[] = [
        {
          role: "model",
          parts: [
            { text: "Looking back at those memories made my chest feel warm. Plan created." },
          ],
        },
        { role: "user", parts: [{ text: "Next step" }] },
      ];

      const normalized = normalizeContentsArray(contents);
      expect(normalized[0].parts[0].text).toBe("Plan created.");
    });
  });

  describe("registerGeminiNormalizer", () => {
    test("intercepts and normalizes Gemini requests via before_provider_request", () => {
      let registeredEvent = "";
      type Handler = (
        event: { payload?: ProviderPayload },
        ctx: ExtensionContext,
      ) => ProviderPayload | undefined;
      let handlerFn: Handler | undefined;

      const mockPi = {
        on(event: string, handler: unknown) {
          registeredEvent = event;
          handlerFn = handler as Handler;
        },
      } as unknown as ExtensionAPI;

      registerGeminiNormalizer(mockPi);
      expect(registeredEvent).toBe("before_provider_request");
      expect(handlerFn).not.toBeNull();

      const mockCtx = {
        model: { provider: "google-antigravity", id: "gemini-3.8-flash-high" },
      } as unknown as ExtensionContext;

      const payload: ProviderPayload = {
        messages: [
          { role: "user", content: "Query" },
          { role: "assistant", content: "Answer" },
        ],
      };
      const fn = handlerFn;
      if (!fn) throw new Error("Expected handler to be registered");
      const result = fn({ payload }, mockCtx);
      expect(result?.messages?.length).toBe(3);
      expect(result?.messages?.[2].role).toBe("user");
    });

    test("skips normalization for non-Gemini models", () => {
      type Handler = (
        event: { payload?: ProviderPayload },
        ctx: ExtensionContext,
      ) => ProviderPayload | undefined;
      let handlerFn: Handler | undefined;

      const mockPi = {
        on(_event: string, handler: unknown) {
          handlerFn = handler as Handler;
        },
      } as unknown as ExtensionAPI;
      registerGeminiNormalizer(mockPi);

      const mockCtx = {
        model: { provider: "deepseek", id: "deepseek-flash" },
      } as unknown as ExtensionContext;

      const payload: ProviderPayload = {
        messages: [
          { role: "user", content: "Query" },
          { role: "assistant", content: "Answer" },
        ],
      };
      const fn = handlerFn;
      if (!fn) throw new Error("Expected handler to be registered");
      const result = fn({ payload }, mockCtx);
      expect(result?.messages?.length).toBe(2);
    });
  });
});
