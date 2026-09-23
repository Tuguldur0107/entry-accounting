// Хэрэглэгч бүрийн AI хүсэлтийн энгийн sliding-window хязгаар — нээлттэй
// бүртгэлтэй орчинд серверийн түлхүүрийг үрэх/DoS хийхээс хамгаална.
// In-memory тул нэг Node процесст л үйлчилнэ; олон instance-д Redis хэрэгтэй
// болно, гэхдээ нэг-серверийн deployment-д хангалттай.
//
// ENT-009: чат, MCP, REST НЭГ 10/мин bucket хуваалцдаг байсан тул сарын
// бүртгэлийг (50–80 дуудлага) AI-аар оруулахад 5–8 мин зөвхөн хүлээлт болдог
// байв. Одоо ТӨРЛӨӨР тусдаа: чат (LLM дуудлага, үнэтэй) 10, tool-ийн УНШИЛТ
// 60, БИЧИЛТ 20 / мин.

const WINDOW_MS = 60_000;

export type AiRateKind = "chat" | "read" | "write";

export const AI_RATE_LIMITS: Record<AiRateKind, number> = {
  chat: 10,
  read: 60,
  write: 20,
};

const READ_PREFIXES = ["list_", "get_", "lookup_", "read_", "reconcile_"];

/** MCP/REST tool-ийн төрөл — нэрээр (унших tool нь өгөгдөл өөрчилдөггүй). */
export function aiToolRateKind(toolName: string): Exclude<AiRateKind, "chat"> {
  return READ_PREFIXES.some((prefix) => toolName.startsWith(prefix)) ? "read" : "write";
}

const buckets = new Map<string, number[]>();

export function checkAiRateLimit(
  userId: string,
  kind: AiRateKind = "chat",
  now: number = Date.now()
): boolean {
  const key = `${kind}:${userId}`;
  const recent = (buckets.get(key) ?? []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (recent.length >= AI_RATE_LIMITS[kind]) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);

  // Map хязгааргүй өсөхөөс сэргийлж хааяа хуучин bucket-уудыг цэвэрлэнэ.
  if (buckets.size > 1000) {
    for (const [bucketKey, timestamps] of buckets) {
      if (timestamps.every((timestamp) => now - timestamp >= WINDOW_MS)) {
        buckets.delete(bucketKey);
      }
    }
  }
  return true;
}

/** Хязгаарын мессеж — ямар төрлийн хэдэн хүсэлт болохыг хэлнэ. */
export function aiRateLimitMessage(kind: AiRateKind): string {
  const label = kind === "chat" ? "чатын" : kind === "read" ? "унших tool-ийн" : "бичих tool-ийн";
  return `Хэт олон хүсэлт — ${label} хязгаар минутад ${AI_RATE_LIMITS[kind]}; 1 минут хүлээгээд дахин оролдоно уу (олон баримтыг *_batch tool-оор нэг дор)`;
}
