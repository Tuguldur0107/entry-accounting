// Landing-ийн чатын «AI туслах» — ЦЭВЭР дүрэм (DB, сүлжээгүй, тесттэй).
// docs/dev/public-chat.md «AI туслах».
//
// Entry сервер AI-ийн API ДУУДАХГҮЙ (CLAUDE.md §9a) — AI нь entry-landing
// сервист ажиллаж, энэ сервер зөвхөн яриаг HTTP-ээр дамжуулж хариуг хадгална.
// Зорилго нь ЗӨВХӨН борлуулалтын өмнөх мэдээлэл (Entry гэж юу, үнэ, холболт) —
// харилцагчийн нягтлан бодох өгөгдөлд хүрэхгүй. Хувийн ярианд л; нийтийн өрөөнд
// AI хариулахгүй (буруу хариу бүгдэд харагдана).

export const PUBLIC_CHAT_AI_NAME = "AI туслах";
/** Entry баг сүүлийн энэ хугацаанд хариулсан бол AI тэр ярианд ОРОЛЦОХГҮЙ. */
export const AI_TEAM_QUIET_MS = 24 * 3_600_000;
/** Нэг ярианд 24 цагт AI-ийн дээд хариу — зардал, давталтаас. */
export const AI_REPLIES_PER_THREAD_DAILY = 20;
/** Бүх ярианд 24 цагт AI-ийн дээд хариу — зардлын тааз. */
export const AI_REPLIES_GLOBAL_DAILY = 500;
/** AI-д дамжуулах сүүлийн мессежийн тоо (контекст, зардал). */
export const AI_CONTEXT_MESSAGES = 20;
/** AI-ийн хариуны дээд урт (тэмдэгт) — зочны 1000-аас арай урт. */
export const AI_MAX_REPLY = 1500;
/** landing-ийн хариу хүлээх хугацаа. */
export const AI_REQUEST_TIMEOUT_MS = 60_000;

export type AiSkipReason =
  | "disabled"
  | "team_active"
  | "thread_limit"
  | "global_limit"
  | "not_latest";

export type AiDecisionInput = {
  configured: boolean;
  /** Энэ ярианд Entry багийн сүүлийн мессежийн мөч. */
  lastTeamAt: Date | null;
  aiRepliesInThread24h: number;
  aiRepliesGlobal24h: number;
  now: Date;
};

/** AI хариулах эсэх — null = хариулна, эс бөгөөс шалтгаан. */
export function aiSkipReason(input: AiDecisionInput): AiSkipReason | null {
  if (!input.configured) return "disabled";
  if (input.lastTeamAt && input.now.getTime() - input.lastTeamAt.getTime() < AI_TEAM_QUIET_MS) return "team_active";
  if (input.aiRepliesInThread24h >= AI_REPLIES_PER_THREAD_DAILY) return "thread_limit";
  if (input.aiRepliesGlobal24h >= AI_REPLIES_GLOBAL_DAILY) return "global_limit";
  return null;
}

export type TranscriptMessage = { author: "visitor" | "team" | "ai"; body: string };
export type AiTurn = { role: "user" | "assistant"; content: string };

/**
 * Яриаг Claude-ийн user/assistant ээлж болгоно. Зочин = user; AI болон Entry
 * баг = assistant (багийн хариуг «[Entry баг]» гэж тэмдэглэнэ — AI өөрийнх гэж
 * андуурахгүй). Дараалсан ижил role нэгтгэгдэнэ; эхнийх нь заавал user.
 */
export function buildAiTurns(messages: TranscriptMessage[]): AiTurn[] {
  const turns: AiTurn[] = [];
  for (const message of messages.slice(-AI_CONTEXT_MESSAGES)) {
    const role = message.author === "visitor" ? "user" : "assistant";
    const content = message.author === "team" ? `[Entry баг] ${message.body}` : message.body;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n\n${content}`;
    else turns.push({ role, content });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

export type AiReply = { reply: string; handoff: boolean };

/** landing-ийн хариуг шалгана — буруу хэлбэр бол null (хадгалахгүй). */
export function parseAiReply(value: unknown): AiReply | null {
  if (!value || typeof value !== "object") return null;
  const { reply, handoff } = value as Record<string, unknown>;
  if (typeof reply !== "string" || typeof handoff !== "boolean") return null;
  const text = reply
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return { reply: text.length > AI_MAX_REPLY ? `${text.slice(0, AI_MAX_REPLY - 1)}…` : text, handoff };
}
