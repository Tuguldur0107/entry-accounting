// Платформын API — landing-ийн чат (Entry Console). docs/dev/public-chat.md.
//
//   GET  /api/platform/public-chat?view=threads[&status=open|closed]  → { ok, threads, unrelayed24h }
//   GET  /api/platform/public-chat?threadId=<uuid>                    → { ok, thread, messages }
//   GET  /api/platform/public-chat?view=room[&before=ISO]             → { ok, messages }  (нуусан ч)
//   POST /api/platform/public-chat  { action, actor, … }
//        reply      { threadId, body }          — хувийн ярианд хариу
//        room_post  { body, replyToId? }        — нийтийн өрөөнд «Entry баг»
//        hide | unhide { messageId }            — нийтийн өрөөний мессеж
//        block | unblock { visitorId }          — зочны бичих эрх
//        close | reopen { threadId }
//
// Telegram-аас хийсэн үйлдэлтэй ИЖИЛ store функц — тусдаа логик байхгүй.
import { NextResponse } from "next/server";

import { platformActorLabel, platformFailure, platformGate } from "@/lib/api/platform-auth";
import { isUuid } from "@/lib/public-chat/rules";
import {
  countUnrelayed,
  getThreadForConsole,
  listRoomForConsole,
  listThreadsForConsole,
  postTeamMessage,
  setMessageHidden,
  setThreadStatus,
  setVisitorBlocked,
} from "@/lib/public-chat/store";
import { mirrorTeamMessage } from "@/lib/public-chat/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) throw new Error(`${field} буруу байна`);
  return value.toLowerCase();
}

export async function GET(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  const params = new URL(request.url).searchParams;
  try {
    const threadId = params.get("threadId");
    if (threadId) {
      const found = await getThreadForConsole(requireUuid(threadId, "threadId"));
      if (!found) return NextResponse.json({ ok: false, error: "Яриа олдсонгүй" }, { status: 404 });
      return NextResponse.json({ ok: true, ...found });
    }
    if (params.get("view") === "room") {
      const before = params.get("before");
      const date = before ? new Date(before) : null;
      if (date && Number.isNaN(date.getTime())) throw new Error("before буруу огноо");
      return NextResponse.json({ ok: true, messages: await listRoomForConsole({ before: date, limit: 100 }) });
    }
    const status = params.get("status");
    if (status && status !== "open" && status !== "closed") throw new Error("status нь open эсвэл closed");
    const [threads, unrelayed24h] = await Promise.all([
      listThreadsForConsole({ status: (status as "open" | "closed" | null) ?? null, limit: 200 }),
      countUnrelayed(new Date(Date.now() - 24 * 3_600_000)),
    ]);
    return NextResponse.json({ ok: true, threads, unrelayed24h });
  } catch (caught) {
    return platformFailure(caught);
  }
}

export async function POST(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const staff = platformActorLabel(body.actor);
    switch (body.action) {
      case "reply": {
        const threadId = requireUuid(body.threadId, "threadId");
        const row = await postTeamMessage({ scope: "private", threadId }, String(body.body ?? ""), staff);
        await mirrorTeamMessage({ messageId: row.id, scope: "private", threadId, staff, body: row.body });
        return NextResponse.json({ ok: true, messageId: row.id });
      }
      case "room_post": {
        const replyToId = body.replyToId == null ? null : requireUuid(body.replyToId, "replyToId");
        const row = await postTeamMessage({ scope: "room", replyToId }, String(body.body ?? ""), staff);
        await mirrorTeamMessage({ messageId: row.id, scope: "room", threadId: null, staff, body: row.body });
        return NextResponse.json({ ok: true, messageId: row.id });
      }
      case "hide":
      case "unhide": {
        const row = await setMessageHidden(requireUuid(body.messageId, "messageId"), body.action === "hide", staff);
        if (!row) return NextResponse.json({ ok: false, error: "Нийтийн өрөөний мессеж олдсонгүй" }, { status: 404 });
        return NextResponse.json({ ok: true });
      }
      case "block":
      case "unblock": {
        const found = await setVisitorBlocked(requireUuid(body.visitorId, "visitorId"), body.action === "block", staff);
        if (!found) return NextResponse.json({ ok: false, error: "Зочин олдсонгүй" }, { status: 404 });
        return NextResponse.json({ ok: true });
      }
      case "close":
      case "reopen": {
        const found = await setThreadStatus(requireUuid(body.threadId, "threadId"), body.action === "close" ? "closed" : "open");
        if (!found) return NextResponse.json({ ok: false, error: "Яриа олдсонгүй" }, { status: 404 });
        return NextResponse.json({ ok: true });
      }
      default:
        throw new Error("action нь reply | room_post | hide | unhide | block | unblock | close | reopen");
    }
  } catch (caught) {
    return platformFailure(caught);
  }
}
