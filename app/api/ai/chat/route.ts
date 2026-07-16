import Anthropic from "@anthropic-ai/sdk";
import { desc, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiAttachments, aiMessages, aiSettings } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/ai/crypto";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import {
  AI_MODELS,
  DEFAULT_AI_EFFORT,
  DEFAULT_AI_MODEL,
  isAiEffort,
  isAiModelId,
} from "@/lib/ai/models";
import {
  AI_STABLE_SYSTEM_PROMPT,
  buildDynamicContext,
} from "@/lib/ai/system-prompt";

// Streaming + DB тул Node runtime; урт хариултад зай үлдээнэ.
export const runtime = "nodejs";
export const maxDuration = 120;

const HISTORY_LIMIT = 30;
const MAX_INPUT_CHARS = 4000;

// Хавсралтын хязгаарууд (base64 тэмдэгтээр — binary ~ ×0.75).
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_CHARS = 7_000_000; // ~5MB файл
const MAX_TOTAL_CHARS = 11_000_000; // ~8MB нийт
// Body-г уншихаас ӨМНӨ Content-Length-ээр таслах дээд хэмжээ — том биетэй
// хүсэлт санах ойд бүрэн ачаалагдахаас сэргийлнэ.
const MAX_BODY_BYTES = 13_000_000;
// Түүхээс дахин илгээх хавсралтын нийт багц — токен/латенси хамгаалалт.
const REPLAY_BUDGET_CHARS = 8_000_000;
const MAX_TEXT_ATTACHMENT_CHARS = 50_000;

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const TEXT_TYPES = new Set(["text/plain", "text/csv", "text/markdown"]);
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

type IncomingAttachment = { name: string; mediaType: string; data: string };

function isAllowedType(mediaType: string) {
  return (
    IMAGE_TYPES.has(mediaType) ||
    TEXT_TYPES.has(mediaType) ||
    mediaType === "application/pdf"
  );
}

/** Хавсралтыг Anthropic content block болгоно. */
function attachmentBlock(attachment: {
  name: string;
  mediaType: string;
  data: string;
}): Anthropic.ContentBlockParam {
  if (attachment.mediaType === "application/pdf") {
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: attachment.data,
      },
      title: attachment.name,
    };
  }
  if (IMAGE_TYPES.has(attachment.mediaType)) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mediaType as
          | "image/png"
          | "image/jpeg"
          | "image/gif"
          | "image/webp",
        data: attachment.data,
      },
    };
  }
  // Текст файлыг задалж шууд текстээр өгнө.
  const text = Buffer.from(attachment.data, "base64")
    .toString("utf8")
    .slice(0, MAX_TEXT_ATTACHMENT_CHARS);
  return {
    type: "text",
    text: `Хавсаргасан файл: ${attachment.name}\n---\n${text}\n---`,
  };
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  }

  if (!checkAiRateLimit(userId)) {
    return Response.json(
      { error: "Хэт олон хүсэлт — 1 минут хүлээгээд дахин оролдоно уу" },
      { status: 429 }
    );
  }

  // Content-Length-ээр эрт таслана — body-г уншихаас өмнө.
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json(
      { error: "Хүсэлт хэт том байна — хавсралтуудын нийт хэмжээ 8MB-с хэтэрлээ" },
      { status: 413 }
    );
  }

  let message = "";
  let attachments: IncomingAttachment[] = [];
  try {
    const body = await request.json();
    message = typeof body?.message === "string" ? body.message.trim() : "";
    if (Array.isArray(body?.attachments)) attachments = body.attachments;
  } catch {
    message = "";
  }

  if (!message && attachments.length === 0) {
    return Response.json({ error: "Хоосон мессеж" }, { status: 400 });
  }
  if (message.length > MAX_INPUT_CHARS) {
    return Response.json(
      { error: `Мессеж хэт урт байна (дээд тал нь ${MAX_INPUT_CHARS} тэмдэгт)` },
      { status: 400 }
    );
  }

  // Хавсралтын шалгалт — тоо, төрөл, хэмжээ, base64 бүтэц. Буруу base64
  // хадгалагдвал түүхээс дахин илгээгдэх бүрд API 400 өгч чатыг гацаана.
  if (attachments.length > MAX_ATTACHMENTS) {
    return Response.json(
      { error: `Нэг мессежид дээд тал нь ${MAX_ATTACHMENTS} файл хавсаргана` },
      { status: 400 }
    );
  }
  let totalChars = 0;
  for (const attachment of attachments) {
    if (
      typeof attachment?.name !== "string" ||
      typeof attachment?.mediaType !== "string" ||
      typeof attachment?.data !== "string" ||
      !attachment.data
    ) {
      return Response.json({ error: "Хавсралт буруу байна" }, { status: 400 });
    }
    if (!isAllowedType(attachment.mediaType)) {
      return Response.json(
        {
          error: `"${attachment.name.slice(0, 80)}" — дэмжигдэхгүй төрөл. Зураг (PNG/JPG/GIF/WebP), PDF, текст (TXT/CSV/MD) файл хавсаргана.`,
        },
        { status: 400 }
      );
    }
    if (attachment.data.length > MAX_ATTACHMENT_CHARS) {
      return Response.json(
        { error: `"${attachment.name.slice(0, 80)}" — 5MB-с том байна` },
        { status: 400 }
      );
    }
    if (
      attachment.data.length % 4 !== 0 ||
      !BASE64_RE.test(attachment.data)
    ) {
      return Response.json(
        { error: `"${attachment.name.slice(0, 80)}" — файлын өгөгдөл гэмтсэн байна` },
        { status: 400 }
      );
    }
    totalChars += attachment.data.length;
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return Response.json(
      { error: "Хавсралтуудын нийт хэмжээ 8MB-с хэтэрлээ" },
      { status: 400 }
    );
  }

  const settings = await db.query.aiSettings.findFirst({
    where: eq(aiSettings.userId, userId),
  });

  const storedKey = settings?.apiKey ? decryptSecret(settings.apiKey) : null;
  const apiKey = storedKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "AI туслах тохируулагдаагүй байна — AI туслах → Тохиргоо хэсэгт Anthropic API түлхүүрээ оруулна уу.",
      },
      { status: 503 }
    );
  }

  const model =
    settings && isAiModelId(settings.model) ? settings.model : DEFAULT_AI_MODEL;
  const effort =
    settings && isAiEffort(settings.effort) ? settings.effort : DEFAULT_AI_EFFORT;
  const capabilities = AI_MODELS.find((entry) => entry.id === model)!;

  // Түүхийг шинэ мессежийг хадгалахаас ӨМНӨ, SQL LIMIT-тэй уншина — бүх
  // түүх (хавсралтын base64-тэй нь) санах ойд ачаалагдахаас сэргийлнэ.
  const recentDesc = await db.query.aiMessages.findMany({
    where: eq(aiMessages.userId, userId),
    orderBy: [desc(aiMessages.createdAt), desc(aiMessages.id)],
    limit: HISTORY_LIMIT,
    with: { attachments: { columns: { name: true, mediaType: true, data: true } } },
  });
  const recent = recentDesc.reverse();
  // Messages API эхний мессеж user байхыг шаарддаг — цонхны эхэнд таарсан
  // assistant мөрүүдийг (жишээ нь өмнөх хариулт нь тасарсан) хасна.
  while (recent.length > 0 && recent[0].role !== "user") recent.shift();

  const [userMessageRow] = await db
    .insert(aiMessages)
    .values({ userId, role: "user", content: message })
    .returning({ id: aiMessages.id });
  if (attachments.length > 0) {
    await db.insert(aiAttachments).values(
      attachments.map((attachment) => ({
        messageId: userMessageRow.id,
        userId,
        name: attachment.name.slice(0, 200),
        mediaType: attachment.mediaType,
        data: attachment.data,
      }))
    );
  }

  // Түүхийн хавсралтуудыг ШИНЭ мессежээс хойш нь урагш нь тоолж, багц
  // (budget) хэтэрсэн хуучин хавсралтыг текст тэмдэглэгээгээр орлуулна —
  // сүүлийн файлууд контекстэд заавал үлдэнэ. Түлхүүр нь мессеж доторх
  // ИНДЕКС — ижил нэртэй хоёр файл мөргөлдөхгүй.
  let replayBudget = REPLAY_BUDGET_CHARS - totalChars;
  const replayable = new Set<string>();
  for (let i = recent.length - 1; i >= 0; i--) {
    const entryAttachments = recent[i].attachments ?? [];
    for (let j = 0; j < entryAttachments.length; j++) {
      if (entryAttachments[j].data.length <= replayBudget) {
        replayBudget -= entryAttachments[j].data.length;
        replayable.add(`${recent[i].id}:${j}`);
      }
    }
  }

  const historyMessages: Anthropic.MessageParam[] = recent.map((entry) => {
    const entryAttachments = entry.attachments ?? [];
    if (entry.role !== "user" || entryAttachments.length === 0) {
      return {
        role: entry.role as "user" | "assistant",
        content: entry.content,
      };
    }
    const blocks: Anthropic.ContentBlockParam[] = entryAttachments.map(
      (attachment, j) =>
        replayable.has(`${entry.id}:${j}`)
          ? attachmentBlock(attachment)
          : {
              type: "text" as const,
              text: `[Хавсралт "${attachment.name}" — хэмжээний хязгаараас болж контекстээс хасагдсан]`,
            }
    );
    blocks.push({ type: "text", text: entry.content || "(файл хавсаргав)" });
    return { role: "user", content: blocks };
  });

  const currentBlocks: Anthropic.ContentBlockParam[] = [
    ...attachments.map((attachment) => attachmentBlock(attachment)),
    { type: "text" as const, text: message || "(файл хавсаргав)" },
  ];

  const dynamicContext = await buildDynamicContext(
    userId,
    settings?.customInstructions
  );

  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model,
    max_tokens: 16000,
    ...(capabilities.adaptive ? { thinking: { type: "adaptive" as const } } : {}),
    ...(capabilities.effort ? { output_config: { effort } } : {}),
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
      ...historyMessages,
      { role: "user", content: currentBlocks },
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
        if (final.stop_reason === "refusal") {
          // Дунд нь таслагдсан хариултыг "бүрэн" мэт хадгалахгүй —
          // тэмдэглэгээ залгаж стрим болон түүхэнд хоёуланд нь буулгана.
          const notice = full.trim()
            ? "\n\n⚠️ Хариулт аюулгүй байдлын шалтгаанаар энд таслагдлаа."
            : "Уучлаарай, энэ асуултад хариулах боломжгүй байна. Өөр асуулт асуугаарай.";
          full += notice;
          controller.enqueue(encoder.encode(notice));
        }
        if (full.trim()) {
          await db
            .insert(aiMessages)
            .values({ userId, role: "assistant", content: full });
        }
        controller.close();
      } catch (caught) {
        console.error("AI chat stream error:", caught);
        // Headers аль хэдийн 200 явсан тул алдааг стримд текстээр буулгана.
        // Хадгалагдахгүй — дараагийн refresh дээр алга болно.
        let notice = "⚠️ Алдаа гарлаа — түр хүлээгээд дахин оролдоно уу.";
        if (caught instanceof Anthropic.AuthenticationError) {
          notice =
            "⚠️ API түлхүүр буруу эсвэл хүчингүй байна — AI туслах → Тохиргоо хэсэгт түлхүүрээ шалгана уу.";
        } else if (caught instanceof Anthropic.RateLimitError) {
          notice =
            "⚠️ Хүсэлтийн хязгаарт хүрлээ — хэсэг хүлээгээд дахин оролдоно уу.";
        } else if (caught instanceof Anthropic.BadRequestError) {
          notice =
            "⚠️ Хүсэлт буруу байна — хавсралт хэт том эсвэл дэмжигдэхгүй байж болзошгүй.";
        }
        if (!full.trim()) {
          controller.enqueue(encoder.encode(notice));
          controller.close();
        } else {
          controller.error(caught);
        }
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

/** Харилцан ярианы түүхийг бүхэлд нь цэвэрлэнэ (хавсралт cascade устна). */
export async function DELETE() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  }
  await db.delete(aiMessages).where(eq(aiMessages.userId, userId));
  return Response.json({ ok: true });
}
