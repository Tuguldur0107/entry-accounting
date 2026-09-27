// Landing-ийн чат — зочин ↔ Entry баг ХУВИЙН яриа (docs/dev/public-chat.md).
//
//   GET  /api/public-chat/private[?after=ISO]                → { ok, thread, messages }
//   POST /api/public-chat/private { body, name?, email?, phone? } → { ok, message }
//   (хоёулаа x-visitor-token — зочин бүрд НЭГ яриа)
//
// Зөвхөн тухайн зочин ба Entry баг хардаг. Хариуг баг Telegram-аас (Reply)
// эсвэл Console-оос бичнэ; зочин 5 сек тутам polling-оор авна.
import { after } from "next/server";

import {
  chatFailure,
  chatGate,
  chatJson,
  chatPreflight,
  ipHashOf,
  parseAfter,
  rateLimited,
  readJson,
  tooMany,
  visitorOf,
} from "@/lib/public-chat/http";
import { PUBLIC_CHAT_LIMITS, prepareThreadStart } from "@/lib/public-chat/rules";
import { findThreadOfVisitor, listThreadMessages, messageDto, postPrivateMessage } from "@/lib/public-chat/store";
import { relayVisitorMessage } from "@/lib/public-chat/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return chatPreflight(request);
}

export async function GET(request: Request) {
  const blocked = chatGate(request);
  if (blocked) return blocked;
  if (rateLimited(request, "read", PUBLIC_CHAT_LIMITS.read)) return tooMany(request);
  try {
    const visitor = await visitorOf(request);
    if (!visitor) return chatJson(request, { ok: true, thread: null, messages: [] });
    const thread = await findThreadOfVisitor(visitor.id);
    if (!thread) return chatJson(request, { ok: true, thread: null, messages: [] });
    const messages = await listThreadMessages({
      threadId: thread.id,
      after: parseAfter(new URL(request.url).searchParams.get("after")),
      visitorId: visitor.id,
    });
    return chatJson(request, {
      ok: true,
      thread: { status: thread.status, name: thread.name, hasContact: !!(thread.email || thread.phone) },
      messages,
    });
  } catch (caught) {
    return chatFailure(request, caught);
  }
}

export async function POST(request: Request) {
  const blocked = chatGate(request);
  if (blocked) return blocked;
  try {
    const visitor = await visitorOf(request);
    if (!visitor) return chatJson(request, { ok: false, error: "Сесс дууссан — хуудсаа дахин ачаална уу", code: "NO_SESSION" }, 401);
    if (rateLimited(request, "private", PUBLIC_CHAT_LIMITS.threadPost)) return tooMany(request);
    const prepared = prepareThreadStart(await readJson(request));
    const existing = await findThreadOfVisitor(visitor.id);
    if (!existing && rateLimited(request, "thread-create", PUBLIC_CHAT_LIMITS.threadCreate)) return tooMany(request);
    const { thread, message, isNewThread } = await postPrivateMessage(visitor, prepared, ipHashOf(request));
    after(() =>
      relayVisitorMessage({
        messageId: message.id,
        scope: "private",
        name: thread.name,
        body: message.body,
        email: thread.email,
        phone: thread.phone,
        threadId: thread.id,
        isNewThread,
      })
    );
    return chatJson(request, {
      ok: true,
      message: messageDto(message, visitor.id),
    });
  } catch (caught) {
    return chatFailure(request, caught);
  }
}
