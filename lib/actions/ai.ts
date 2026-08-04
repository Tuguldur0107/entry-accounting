"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiMessages, aiSettings } from "@/lib/db/schema";
import {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_WRITE_MODE,
  isAiEffort,
  isAiModelId,
  isAiWriteMode,
  type AiModelId,
  type AiWriteMode,
} from "@/lib/ai/models";
import { encryptSecret } from "@/lib/ai/crypto";
import type { AiChatMessage } from "@/components/ai/ai-chat-view";

export interface AiChatBootstrap {
  initialMessages: AiChatMessage[];
  /** Идэвхтэй моделийн provider-т түлхүүр тохируулагдсан эсэх. */
  configured: boolean;
  /** Provider бүрд түлхүүр байгаа эсэх — модель сонгогчийн анхааруулгад. */
  anthropicConfigured: boolean;
  openaiConfigured: boolean;
  /** Сүүлд сонгосон модель + бичилтийн горим. */
  model: AiModelId;
  writeMode: AiWriteMode;
}

// Алдааг throw хийхгүй — production build дээр Next.js server action-ий
// error message-ийг нууж "An error occurred..." болгодог тул код буцаана.
export type AiChatBootstrapResult =
  | { ok: true; data: AiChatBootstrap }
  | { ok: false; code: "unauthenticated" | "not-found" };

/**
 * Чатын эхлэлийн өгөгдөл — харилцан ярианы түүх + тохиргооны төлөв.
 * /ai хуудас болон глобал чат панель хоёул ЭНЭ ГАНЦ ачаалагчийг хэрэглэнэ
 * (query давхардуулахгүй).
 */
export async function getAiChatBootstrap(): Promise<AiChatBootstrapResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "unauthenticated" };

  const [history, settings] = await Promise.all([
    // Түүх хязгааргүй ургадаг — панель нээх бүрд бүгдийг татахгүйн тулд
    // сүүлийн 100 мессежийг л ачаална (desc + limit, дараа нь эргүүлнэ).
    db.query.aiMessages.findMany({
      where: eq(aiMessages.userId, userId),
      orderBy: [desc(aiMessages.createdAt)],
      limit: 100,
      with: { attachments: { columns: { name: true } } },
    }),
    db.query.aiSettings.findFirst({
      where: eq(aiSettings.userId, userId),
      columns: { apiKey: true, openaiApiKey: true, model: true, writeMode: true },
    }),
  ]);

  const anthropicConfigured = Boolean(
    settings?.apiKey || process.env.ANTHROPIC_API_KEY
  );
  const openaiConfigured = Boolean(
    settings?.openaiApiKey || process.env.OPENAI_API_KEY
  );

  return {
    ok: true,
    data: {
      // desc-ээр татсан тул хуучин → шинэ дараалалд эргүүлнэ.
      initialMessages: history.reverse().map((entry) => ({
        id: entry.id,
        role: entry.role as "user" | "assistant",
        content: entry.content,
        attachments: entry.attachments.map((attachment) => ({
          name: attachment.name,
        })),
      })),
      configured: anthropicConfigured || openaiConfigured,
      anthropicConfigured,
      openaiConfigured,
      model:
        settings && isAiModelId(settings.model)
          ? settings.model
          : DEFAULT_AI_MODEL,
      writeMode:
        settings && isAiWriteMode(settings.writeMode)
          ? settings.writeMode
          : DEFAULT_AI_WRITE_MODE,
    },
  };
}

/**
 * Чатны толгойн сонголт (модель + бичилтийн горим) — сонголт бүрд
 * хадгалагдаж дараагийн нээлтэд сэргэнэ.
 */
export async function saveAiChatPrefs(input: {
  model: string;
  writeMode: string;
}) {
  const userId = await requireUserId();
  if (typeof input?.model !== "string" || !isAiModelId(input.model))
    throw new Error("Модель буруу байна");
  if (typeof input?.writeMode !== "string" || !isAiWriteMode(input.writeMode))
    throw new Error("Горим буруу байна");

  await db
    .insert(aiSettings)
    .values({
      userId,
      model: input.model,
      writeMode: input.writeMode,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: aiSettings.userId,
      set: {
        model: input.model,
        writeMode: input.writeMode,
        updatedAt: new Date(),
      },
    });
}

async function requireUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Нэвтрээгүй байна");
  return userId;
}

/** Модель / хариултын гүн / нэмэлт заавар хадгална (түлхүүрт үл хамаарна). */
export async function saveAiSettings(input: {
  model: string;
  effort: string;
  customInstructions: string;
}) {
  const userId = await requireUserId();

  // Server action-ыг гараар дуудаж дурын payload өгч болдог тул төрлийг
  // нь эхэлж шалгана.
  if (typeof input?.model !== "string" || !isAiModelId(input.model))
    throw new Error("Модель буруу байна");
  if (typeof input?.effort !== "string" || !isAiEffort(input.effort))
    throw new Error("Хариултын гүн буруу байна");
  const customInstructions =
    typeof input?.customInstructions === "string"
      ? input.customInstructions.trim().slice(0, 2000)
      : "";

  await db
    .insert(aiSettings)
    .values({
      userId,
      model: input.model,
      effort: input.effort,
      customInstructions: customInstructions || null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: aiSettings.userId,
      set: {
        model: input.model,
        effort: input.effort,
        customInstructions: customInstructions || null,
        updatedAt: new Date(),
      },
    });

  revalidatePath("/ai");
  revalidatePath("/ai/settings");
}

/** Хэрэглэгчийн өөрийн Anthropic API түлхүүрийг хадгална. */
export async function setAiApiKey(apiKey: string) {
  const userId = await requireUserId();

  const trimmed = typeof apiKey === "string" ? apiKey.trim() : "";
  // Anthropic түлхүүр sk-ant- угтвартай — бичихдээ андуурахаас сэргийлнэ.
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    throw new Error(
      "Түлхүүр буруу форматтай байна — sk-ant- угтвартай түлхүүрээ бүтнээр нь хуулна уу"
    );
  }

  // DB-д шифрлэж хадгална — backup/console-оос ил харагдахгүй.
  const encrypted = encryptSecret(trimmed);
  await db
    .insert(aiSettings)
    .values({ userId, apiKey: encrypted, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: aiSettings.userId,
      set: { apiKey: encrypted, updatedAt: new Date() },
    });

  revalidatePath("/ai");
  revalidatePath("/ai/settings");
}

/** Хадгалсан түлхүүрийг устгана — серверийн орчны түлхүүр рүү буцна. */
export async function removeAiApiKey() {
  const userId = await requireUserId();

  await db
    .update(aiSettings)
    .set({ apiKey: null, updatedAt: new Date() })
    .where(eq(aiSettings.userId, userId));

  revalidatePath("/ai");
  revalidatePath("/ai/settings");
}

/** Хэрэглэгчийн өөрийн OpenAI API түлхүүрийг хадгална (шифрлэгдэнэ). */
export async function setAiOpenAiApiKey(apiKey: string) {
  const userId = await requireUserId();

  const trimmed = typeof apiKey === "string" ? apiKey.trim() : "";
  // OpenAI түлхүүр sk- угтвартай (sk-proj-... г.м).
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    throw new Error(
      "Түлхүүр буруу форматтай байна — sk- угтвартай OpenAI түлхүүрээ бүтнээр нь хуулна уу"
    );
  }

  const encrypted = encryptSecret(trimmed);
  await db
    .insert(aiSettings)
    .values({ userId, openaiApiKey: encrypted, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: aiSettings.userId,
      set: { openaiApiKey: encrypted, updatedAt: new Date() },
    });

  revalidatePath("/ai");
  revalidatePath("/ai/settings");
}

/** Хадгалсан OpenAI түлхүүрийг устгана. */
export async function removeAiOpenAiApiKey() {
  const userId = await requireUserId();

  await db
    .update(aiSettings)
    .set({ openaiApiKey: null, updatedAt: new Date() })
    .where(eq(aiSettings.userId, userId));

  revalidatePath("/ai");
  revalidatePath("/ai/settings");
}
