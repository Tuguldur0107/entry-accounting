// Landing-ийн чатын «AI туслах» — зочны хувийн мессежийн дараа (`after()`)
// entry-landing-ийн `/api/chat-assistant` руу яриаг дамжуулж, хариуг
// «AI туслах» нэрээр хадгалаад багийн Telegram групп руу мөн relay хийнэ.
//
// Энэ сервер AI-ийн API-г ДУУДАХГҮЙ (CLAUDE.md §9a) — Claude-г зөвхөн landing
// дуудна. env: PUBLIC_CHAT_AI_URL (landing-ийн endpoint), PUBLIC_CHAT_AI_SECRET
// (хоёр талд ижил, Bearer). Тохируулаагүй бол AI ажиллахгүй — чат хэвээр.
// ХЭЗЭЭ Ч шидэхгүй: алдаа гарвал зочин Entry багийн хариуг хүлээнэ.

import { aiSkipReason, AI_REQUEST_TIMEOUT_MS, buildAiTurns, parseAiReply } from "./assistant-rules";
import { loadAiThreadContext, postAiMessage, setTelegramMessageId } from "./store";
import { publicChatTelegramConfig, sendTeamText } from "./telegram";
import { escapeHtml } from "./rules";

export type PublicChatAiConfig = { url: string; secret: string };

export function publicChatAiConfig(): PublicChatAiConfig | null {
  const url = process.env.PUBLIC_CHAT_AI_URL?.trim();
  const secret = process.env.PUBLIC_CHAT_AI_SECRET?.trim();
  if (!url || !secret || !/^https?:\/\//.test(url)) return null;
  return { url, secret };
}

/** Зочны UI «AI туслах бичиж байна…» харуулах эсэх (хариулах магадлалтай). */
export async function aiActiveForThread(threadId: string): Promise<boolean> {
  if (!publicChatAiConfig()) return false;
  const context = await loadAiThreadContext(threadId, new Date());
  if (!context) return false;
  return aiSkipReason({ configured: true, ...context, now: new Date() }) === null;
}

export async function requestAiReply(threadId: string, visitorMessageId: string): Promise<void> {
  const config = publicChatAiConfig();
  if (!config) return;
  try {
    const now = new Date();
    const context = await loadAiThreadContext(threadId, now);
    if (!context) return;
    if (context.latestVisitorMessageId !== visitorMessageId) return;
    if (aiSkipReason({ configured: true, ...context, now })) return;

    const turns = buildAiTurns(context.messages);
    if (!turns.length) return;
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.secret}` },
      body: JSON.stringify({ threadId, messages: turns }),
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("[public-chat] ai:", response.status);
      return;
    }
    const reply = parseAiReply(await response.json().catch(() => null));
    if (!reply) return;
    const row = await postAiMessage({ threadId, replyToId: visitorMessageId, body: reply.reply });
    if (!row) return;
    await relayAiReply({ messageId: row.id, threadId, body: row.body, handoff: reply.handoff });
  } catch (error) {
    console.error("[public-chat] ai:", error);
  }
}

async function relayAiReply(input: { messageId: string; threadId: string; body: string; handoff: boolean }) {
  const config = publicChatTelegramConfig();
  if (!config) return;
  try {
    const head = input.handoff
      ? `⚠️ <b>AI туслах хариулж чадсангүй — хүн хариулна уу</b> · <code>${input.threadId.slice(0, 8)}</code>`
      : `🤖 <b>AI туслах хариулсан</b> · <code>${input.threadId.slice(0, 8)}</code>`;
    const sentId = await sendTeamText(
      config,
      `${head}\n\n${escapeHtml(input.body)}\n\n<i>Reply хийвэл зочинд та хариулна — AI энэ ярианд зогсоно</i>`
    );
    await setTelegramMessageId(input.messageId, sentId);
  } catch (error) {
    console.error("[public-chat] ai relay:", error);
  }
}
