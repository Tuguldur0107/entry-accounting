// Хэрэглэгч бүрийн AI хүсэлтийн энгийн sliding-window хязгаар — нээлттэй
// бүртгэлтэй орчинд серверийн түлхүүрийг үрэх/DoS хийхээс хамгаална.
// In-memory тул нэг Node процесст л үйлчилнэ; олон instance-д Redis хэрэгтэй
// болно, гэхдээ нэг-серверийн deployment-д хангалттай.

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;

const buckets = new Map<string, number[]>();

export function checkAiRateLimit(userId: string): boolean {
  const now = Date.now();
  const recent = (buckets.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < WINDOW_MS
  );
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    buckets.set(userId, recent);
    return false;
  }
  recent.push(now);
  buckets.set(userId, recent);

  // Map хязгааргүй өсөхөөс сэргийлж хааяа хуучин bucket-уудыг цэвэрлэнэ.
  if (buckets.size > 1000) {
    for (const [key, timestamps] of buckets) {
      if (timestamps.every((timestamp) => now - timestamp >= WINDOW_MS)) {
        buckets.delete(key);
      }
    }
  }
  return true;
}
