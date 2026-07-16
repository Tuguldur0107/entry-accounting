import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiMessages } from "@/lib/db/schema";
import {
  AI_STABLE_SYSTEM_PROMPT,
  buildDynamicContext,
} from "@/lib/ai/system-prompt";

// Streaming + DB тул Node runtime; урт хариултад зай үлдээнэ.
export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = "claude-opus-4-8";
const HISTORY_LIMIT = 30;
const MAX_INPUT_CHARS = 4000;

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error:
          "AI туслах тохируулагдаагүй байна — .env.local файлд ANTHROPIC_API_KEY нэмнэ үү.",
      },
      { status: 503 }
    );
  }

  let message: string;
  try {
    const body = await request.json();
    message = typeof body?.message === "string" ? body.message.trim() : "";
  } catch {
    message = "";
  }
  if (!message) {
    return Response.json({ error: "Хоосон мессеж" }, { status: 400 });
  }
  if (message.length > MAX_INPUT_CHARS) {
    return Response.json(
      { error: `Мессеж хэт урт байна (дээд тал нь ${MAX_INPUT_CHARS} тэмдэгт)` },
      { status: 400 }
    );
  }

  // Түүхийг мессежийг хадгалахаас ӨМНӨ уншина — давхар орохоос сэргийлнэ.
  const history = await db.query.aiMessages.findMany({
    where: eq(aiMessages.userId, userId),
    orderBy: [asc(aiMessages.createdAt)],
  });
  const recent = history.slice(-HISTORY_LIMIT);

  await db
    .insert(aiMessages)
    .values({ userId, role: "user", content: message });

  const dynamicContext = await buildDynamicContext(userId);

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: AI_STABLE_SYSTEM_PROMPT,
        // Тогтвортой prefix — дараагийн хүсэлтүүдэд кэшээс уншигдана.
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: dynamicContext },
    ],
    messages: [
      ...recent.map((entry) => ({
        role: entry.role as "user" | "assistant",
        content: entry.content,
      })),
      { role: "user" as const, content: message },
    ],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            full += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal" && !full.trim()) {
          const fallback =
            "Уучлаарай, энэ асуултад хариулах боломжгүй байна. Өөр асуулт асуугаарай.";
          full = fallback;
          controller.enqueue(encoder.encode(fallback));
        }
        if (full.trim()) {
          await db
            .insert(aiMessages)
            .values({ userId, role: "assistant", content: full });
        }
        controller.close();
      } catch (caught) {
        // Тасарсан хариултын хагасыг хадгалахгүй; клиент алдааг toast-оор үзүүлнэ.
        console.error("AI chat stream error:", caught);
        controller.error(caught);
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Харилцан ярианы түүхийг бүхэлд нь цэвэрлэнэ. */
export async function DELETE() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  }
  await db
    .delete(aiMessages)
    .where(and(eq(aiMessages.userId, userId)));
  return Response.json({ ok: true });
}
