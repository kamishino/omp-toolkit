import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export interface WireMessage {
  role: "user" | "assistant" | "model" | "system" | "developer";
  content?: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  function_call?: unknown;
  tool_calls?: unknown[];
}

export interface WireContentPart {
  text?: string;
  functionCall?: unknown;
  functionResponse?: unknown;
  [key: string]: unknown;
}

export interface WireContent {
  role: string;
  parts: WireContentPart[];
}

export interface ProviderPayload {
  model?: string;
  messages?: WireMessage[];
  contents?: WireContent[];
  [key: string]: unknown;
}

/**
 * Returns true if the outgoing request targets a Gemini model or provider.
 */
export function isGeminiRequest(providerId?: string, modelId?: string): boolean {
  const p = (providerId ?? "").toLowerCase();
  const m = (modelId ?? "").toLowerCase();
  return p.includes("google") || p.includes("gemini") || m.includes("gemini");
}

/**
 * Scrubs reflective first-person monologue from historical assistant turns
 * to prevent Gemini's self-suppression behavior (Google AI Dev Forum #180934).
 */
export function scrubReflectiveMonologue(text: string): string {
  return text
    .replace(/Looking back at .*?\./gi, "")
    .replace(/It is my free time.*?(\.\s|\n|$)/gi, "")
    .replace(/I will watch over them quietly.*?(\.\s|\n|$)/gi, "")
    .replace(/I think I will keep this to myself.*?(\.\s|\n|$)/gi, "")
    .trim();
}

/**
 * Strips conversational setup sentences preceding a tool call to prevent
 * Malformed_Function_Call errors on strict Gemini endpoints.
 */
export function stripPreToolChatter(text: string): string {
  return text.replace(/^(?:I will now|Let me|I am going to)\s+[^\n.]+(?:\.|\n)+/gi, "").trim();
}

/**
 * Normalizes OpenAI/Responses message arrays for Gemini compatibility.
 * 1. Appends a user continuation if history ends on assistant/model turn (OMP #14790).
 * 2. Scrubs reflective text from past assistant messages.
 * 3. Cleans pre-tool conversational chatter when tool calls exist.
 */
export function normalizeMessagesArray(messages: WireMessage[]): WireMessage[] {
  if (messages.length === 0) return messages;

  const cleaned: WireMessage[] = messages.map((msg, index) => {
    const isHistorical = index < messages.length - 1;
    let content = msg.content;

    if (msg.role === "assistant" && typeof content === "string") {
      if (isHistorical) {
        content = scrubReflectiveMonologue(content);
      }
      if (msg.tool_calls?.length || msg.function_call) {
        content = stripPreToolChatter(content);
      }
      return { ...msg, content };
    }

    return msg;
  });

  const last = cleaned[cleaned.length - 1];
  if (last.role === "assistant" || last.role === "model") {
    cleaned.push({
      role: "user",
      content: "Proceed with the pending task.",
    });
  }

  return cleaned;
}

/**
 * Normalizes native Google Generative AI / Vertex contents arrays.
 * Ensures the conversation does not terminate on a model turn and scrubs
 * reflective text from prior model turns.
 */
export function normalizeContentsArray(contents: WireContent[]): WireContent[] {
  if (contents.length === 0) return contents;

  const cleaned: WireContent[] = contents.map((entry, index) => {
    const isHistorical = index < contents.length - 1;
    if (entry.role === "model" && isHistorical) {
      const parts = entry.parts.map((part) => {
        if (typeof part.text === "string") {
          return { ...part, text: scrubReflectiveMonologue(part.text) };
        }
        return part;
      });
      return { ...entry, parts };
    }
    return entry;
  });

  const last = cleaned[cleaned.length - 1];
  if (last.role === "model") {
    cleaned.push({
      role: "user",
      parts: [{ text: "Proceed with the required action." }],
    });
  }

  return cleaned;
}

/**
 * Registers the Gemini wire protocol and turn normalizer on an OMP extension instance.
 */
export function registerGeminiNormalizer(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event: unknown, ctx: ExtensionContext) => {
    const ev = event as { payload?: ProviderPayload } | undefined;
    const payload = ev?.payload;
    if (!payload || typeof payload !== "object") return payload;

    const providerId = ctx.model?.provider;
    const modelId = ctx.model?.id;

    if (!isGeminiRequest(providerId, modelId)) {
      return payload;
    }

    if (Array.isArray(payload.messages) && payload.messages.length > 0) {
      payload.messages = normalizeMessagesArray(payload.messages);
    }

    if (Array.isArray(payload.contents) && payload.contents.length > 0) {
      payload.contents = normalizeContentsArray(payload.contents);
    }

    return payload;
  });
}
