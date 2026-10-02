// Хяналтын дансны хамгаалалт — DB давхарга (SIM2-038, ontology-audit M6).
// ЦЭВЭР дүрэм нь `lib/gl/control-accounts.ts`. Дэд дэвтрийн баримтгүйгээр
// АР/АП-ийн хяналтын дансыг хөндөх БҮХ зам ЭНЭ НЭГ шалгалтаар:
//   • гар журнал (lib/actions/gl.ts — create / post / update);
//   • нэхэмжлэхгүй кассын баримт, харилцах данс нь хяналтын данс (lib/actions/cash.ts);
//   • ҮХ-ийн капиталжуулалт `capitalizeFrom` = хяналтын данс (lib/actions/fa.ts).
// Горим `company_settings.control_account_guard`: "warn" (анхааруулга буцаана) |
// "block" (`[CONTROL_ACCOUNT]` шиднэ). Нээлтийн журнал чөлөөтэй.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { arApDocuments, organizationProfile } from "@/lib/db/schema";
import {
  DEFAULT_CONTROL_ACCOUNTS,
  controlAccountHits,
  controlAccountMessage,
  isGuardExemptRef,
  normalizeGuardMode,
} from "@/lib/gl/control-accounts";
import { extractMainAccount } from "@/lib/reports/balances";

/** Анхааруулгын текст (warn) эсвэл null; «block» горимд `[CONTROL_ACCOUNT]` шиднэ. */
export async function checkControlAccountGuard(
  orgId: string,
  accountNumbers: string[],
  externalRef: string | null | undefined
): Promise<string | null> {
  if (isGuardExemptRef(externalRef)) return null;
  const [settings, used] = await Promise.all([
    db.query.organizationProfile.findFirst({
      where: eq(organizationProfile.organizationId, orgId),
      columns: { controlAccountGuard: true },
    }),
    db
      .selectDistinct({ account: arApDocuments.controlAccountNumber })
      .from(arApDocuments)
      .where(eq(arApDocuments.organizationId, orgId)),
  ]);
  const control = new Set<string>([
    ...DEFAULT_CONTROL_ACCOUNTS,
    ...used.map((row) => extractMainAccount(row.account)),
  ]);
  const hits = controlAccountHits(accountNumbers, control);
  if (hits.length === 0) return null;
  const message = controlAccountMessage(hits);
  if (normalizeGuardMode(settings?.controlAccountGuard) === "block")
    throw new Error(
      `[CONTROL_ACCOUNT] ${message}. (Тохиргоо → Компанийн мэдээлэл: хяналтын дансны хориг идэвхтэй)`
    );
  return message;
}
