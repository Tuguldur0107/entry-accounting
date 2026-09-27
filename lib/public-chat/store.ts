// Landing-ийн чат — DB давхарга (docs/dev/public-chat.md). Дүрэм нь rules.ts
// (ЦЭВЭР); энд зөвхөн хадгалах/унших. Зочинд буцаах DTO-д ажилтны нэр, IP,
// токен, Telegram id ХЭЗЭЭ Ч орохгүй.

import { createHash, randomBytes } from "node:crypto";

import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { publicChatMessages, publicChatThreads, publicChatVisitors, users } from "@/lib/db/schema";

import {
  PUBLIC_CHAT_DUPLICATE_WINDOW_MS,
  PUBLIC_CHAT_PAGE,
  PUBLIC_CHAT_TEAM_NAME,
  PublicChatInputError,
  normalizeBody,
  type PreparedRoomMessage,
  type PreparedThreadStart,
  type PublicChatAuthor,
  type PublicChatScope,
} from "./rules";
import { AI_CONTEXT_MESSAGES, PUBLIC_CHAT_AI_NAME, type TranscriptMessage } from "./assistant-rules";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return sha256(`${process.env.AUTH_SECRET ?? ""}|${ip}`);
}

export function newVisitorToken(): string {
  return randomBytes(32).toString("base64url");
}

// ─── DTO ────────────────────────────────────────────────────────────────────

export type PublicChatMessageDto = {
  id: string;
  author: PublicChatAuthor;
  name: string;
  body: string;
  masked: boolean;
  replyToId: string | null;
  createdAt: string;
  /** Энэ зочны өөрийн мессеж (UI баруун талд). */
  mine: boolean;
};

type MessageRow = typeof publicChatMessages.$inferSelect;

export function messageDto(row: MessageRow, visitorId: string | null): PublicChatMessageDto {
  return {
    id: row.id,
    author: row.author as PublicChatAuthor,
    name: row.author === "team" ? PUBLIC_CHAT_TEAM_NAME : row.author === "ai" ? PUBLIC_CHAT_AI_NAME : row.name,
    body: row.body,
    masked: row.masked,
    replyToId: row.replyToId,
    createdAt: row.createdAt.toISOString(),
    mine: !!visitorId && row.visitorId === visitorId,
  };
}

// ─── Зочин ──────────────────────────────────────────────────────────────────

export type PublicChatVisitor = typeof publicChatVisitors.$inferSelect;

export async function createVisitor(ipHash: string | null): Promise<{ token: string; visitor: PublicChatVisitor }> {
  const token = newVisitorToken();
  const [visitor] = await db
    .insert(publicChatVisitors)
    .values({ tokenHash: sha256(token), ipHash })
    .returning();
  return { token, visitor };
}

export async function findVisitor(token: string): Promise<PublicChatVisitor | null> {
  const [visitor] = await db
    .select()
    .from(publicChatVisitors)
    .where(eq(publicChatVisitors.tokenHash, sha256(token)))
    .limit(1);
  return visitor ?? null;
}

/**
 * Хаагдсан зочин шинэ сесс авч хоригийг тойрохоос: ижил IP-гээс сүүлийн 24
 * цагт хаагдсан зочин байвал шинэ токен олгохгүй. (Мобайл NAT-д олон хүн нэг
 * IP-тэй тул хугацааг богино байлгасан.)
 */
export async function ipRecentlyBlocked(ipHash: string | null): Promise<boolean> {
  if (!ipHash) return false;
  const [row] = await db
    .select({ id: publicChatVisitors.id })
    .from(publicChatVisitors)
    .where(
      and(
        eq(publicChatVisitors.ipHash, ipHash),
        gte(publicChatVisitors.blockedAt, new Date(Date.now() - 24 * 3_600_000))
      )
    )
    .limit(1);
  return !!row;
}

async function touchVisitor(visitorId: string, ipHash: string | null): Promise<void> {
  await db
    .update(publicChatVisitors)
    .set({ lastSeenAt: new Date(), ...(ipHash ? { ipHash } : {}) })
    .where(eq(publicChatVisitors.id, visitorId));
}

function assertNotBlocked(visitor: PublicChatVisitor): void {
  if (visitor.blockedAt) throw new PublicChatInputError("Энэ хөтчөөс бичих эрхийг Entry баг хаасан байна");
}

/** Ижил зочин ижил текстийг богино хугацаанд давтахгүй (давхар дарах, спам). */
async function assertNotDuplicate(visitorId: string, scope: PublicChatScope, body: string): Promise<void> {
  const since = new Date(Date.now() - PUBLIC_CHAT_DUPLICATE_WINDOW_MS);
  const [dup] = await db
    .select({ id: publicChatMessages.id })
    .from(publicChatMessages)
    .where(
      and(
        eq(publicChatMessages.visitorId, visitorId),
        eq(publicChatMessages.scope, scope),
        eq(publicChatMessages.body, body),
        gte(publicChatMessages.createdAt, since)
      )
    )
    .limit(1);
  if (dup) throw new PublicChatInputError("Энэ мессежийг саяхан илгээсэн байна");
}

// ─── Нийтийн өрөө ───────────────────────────────────────────────────────────

export type RoomPage = { messages: PublicChatMessageDto[]; hiddenIds: string[] };

/**
 * Нийтийн өрөө. `after` байхгүй бол сүүлийн PUBLIC_CHAT_PAGE; байвал тэр
 * мөчөөс хойшхи (>=, client id-гаар давхардлыг арилгана) + тэр хугацаанд
 * НУУГДСАН мессежийн id (нээлттэй табаас алга болгоно).
 */
export async function listRoom(input: { after: Date | null; visitorId: string | null }): Promise<RoomPage> {
  const visible = and(eq(publicChatMessages.scope, "room"), isNull(publicChatMessages.hiddenAt));
  if (!input.after) {
    const rows = await db
      .select()
      .from(publicChatMessages)
      .where(visible)
      .orderBy(desc(publicChatMessages.createdAt))
      .limit(PUBLIC_CHAT_PAGE);
    return { messages: rows.reverse().map((row) => messageDto(row, input.visitorId)), hiddenIds: [] };
  }
  const rows = await db
    .select()
    .from(publicChatMessages)
    .where(and(visible, gte(publicChatMessages.createdAt, input.after)))
    .orderBy(asc(publicChatMessages.createdAt))
    .limit(PUBLIC_CHAT_PAGE);
  const hidden = await db
    .select({ id: publicChatMessages.id })
    .from(publicChatMessages)
    .where(and(eq(publicChatMessages.scope, "room"), gte(publicChatMessages.hiddenAt, input.after)));
  return { messages: rows.map((row) => messageDto(row, input.visitorId)), hiddenIds: hidden.map((h) => h.id) };
}

export async function postRoomMessage(
  visitor: PublicChatVisitor,
  prepared: PreparedRoomMessage,
  ipHash: string | null
): Promise<MessageRow> {
  assertNotBlocked(visitor);
  await assertNotDuplicate(visitor.id, "room", prepared.body);
  const [row] = await db
    .insert(publicChatMessages)
    .values({
      scope: "room",
      visitorId: visitor.id,
      author: "visitor",
      name: prepared.name,
      body: prepared.body,
      masked: prepared.masked,
    })
    .returning();
  await touchVisitor(visitor.id, ipHash);
  return row;
}

// ─── Хувийн яриа ────────────────────────────────────────────────────────────

export type PublicChatThread = typeof publicChatThreads.$inferSelect;

export async function findThreadOfVisitor(visitorId: string): Promise<PublicChatThread | null> {
  const [thread] = await db
    .select()
    .from(publicChatThreads)
    .where(eq(publicChatThreads.visitorId, visitorId))
    .limit(1);
  return thread ?? null;
}

export async function listThreadMessages(input: {
  threadId: string;
  after: Date | null;
  visitorId: string | null;
}): Promise<PublicChatMessageDto[]> {
  const base = eq(publicChatMessages.threadId, input.threadId);
  const rows = await db
    .select()
    .from(publicChatMessages)
    .where(input.after ? and(base, gte(publicChatMessages.createdAt, input.after)) : base)
    .orderBy(input.after ? asc(publicChatMessages.createdAt) : desc(publicChatMessages.createdAt))
    .limit(input.after ? PUBLIC_CHAT_PAGE : PUBLIC_CHAT_PAGE * 2);
  const ordered = input.after ? rows : rows.reverse();
  return ordered.map((row) => messageDto(row, input.visitorId));
}

/**
 * Зочны хувийн мессеж: thread байхгүй бол үүсгэнэ, байвал үргэлжилнэ (хаагдсан
 * бол дахин нээнэ). Холбоо барих мэдээллийг шинээр өгсөн бол шинэчилнэ.
 */
export async function postPrivateMessage(
  visitor: PublicChatVisitor,
  prepared: PreparedThreadStart,
  ipHash: string | null
): Promise<{ thread: PublicChatThread; message: MessageRow; isNewThread: boolean }> {
  assertNotBlocked(visitor);
  const existing = await findThreadOfVisitor(visitor.id);
  if (existing) await assertNotDuplicate(visitor.id, "private", prepared.body);
  const result = await db.transaction(async (tx) => {
    const now = new Date();
    let thread = existing;
    if (!thread) {
      [thread] = await tx
        .insert(publicChatThreads)
        .values({
          visitorId: visitor.id,
          name: prepared.name,
          email: prepared.email,
          phone: prepared.phone,
          lastMessageAt: now,
        })
        .onConflictDoNothing({ target: publicChatThreads.visitorId })
        .returning();
      // Зэрэгцээ хоёр хүсэлт — нөгөө нь үүсгэчихсэн
      if (!thread)
        [thread] = await tx.select().from(publicChatThreads).where(eq(publicChatThreads.visitorId, visitor.id));
    } else {
      [thread] = await tx
        .update(publicChatThreads)
        .set({
          status: "open",
          lastMessageAt: now,
          ...(prepared.email ? { email: prepared.email } : {}),
          ...(prepared.phone ? { phone: prepared.phone } : {}),
        })
        .where(eq(publicChatThreads.id, thread.id))
        .returning();
    }
    const [message] = await tx
      .insert(publicChatMessages)
      .values({
        scope: "private",
        threadId: thread.id,
        visitorId: visitor.id,
        author: "visitor",
        name: thread.name,
        body: prepared.body,
      })
      .returning();
    return { thread, message, isNewThread: !existing };
  });
  await touchVisitor(visitor.id, ipHash);
  return result;
}

// ─── Entry баг (Telegram / Console) ─────────────────────────────────────────

/** `telegramMessageId` — группынх тоо, хувийн chat-ийнх `telegramRef("private", …)`. */
export async function setTelegramMessageId(messageId: string, telegramMessageId: number | string): Promise<void> {
  await db
    .update(publicChatMessages)
    .set({ telegramMessageId: String(telegramMessageId) })
    .where(eq(publicChatMessages.id, messageId));
}

export async function findMessageByTelegramId(telegramMessageId: number | string): Promise<MessageRow | null> {
  const [row] = await db
    .select()
    .from(publicChatMessages)
    .where(eq(publicChatMessages.telegramMessageId, String(telegramMessageId)))
    .limit(1);
  return row ?? null;
}

export async function findMessage(id: string): Promise<MessageRow | null> {
  const [row] = await db.select().from(publicChatMessages).where(eq(publicChatMessages.id, id)).limit(1);
  return row ?? null;
}

export type TeamPostTarget =
  | { scope: "room"; replyToId?: string | null }
  | { scope: "private"; threadId: string };

/**
 * Багийн мессеж — нийтэд «Entry баг» нэрээр; staff нь зөвхөн Console-д.
 * `telegramMessageId` — Telegram-аас ирсэн бол тэр мессежийн id (unique тул
 * webhook дахин ирэхэд давхар бичигдэхгүй; дээр нь Reply хийхэд мөн энд очно).
 */
export async function postTeamMessage(
  target: TeamPostTarget,
  rawBody: string,
  staff: string,
  telegramMessageId: number | string | null = null
): Promise<MessageRow> {
  const body = normalizeBody(rawBody);
  const tg = telegramMessageId == null ? null : String(telegramMessageId);
  if (target.scope === "private") {
    return db.transaction(async (tx) => {
      const [thread] = await tx
        .update(publicChatThreads)
        .set({ lastMessageAt: new Date() })
        .where(eq(publicChatThreads.id, target.threadId))
        .returning({ id: publicChatThreads.id });
      if (!thread) throw new PublicChatInputError("Яриа олдсонгүй");
      const [row] = await tx
        .insert(publicChatMessages)
        .values({
          scope: "private",
          threadId: thread.id,
          author: "team",
          name: PUBLIC_CHAT_TEAM_NAME,
          staffName: staff.slice(0, 80),
          body,
          telegramMessageId: tg,
        })
        .returning();
      return row;
    });
  }
  const [row] = await db
    .insert(publicChatMessages)
    .values({
      scope: "room",
      author: "team",
      name: PUBLIC_CHAT_TEAM_NAME,
      staffName: staff.slice(0, 80),
      body,
      replyToId: target.replyToId ?? null,
      telegramMessageId: tg,
    })
    .returning();
  return row;
}

/** Relay мессеж дээрх Reply → тэр мессежийн өрөө/яриа руу багийн хариу. */
export async function postTeamReply(
  replyToTelegramId: number | string,
  body: string,
  staff: string,
  telegramMessageId: number | string | null = null
): Promise<MessageRow | null> {
  const original = await findMessageByTelegramId(replyToTelegramId);
  if (!original) return null;
  if (original.scope === "private" && original.threadId)
    return postTeamMessage({ scope: "private", threadId: original.threadId }, body, staff, telegramMessageId);
  // Багийн өөрийн мессеж дээр Reply — анхны зочны мессежийг л иш татна.
  const replyToId = original.author === "team" ? original.replyToId : original.id;
  return postTeamMessage({ scope: "room", replyToId }, body, staff, telegramMessageId);
}

/** Нийтийн өрөөний мессежийг нуух/сэргээх (хувийн яриаг нуухгүй). */
export async function setMessageHidden(messageId: string, hidden: boolean, staff: string): Promise<MessageRow | null> {
  const [row] = await db
    .update(publicChatMessages)
    .set(hidden ? { hiddenAt: new Date(), hiddenBy: staff.slice(0, 80) } : { hiddenAt: null, hiddenBy: null })
    .where(and(eq(publicChatMessages.id, messageId), eq(publicChatMessages.scope, "room")))
    .returning();
  return row ?? null;
}

/** Зочныг хаах: бичих эрхгүй болж, нийтийн өрөөний мессеж нь бүгд нуугдана. */
export async function setVisitorBlocked(visitorId: string, blocked: boolean, staff: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [visitor] = await tx
      .update(publicChatVisitors)
      .set(blocked ? { blockedAt: new Date(), blockedBy: staff.slice(0, 80) } : { blockedAt: null, blockedBy: null })
      .where(eq(publicChatVisitors.id, visitorId))
      .returning({ id: publicChatVisitors.id });
    if (!visitor) return false;
    if (blocked)
      await tx
        .update(publicChatMessages)
        .set({ hiddenAt: new Date(), hiddenBy: staff.slice(0, 80) })
        .where(
          and(
            eq(publicChatMessages.visitorId, visitorId),
            eq(publicChatMessages.scope, "room"),
            isNull(publicChatMessages.hiddenAt)
          )
        );
    return true;
  });
}

export async function setThreadStatus(threadId: string, status: "open" | "closed"): Promise<boolean> {
  const rows = await db
    .update(publicChatThreads)
    .set({ status })
    .where(eq(publicChatThreads.id, threadId))
    .returning({ id: publicChatThreads.id });
  return rows.length > 0;
}

// ─── Console (платформын API) ───────────────────────────────────────────────

export type ConsoleMessage = PublicChatMessageDto & {
  staffName: string | null;
  visitorId: string | null;
  hiddenAt: string | null;
  hiddenBy: string | null;
  relayed: boolean;
};

function toConsole(row: MessageRow): ConsoleMessage {
  return {
    ...messageDto(row, null),
    staffName: row.staffName,
    visitorId: row.visitorId,
    hiddenAt: row.hiddenAt?.toISOString() ?? null,
    hiddenBy: row.hiddenBy,
    relayed: !!row.telegramMessageId,
  };
}

export type ConsoleThread = {
  id: string;
  visitorId: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
  lastMessageAt: string;
  /** Сүүлийн мессеж зочных = хариу хүлээж байна. */
  awaitingReply: boolean;
  lastBody: string | null;
  messageCount: number;
  visitorBlocked: boolean;
  /** Ижил и-мэйлээр Entry-д бүртгүүлсэн хэрэглэгч (тулгалт, бичихгүй). */
  registeredUserId: string | null;
};

export async function listThreadsForConsole(input: {
  status?: "open" | "closed" | null;
  limit: number;
  threadId?: string;
}): Promise<ConsoleThread[]> {
  const threads = await db
    .select({
      thread: publicChatThreads,
      blockedAt: publicChatVisitors.blockedAt,
    })
    .from(publicChatThreads)
    .innerJoin(publicChatVisitors, eq(publicChatVisitors.id, publicChatThreads.visitorId))
    .where(
      and(
        input.status ? eq(publicChatThreads.status, input.status) : undefined,
        input.threadId ? eq(publicChatThreads.id, input.threadId) : undefined
      )
    )
    .orderBy(desc(publicChatThreads.lastMessageAt))
    .limit(input.limit);
  if (!threads.length) return [];
  const ids = threads.map((t) => t.thread.id);

  const last = await db
    .selectDistinctOn([publicChatMessages.threadId], {
      threadId: publicChatMessages.threadId,
      author: publicChatMessages.author,
      body: publicChatMessages.body,
    })
    .from(publicChatMessages)
    .where(inArray(publicChatMessages.threadId, ids))
    .orderBy(publicChatMessages.threadId, desc(publicChatMessages.createdAt));
  const counts = await db
    .select({ threadId: publicChatMessages.threadId, n: sql<number>`count(*)::int` })
    .from(publicChatMessages)
    .where(inArray(publicChatMessages.threadId, ids))
    .groupBy(publicChatMessages.threadId);
  const emails = threads.map((t) => t.thread.email).filter((e): e is string => !!e);
  const registered = emails.length
    ? await db
        .select({ id: users.id, email: sql<string>`lower(${users.email})` })
        .from(users)
        .where(inArray(sql`lower(${users.email})`, emails))
    : [];
  const lastBy = new Map(last.map((l) => [l.threadId, l]));
  const countBy = new Map(counts.map((c) => [c.threadId, c.n]));
  const userBy = new Map(registered.map((u) => [u.email, u.id]));

  return threads.map(({ thread, blockedAt }) => {
    const lastMessage = lastBy.get(thread.id);
    return {
      id: thread.id,
      visitorId: thread.visitorId,
      name: thread.name,
      email: thread.email,
      phone: thread.phone,
      status: thread.status,
      createdAt: thread.createdAt.toISOString(),
      lastMessageAt: thread.lastMessageAt.toISOString(),
      awaitingReply: lastMessage?.author === "visitor",
      lastBody: lastMessage?.body ?? null,
      messageCount: countBy.get(thread.id) ?? 0,
      visitorBlocked: !!blockedAt,
      registeredUserId: (thread.email && userBy.get(thread.email)) || null,
    };
  });
}

export async function getThreadForConsole(threadId: string): Promise<{ thread: ConsoleThread; messages: ConsoleMessage[] } | null> {
  const [summary] = await listThreadsForConsole({ limit: 1, threadId });
  if (!summary) return null;
  const messages = await db
    .select()
    .from(publicChatMessages)
    .where(eq(publicChatMessages.threadId, threadId))
    .orderBy(asc(publicChatMessages.createdAt));
  return { thread: summary, messages: messages.map(toConsole) };
}

/** Нийтийн өрөө Console-д — нуусан мессеж ч харагдана (сэргээх боломжтой). */
export async function listRoomForConsole(input: { before: Date | null; limit: number }): Promise<ConsoleMessage[]> {
  const rows = await db
    .select()
    .from(publicChatMessages)
    .where(
      input.before
        ? and(eq(publicChatMessages.scope, "room"), lt(publicChatMessages.createdAt, input.before))
        : eq(publicChatMessages.scope, "room")
    )
    .orderBy(desc(publicChatMessages.createdAt))
    .limit(input.limit);
  return rows.reverse().map(toConsole);
}

/** Relay амжилтгүй болсон (Telegram унтарсан г.м.) зочны мессеж — Console-д анхааруулга. */
export async function countUnrelayed(since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(publicChatMessages)
    .where(
      and(
        eq(publicChatMessages.author, "visitor"),
        isNull(publicChatMessages.telegramMessageId),
        gt(publicChatMessages.createdAt, since),
        isNull(publicChatMessages.hiddenAt)
      )
    );
  return row?.n ?? 0;
}

// ─── AI туслах (assistant.ts) ──────────────────────────────────────────────

export type AiThreadContext = {
  thread: PublicChatThread;
  /** Сүүлийн AI_CONTEXT_MESSAGES мессеж, хугацаагаар өсөхөөр. */
  messages: TranscriptMessage[];
  latestVisitorMessageId: string | null;
  lastTeamAt: Date | null;
  aiRepliesInThread24h: number;
  aiRepliesGlobal24h: number;
};

export async function loadAiThreadContext(threadId: string, now: Date): Promise<AiThreadContext | null> {
  const [thread] = await db.select().from(publicChatThreads).where(eq(publicChatThreads.id, threadId)).limit(1);
  if (!thread) return null;
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const rows = await db
    .select({ id: publicChatMessages.id, author: publicChatMessages.author, body: publicChatMessages.body })
    .from(publicChatMessages)
    .where(eq(publicChatMessages.threadId, threadId))
    .orderBy(desc(publicChatMessages.createdAt))
    .limit(AI_CONTEXT_MESSAGES);
  const [lastTeam] = await db
    .select({ at: publicChatMessages.createdAt })
    .from(publicChatMessages)
    .where(and(eq(publicChatMessages.threadId, threadId), eq(publicChatMessages.author, "team")))
    .orderBy(desc(publicChatMessages.createdAt))
    .limit(1);
  const [threadAi] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(publicChatMessages)
    .where(
      and(
        eq(publicChatMessages.threadId, threadId),
        eq(publicChatMessages.author, "ai"),
        gte(publicChatMessages.createdAt, since)
      )
    );
  const [globalAi] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(publicChatMessages)
    .where(and(eq(publicChatMessages.author, "ai"), gte(publicChatMessages.createdAt, since)));
  const ordered = rows.reverse();
  return {
    thread,
    messages: ordered.map((row) => ({ author: row.author as TranscriptMessage["author"], body: row.body })),
    latestVisitorMessageId: [...ordered].reverse().find((row) => row.author === "visitor")?.id ?? null,
    lastTeamAt: lastTeam?.at ?? null,
    aiRepliesInThread24h: threadAi?.n ?? 0,
    aiRepliesGlobal24h: globalAi?.n ?? 0,
  };
}

/**
 * AI-ийн хариуг хадгална. `replyToId` = хариулж буй зочны мессеж; нэг зочны
 * мессежид НЭГ л AI хариу (partial unique index), хооронд нь Entry баг хариулсан
 * эсвэл зочин шинэ мессеж бичсэн бол хадгалахгүй (null) — хуучирсан хариу.
 */
export async function postAiMessage(input: {
  threadId: string;
  replyToId: string;
  body: string;
}): Promise<MessageRow | null> {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ id: publicChatMessages.id, author: publicChatMessages.author })
      .from(publicChatMessages)
      .where(and(eq(publicChatMessages.threadId, input.threadId), inArray(publicChatMessages.author, ["visitor", "team"])))
      .orderBy(desc(publicChatMessages.createdAt))
      .limit(1);
    if (!latest || latest.id !== input.replyToId) return null;
    const [row] = await tx
      .insert(publicChatMessages)
      .values({
        scope: "private",
        threadId: input.threadId,
        author: "ai",
        name: PUBLIC_CHAT_AI_NAME,
        body: input.body,
        replyToId: input.replyToId,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return null;
    await tx
      .update(publicChatThreads)
      .set({ lastMessageAt: new Date() })
      .where(eq(publicChatThreads.id, input.threadId));
    return row;
  });
}
