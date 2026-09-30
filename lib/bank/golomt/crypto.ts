// Голомт OBI-ийн нууцлал (SPEC §3) — ЦЭВЭР (DB-гүй), зөвхөн сервер (node:crypto).
//
//   Нууц үг:   AES-CBC(PKCS7, session key, IV key) → Base64 (нэвтрэх хүсэлтэд)
//   Checksum:  AES-CBC(sha256_hex(ИЛГЭЭХ JSON-ИЙН ЯГ ТЭР ТЕКСТ)) → Base64
//   Хариу:     Base64 → AES-CBC decrypt → JSON (/v1/utility хариу шифргүй)
//
// Түлхүүрүүд UTF-8 текстээрээ байт болно (банкны Java/Go жишээтэй ижил):
// session key 16/24/32 тэмдэгт → AES-128/192/256, IV key заавал 16.

import { createCipheriv, createDecipheriv, createHash } from "node:crypto";

export type GolomtKeys = { sessionKey: string; ivKey: string };

function cipherFor(keys: GolomtKeys) {
  const key = Buffer.from(keys.sessionKey, "utf8");
  const iv = Buffer.from(keys.ivKey, "utf8");
  const algorithm =
    key.length === 16
      ? "aes-128-cbc"
      : key.length === 24
        ? "aes-192-cbc"
        : key.length === 32
          ? "aes-256-cbc"
          : null;
  if (!algorithm)
    throw new Error("Голомтын session key 16, 24 эсвэл 32 тэмдэгт байх ёстой");
  if (iv.length !== 16)
    throw new Error("Голомтын IV key 16 тэмдэгт байх ёстой");
  return { algorithm, key, iv };
}

export function golomtEncrypt(plain: string, keys: GolomtKeys): string {
  const { algorithm, key, iv } = cipherFor(keys);
  const cipher = createCipheriv(algorithm, key, iv);
  return Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]).toString(
    "base64"
  );
}

export function golomtDecrypt(encoded: string, keys: GolomtKeys): string {
  const { algorithm, key, iv } = cipherFor(keys);
  // Банк Base64-ийг мөр таслалттай (MIME) эсвэл URL-safe хэлбэрээр өгч болно.
  const normalized = encoded
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const decipher = createDecipheriv(algorithm, key, iv);
  return Buffer.concat([
    decipher.update(Buffer.from(normalized, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * X-Golomt-Checksum. `body` нь fetch-ээр ИЛГЭЭХ ЯГ ТЭР текст байх ёстой —
 * объектыг дахин stringify хийвэл (зай, түлхүүрийн дараалал) hash зөрнө.
 */
export function golomtChecksum(body: string, keys: GolomtKeys): string {
  const hex = createHash("sha256").update(body, "utf8").digest("hex");
  return golomtEncrypt(hex, keys);
}
