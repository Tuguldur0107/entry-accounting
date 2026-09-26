// QPay интеграцийн key-ийн АВТОМАТ сэргээлтийн ЦЭВЭР дүрэм (тесттэй).
//
// 2026-09-25: dashboard-ын UI-аас мерчантын «API key солих» дарагдаж Entry-ийн
// хадгалсан key хүчингүй болсноор QR үүсэхгүй болсон (пилот). Dashboard одоо
// интеграц бүрд тусдаа key олгодог (qpay-dashboard lib/client-keys.ts) бөгөөд
// Entry 401 авбал Partner API-аар (`POST …/credentials`) ӨӨРИЙН key-г шинээр
// авч НЭГ удаа давтана. Энд зөвхөн шийдвэр: хэзээ сэргээх, хэр олон удаа.

import { QPAY_ERRORS } from "./constants";

/** Сэргээлт хоорондын доод завсар (байгууллага бүрд) — давталт / халдлагаас. */
export const QPAY_RECOVERY_COOLDOWN_MS = 60_000;

/** Dashboard key-г таньсангүй (401) — сэргээх боломжтой цорын ганц тохиолдол. */
export function isQpayKeyRejected(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; status?: unknown };
  return e.code === QPAY_ERRORS.dashboard && e.status === 401;
}

/**
 * Энэ байгууллагад одоо сэргээлт оролдох уу — сүүлийн оролдлогоос хойш
 * cooldown өнгөрсөн бол тэмдэглээд true. (Instance бүрийн санах ой — олон
 * instance-д ч дээд тал нь instance тутам минутад нэг.)
 */
export function takeRecoverySlot(
  attempts: Map<string, number>,
  orgId: string,
  now: number,
  cooldownMs = QPAY_RECOVERY_COOLDOWN_MS
): boolean {
  const last = attempts.get(orgId);
  if (last !== undefined && now - last < cooldownMs) return false;
  attempts.set(orgId, now);
  return true;
}

/** Интеграторын хост (dashboard-ын client_id) — нийтийн URL-аас. */
export function clientHostOf(publicUrl: string | null): string | null {
  if (!publicUrl) return null;
  try {
    return new URL(publicUrl).host.toLowerCase() || null;
  } catch {
    return null;
  }
}
