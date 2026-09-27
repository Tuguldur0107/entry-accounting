// Landing-ийн чат — зочны сесс (docs/dev/public-chat.md).
//
//   POST /api/public-chat/session  { turnstileToken }  → { ok, visitorToken }
//
// Бүртгэлгүй зочин анх бичихдээ НЭГ удаа Turnstile давж токен авна; дараа нь
// `x-visitor-token` header-ээр өрөө болон хувийн яриандаа бичнэ. Токен хөтчийн
// localStorage-д, DB-д зөвхөн sha256. Хүчинтэй токентой бол шинээр олгохгүй.
import {
  chatFailure,
  chatGate,
  chatJson,
  chatPreflight,
  clientIp,
  ipHashOf,
  rateLimited,
  readJson,
  tooMany,
  verifyTurnstile,
  visitorOf,
} from "@/lib/public-chat/http";
import { PUBLIC_CHAT_LIMITS } from "@/lib/public-chat/rules";
import { createVisitor, ipRecentlyBlocked } from "@/lib/public-chat/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return chatPreflight(request);
}

export async function POST(request: Request) {
  const blocked = chatGate(request);
  if (blocked) return blocked;
  try {
    const existing = await visitorOf(request);
    if (existing && !existing.blockedAt) return chatJson(request, { ok: true, visitorToken: null, reused: true });
    if (rateLimited(request, "session", PUBLIC_CHAT_LIMITS.session)) return tooMany(request);
    const body = await readJson(request);
    if (!(await verifyTurnstile(body.turnstileToken, clientIp(request))))
      return chatJson(request, { ok: false, error: "Хүн мөн эсэхийг баталгаажуулж чадсангүй — дахин оролдоно уу" }, 403);
    const ipHash = ipHashOf(request);
    if (existing?.blockedAt || (await ipRecentlyBlocked(ipHash)))
      return chatJson(request, { ok: false, error: "Энэ хөтчөөс бичих эрхийг Entry баг хаасан байна" }, 403);
    const { token } = await createVisitor(ipHash);
    return chatJson(request, { ok: true, visitorToken: token, reused: false });
  } catch (caught) {
    return chatFailure(request, caught);
  }
}
