// OpenAI adapter — chat.completions streaming + function calling.
// Anthropic-ийн үндсэн замтай ИЖИЛ tool давхарга (lib/ai/tools.ts) ашиглана;
// зөвхөн wire формат нь өөр. SDK нэмэлгүй, raw HTTP (fetch + SSE).

import { createMarkerSanitizer } from "./action-markers";
import { AI_TOOLS, executeAiTool, type AiToolResult } from "./tools";
import type { AiWriteMode } from "./models";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_ROUNDS = 8;

type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type OpenAiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OpenAiContentPart[] }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export class OpenAiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "OpenAiError";
  }
}

interface ToolCallDraft {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Нэг completion хүсэлтийг стримлэнэ. Текстийг onText-оор урсгаж,
 * tool_calls хуримтлагдвал буцаана.
 */
async function streamOnce(
  apiKey: string,
  body: Record<string, unknown>,
  onText: (text: string) => void
): Promise<{ finishReason: string; text: string; toolCalls: ToolCallDraft[] }> {
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!response.ok || !response.body) {
    const detail = await response
      .json()
      .then((data) => data?.error?.message as string | undefined)
      .catch(() => undefined);
    throw new OpenAiError(detail ?? `OpenAI ${response.status}`, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finishReason = "stop";
  const toolCalls: ToolCallDraft[] = [];

  const handleLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let parsed: {
      choices?: {
        delta?: {
          content?: string | null;
          tool_calls?: {
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
        finish_reason?: string | null;
      }[];
    };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const choice = parsed.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) return;
    if (delta.content) {
      text += delta.content;
      onText(delta.content);
    }
    for (const call of delta.tool_calls ?? []) {
      const slot = (toolCalls[call.index] ??= { id: "", name: "", arguments: "" });
      if (call.id) slot.id = call.id;
      if (call.function?.name) slot.name += call.function.name;
      if (call.function?.arguments) slot.arguments += call.function.arguments;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      handleLine(buffer.slice(0, newlineIndex).trim());
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  handleLine(buffer.trim());

  return { finishReason, text, toolCalls: toolCalls.filter((call) => call.id) };
}

/**
 * OpenAI дээрх бүрэн agent давталт: текст урсгана, tool дуудлагыг
 * гүйцэтгэж (onAction-д action мэдэгдэнэ) дахин асууна.
 * Буцаах утга: моделийн бүрэн текст (marker-гүй — route нь өөрөө нэмнэ).
 */
export async function runOpenAiAgent(options: {
  apiKey: string;
  model: string;
  system: string;
  messages: OpenAiMessage[];
  userId: string;
  mode: AiWriteMode;
  onText: (text: string) => void;
  onToolResult: (result: AiToolResult) => void;
}): Promise<void> {
  const tools = AI_TOOLS.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));

  const convo: OpenAiMessage[] = [
    { role: "system", content: options.system },
    ...options.messages,
  ];

  // Моделийн текстээс [[EA_ACTION: угтварыг идэвхгүй болгож байж onText-руу
  // (стрим + DB-д хадгалагдах контент) дамжуулна — клиент маркерыг жинхэнэ
  // ActionCard гэж зурдаг тул зөвхөн route-ийн server-injected actionMarker()
  // л амьд үлдэх ёстой (forgery хамгаалалт, Anthropic замтай ижил).
  const modelText = createMarkerSanitizer();
  const emitSanitized = (chunk: string) => {
    const safe = modelText.push(chunk);
    if (safe) options.onText(safe);
  };
  const flushSanitized = () => {
    const rest = modelText.flush();
    if (rest) options.onText(rest);
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { finishReason, text, toolCalls } = await streamOnce(
      options.apiKey,
      { model: options.model, messages: convo, tools },
      emitSanitized
    );
    // Эргэлт бүрийн төгсгөлд барьсан сүүлийг гаргана — дараа нь ирэх
    // серверийн маркертай дараалал холилдохгүй.
    flushSanitized();

    if (finishReason !== "tool_calls" || toolCalls.length === 0) return;

    convo.push({
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    for (const call of toolCalls) {
      let input: unknown = {};
      try {
        input = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        input = {};
      }
      const result = await executeAiTool(options.userId, call.name, input, options.mode);
      options.onToolResult(result);
      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: result.resultText,
      });
    }
  }
}
