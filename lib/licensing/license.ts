// Deployment-ийн лиценз — Entry Console-оос олгосон ГАРЫН ҮСЭГТЭЙ token.
//
// Зорилго: Console-оор provision хийгдээгүй хуулбар (clone) production
// горимд нэвтрэх боломжгүй байх. Шалгалт бүрэн OFFLINE — доорх public
// key-ээр гарын үсгийг батална, Console руу сүлжээгээр хандахгүй тул
// хэрэглэгчид үл мэдэгдэх бөгөөд Console унасан ч нөлөөгүй.
//
// Token формат:  entl_<base64url(payload JSON)>.<base64url(Ed25519 sig)>
// Payload:       { slug, appUrl, plan?, iat, exp }  (exp = unix секунд)
//
// Урсгал: provision үед Console нууц түлхүүрээрээ token үүсгэж deployment-ийн
// ENTRY_LICENSE env-д тавина (scripts/issue-license.mjs). Token нь appUrl-даа
// УЯГДСАН тул өөр домэйнд хуулж ашиглагдахгүй. Нууц түлхүүр repo-д ХЭЗЭЭ Ч
// орохгүй — зөвхөн Console/CI secret-д амьдарна.
//
// Хил хязгаар (ил ухамсартай): эх кодтой хэрэглэгч энэ шалгалтыг өөрчилж
// чадна — энэ бол шударга хэрэглээний хаалга. Жинхэнэ хамгаалалт нь гэрээ,
// update урсгал, сервер талын үйлчилгээнүүд (docs/deployment/README.md).

import { verify as edVerify, createPublicKey } from "node:crypto";

/** Entry Console-ийн лицензийн public key — token-ий гарын үсгийг батална. */
const ENTRY_LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAZCL8o1/RkhL5f+DAO3xDunXXWi4GuWMLzVv397g7Ovw=
-----END PUBLIC KEY-----`;

export type EntryLicensePayload = {
  /** Харилцагчийн slug (entry-<slug> repo-той таарна). */
  slug: string;
  /** Лиценз олгогдсон deployment-ийн origin (https://…). */
  appUrl: string;
  /** Багцын нэр (мэдээллийн чанартай). */
  plan?: string;
  /** Олгосон огноо (unix секунд). */
  iat: number;
  /** Дуусах огноо (unix секунд). */
  exp: number;
};

export type EntryLicenseResult =
  | { ok: true; payload: EntryLicensePayload }
  | { ok: false; reason: "missing" | "malformed" | "bad-signature" | "expired" | "url-mismatch" };

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Token-ийг цэвэр (сүлжээгүй) баталгаажуулна.
 * appUrl — энэ deployment-ийн өөрийн URL; token доторхтой origin түвшинд
 * таарах ёстой (өөр домэйнд хуулагдсан token хүчингүй).
 */
export function verifyEntryLicense(
  token: string | undefined,
  appUrl: string | undefined,
  now: Date = new Date(),
  // Тестэд өөр түлхүүр өгөх боломж — production-д үргэлж embedded key.
  publicKeyPem: string = ENTRY_LICENSE_PUBLIC_KEY
): EntryLicenseResult {
  const trimmed = token?.trim();
  if (!trimmed) return { ok: false, reason: "missing" };
  if (!trimmed.startsWith("entl_")) return { ok: false, reason: "malformed" };

  const parts = trimmed.slice("entl_".length).split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };

  let payload: EntryLicensePayload;
  let payloadRaw: Buffer;
  let signature: Buffer;
  try {
    payloadRaw = Buffer.from(parts[0], "base64url");
    signature = Buffer.from(parts[1], "base64url");
    payload = JSON.parse(payloadRaw.toString("utf8")) as EntryLicensePayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof payload?.slug !== "string" ||
    typeof payload?.appUrl !== "string" ||
    typeof payload?.exp !== "number"
  )
    return { ok: false, reason: "malformed" };

  const valid = edVerify(null, payloadRaw, createPublicKey(publicKeyPem), signature);
  if (!valid) return { ok: false, reason: "bad-signature" };

  if (now.getTime() / 1000 > payload.exp) return { ok: false, reason: "expired" };

  const own = appUrl ? normalizeOrigin(appUrl) : null;
  const licensed = normalizeOrigin(payload.appUrl);
  if (!own || !licensed || own !== licensed)
    return { ok: false, reason: "url-mismatch" };

  return { ok: true, payload };
}

/** Хэрэглэгчид харуулах шалтгааны текст (нууц задлахгүй, ерөнхий). */
export const LICENSE_REASON_TEXT: Record<
  Exclude<EntryLicenseResult, { ok: true }>["reason"],
  string
> = {
  missing: "Энэ хувилбар Entry-д бүртгэлгүй байна",
  malformed: "Лицензийн тохиргоо гэмтсэн байна",
  "bad-signature": "Лиценз хүчингүй байна",
  expired: "Лицензийн хугацаа дууссан байна",
  "url-mismatch": "Лиценз энэ хаягт олгогдоогүй байна",
};

// ── Deployment-ийн статус (env-ээс, memoized) ───────────────────────────────

export type DeploymentLicenseStatus = {
  /** Нэвтрэлт зөвшөөрөгдөх эсэх. */
  ok: boolean;
  /** dev = хөгжүүлэлтийн горим (шалгалтгүй), licensed = хүчинтэй token. */
  mode: "dev" | "licensed" | "unlicensed";
  reason?: string;
  slug?: string;
  expiresAt?: string;
};

let cached: DeploymentLicenseStatus | null = null;

/**
 * Энэ deployment нэвтрэлт хүлээн авах эрхтэй юу. Хөгжүүлэлтийн горимд
 * (next dev) үргэлж нээлттэй — vibecoding/локал ажиллагаа саадгүй.
 * Production-д ENTRY_LICENSE + NEXT_PUBLIC_APP_URL хоёроор шалгана.
 * Env ажиллагааны явцад өөрчлөгдөхгүй тул нэг л удаа бодогдоно.
 */
export function deploymentLicenseStatus(): DeploymentLicenseStatus {
  if (cached) return cached;

  if (process.env.NODE_ENV !== "production") {
    cached = { ok: true, mode: "dev" };
    return cached;
  }

  const result = verifyEntryLicense(
    process.env.ENTRY_LICENSE,
    process.env.NEXT_PUBLIC_APP_URL
  );
  cached = result.ok
    ? {
        ok: true,
        mode: "licensed",
        slug: result.payload.slug,
        expiresAt: new Date(result.payload.exp * 1000).toISOString().slice(0, 10),
      }
    : { ok: false, mode: "unlicensed", reason: LICENSE_REASON_TEXT[result.reason] };
  return cached;
}
