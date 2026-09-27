// Landing-ийн чат — ТҮГЭЭМЭЛ АСУУЛТ (docs/dev/public-chat.md).
//
//   GET /api/public-chat/faq → { ok, faq: [{ key, title, body }] }
//
// Widget чат нээгдэхэд товч болгон харуулна — зочин `/faq` гэж бичих
// шаардлагагүй. Агуулга Telegram-ийн `/faq`-тэй НЭГ эх (lib/public-chat/faq.ts),
// үнэ plans.ts-ээс. Сесс, Turnstile шаардахгүй (статик мэдээлэл).
import { chatGate, chatJson, chatPreflight, rateLimited, tooMany } from "@/lib/public-chat/http";
import { PUBLIC_CHAT_FAQ } from "@/lib/public-chat/faq";
import { PUBLIC_CHAT_LIMITS } from "@/lib/public-chat/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return chatPreflight(request);
}

export function GET(request: Request) {
  const blocked = chatGate(request);
  if (blocked) return blocked;
  if (rateLimited(request, "read", PUBLIC_CHAT_LIMITS.read)) return tooMany(request);
  return chatJson(request, { ok: true, faq: PUBLIC_CHAT_FAQ });
}
