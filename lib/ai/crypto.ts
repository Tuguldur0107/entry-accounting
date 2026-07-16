import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";

// Хэрэглэгчийн Anthropic API түлхүүрийг DB-д хадгалахын өмнө AES-256-GCM-ээр
// шифрлэнэ — DB backup / console хандалтаар түлхүүр ил гарахаас хамгаална.
// Түлхүүр нь AUTH_SECRET-ээс гаргасан тул AUTH_SECRET солигдвол хуучин
// шифрлэгдсэн утгууд уншигдахгүй болно (хэрэглэгч дахин оруулна).

const PREFIX = "enc:v1:";

let cachedKey: Buffer | null = null;
function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET тохируулагдаагүй байна");
  cachedKey = scryptSync(secret, "entry-accounting:ai-api-key:v1", 32);
  return cachedKey;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Шифрлэгдсэн утгыг тайлна. PREFIX-гүй (хуучин plaintext) утгыг байгаагаар
 * нь буцаана; тайлж чадахгүй бол null (AUTH_SECRET солигдсон гэх мэт).
 */
export function decryptSecret(stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return stored;
  try {
    const buffer = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const encrypted = buffer.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
