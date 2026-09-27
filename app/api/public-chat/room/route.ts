// Landing-ийн чат — НИЙТИЙН өрөө (docs/dev/public-chat.md).
//
//   GET  /api/public-chat/room[?after=ISO]      → { ok, messages, hiddenIds }
//   POST /api/public-chat/room  { name, body }  → { ok, message }   (x-visitor-token)
//
// Бүгд хардаг тул холбоос ХОРИОТОЙ, хувийн мэдээлэл (утас, и-мэйл, РД, данс)
// автоматаар нуугдана (rules.ts). Мессеж шууд гарна; Entry баг Telegram-аас
// нууж / зочныг хааж болно. AI автоматаар хариулахгүй.
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
import { PUBLIC_CHAT_LIMITS, prepareRoomMessage } from "@/lib/public-chat/rules";
import { listRoom, messageDto, postRoomMessage } from "@/lib/public-chat/store";
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
    const page = await listRoom({
      after: parseAfter(new URL(request.url).searchParams.get("after")),
      visitorId: visitor?.id ?? null,
    });
    return chatJson(request, { ok: true, ...page });
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
    if (
      rateLimited(request, "room", PUBLIC_CHAT_LIMITS.roomPost) ||
      rateLimited(request, "room-hourly", PUBLIC_CHAT_LIMITS.roomPostHourly)
    )
      return tooMany(request);
    const prepared = prepareRoomMessage(await readJson(request));
    const row = await postRoomMessage(visitor, prepared, ipHashOf(request));
    after(() =>
      relayVisitorMessage({ messageId: row.id, scope: "room", name: row.name, body: row.body, masked: row.masked })
    );
    return chatJson(request, {
      ok: true,
      message: messageDto(row, visitor.id),
    });
  } catch (caught) {
    return chatFailure(request, caught);
  }
}
