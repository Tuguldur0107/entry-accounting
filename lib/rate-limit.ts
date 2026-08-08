// Ерөнхий зориулалтын in-memory sliding-window rate limiter — credential
// endpoint-уудыг (login, register, OAuth token/DCR) brute-force болон
// DoS-оос хамгаална. lib/ai/rate-limit.ts-тэй ижил хандлага: in-memory тул
// нэг Node процесст л үйлчилнэ; олон instance-д Redis хэрэгтэй болно,
// гэхдээ нэг-серверийн deployment-д хангалттай.

type Bucket = { windowMs: number; timestamps: number[] };

const buckets = new Map<string, Bucket>();

/**
 * `key` дээр `windowMs` хугацаанд `limit`-аас олон оролдлого зөвшөөрөхгүй.
 * true = зөвшөөрөгдсөн (оролдлого тоологдоно), false = хязгаар хэтэрсэн.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const recent = (buckets.get(key)?.timestamps ?? []).filter(
    (timestamp) => now - timestamp < windowMs
  );
  if (recent.length >= limit) {
    buckets.set(key, { windowMs, timestamps: recent });
    return false;
  }
  recent.push(now);
  buckets.set(key, { windowMs, timestamps: recent });

  // Map хязгааргүй өсөхөөс сэргийлж хааяа хуучин bucket-уудыг цэвэрлэнэ.
  if (buckets.size > 1000) {
    for (const [bucketKey, bucket] of buckets) {
      if (
        bucket.timestamps.every(
          (timestamp) => now - timestamp >= bucket.windowMs
        )
      ) {
        buckets.delete(bucketKey);
      }
    }
  }
  return true;
}
