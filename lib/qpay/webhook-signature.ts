// Webhook гарын үсэг (SERVER — node crypto). intent.ts client-safe хэвээр.
import { createHmac, timingSafeEqual } from "crypto";

/**
 * hex HMAC-SHA256(rawBody, secret), timing-safe. ТҮҮХИЙ body дээр
 * (JSON.parse → stringify хийвэл таарахгүй).
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = signature.trim().toLowerCase();
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
