// eBarimt НЭХЭМЖЛЭХИЙН банкны данс — АР нэхэмжлэх ба POS «Зээлээр» НЭГ эх
// (docs/pos/05, docs/dev/pos.md). DB импортгүй (сүлжээ нь client.ts-ээр).
//
// Албан спек 3.0.1 §6: нэхэмжлэхэд `bankAccountNo` ЗААВАЛ. Данс нь мерчантын
// ТЕГ-д БҮРТГЭЛТЭЙ данс байх ёстой тул:
//  1. Тохиргоонд данс сонгосон бол ТҮҮНИЙГ (олон данстай байгууллагын сонголт).
//  2. Хоосон бол PosAPI `/rest/bankAccounts?tin=`-ээс (ТЕГ-ийн бүртгэл) — ГАНЦ данс
//     бол автоматаар; олон бол Компанийн мэдээллийн данснуудаас (үндсэн → ганц
//     давхцал) — давхар бөглүүлэхгүй; тэгсэн ч тодорхойгүй бол сонголт шаардана;
//     алга бол ил алдаа. Данс ЗОХИОХГҮЙ (ТЕГ-д бүртгэлгүй дансыг хэзээ ч сонгохгүй).
// Хариуг байгууллага бүрд 10 минут кэшлэнэ (илгээлт бүрд PosAPI-г асуухгүй).

import { posApiBankAccounts } from "./client";
import { MERCHANT_TIN_RE } from "./constants";
import { normalizeBankAccountNo, normalizeIban } from "./receipt";
import type { PosApiBankAccount } from "./types";

export interface InvoiceBankSettings {
  organizationId: string;
  ebarimtMode: string;
  ebarimtMerchantTin: string;
  ebarimtPosApiUrl: string;
  ebarimtArapBankAccountNo: string;
  ebarimtArapIban: string;
}

export type InvoiceBank =
  | { ok: true; bankAccountNo: string; iBan: string | null; source: "settings" | "teg" | "company" }
  | { ok: false; reason: string };

/** Компанийн мэдээллийн данс (company_settings.bankAccounts) — олон ТЕГ данснаас сонгоход. */
export interface CompanyAccountHint {
  accountNo: string;
  isDefault?: boolean;
}

/**
 * ЦЭВЭР шийдвэр (tests/ebarimt-invoice-bank.test.ts). `accounts` = PosAPI-ийн
 * жагсаалт (null = асууж чадаагүй — горим/ТТД/холболт).
 */
export function pickInvoiceBank(
  settings: Pick<InvoiceBankSettings, "ebarimtArapBankAccountNo" | "ebarimtArapIban">,
  accounts: PosApiBankAccount[] | null,
  fetchError: string | null = null,
  companyAccounts: readonly CompanyAccountHint[] = []
): InvoiceBank {
  const configured = normalizeBankAccountNo(settings.ebarimtArapBankAccountNo);
  if (configured)
    return { ok: true, bankAccountNo: configured, iBan: normalizeIban(settings.ebarimtArapIban), source: "settings" };
  if (accounts === null)
    return {
      ok: false,
      reason: `Нэхэмжлэхийн банкны данс тохируулаагүй, ТЕГ-ийн бүртгэлээс ч авч чадсангүй${fetchError ? ` (${fetchError})` : ""} — POS тохиргоо → eBarimt → Нэхэмжлэх`,
    };
  const usable = accounts.filter((account) => normalizeBankAccountNo(account.bankAccountNo));
  if (usable.length === 1)
    return {
      ok: true,
      bankAccountNo: normalizeBankAccountNo(usable[0].bankAccountNo)!,
      iBan: normalizeIban(usable[0].iBan),
      source: "teg",
    };
  if (usable.length === 0)
    return {
      ok: false,
      reason: "ТЕГ-д бүртгэлтэй банкны данс алга — Цахим татварын системд дансаа бүртгээд PosAPI-аас «ТЕГ рүү түлхэх»-ийг дарна",
    };
  // Олон ТЕГ данс — Компанийн мэдээлэлд бүртгэсэн данснаас (үндсэн нь түрүүлж, эс бөгөөс ГАНЦ давхцал).
  const known = companyAccounts
    .map((entry) => ({ no: normalizeBankAccountNo(entry.accountNo), isDefault: !!entry.isDefault }))
    .filter((entry): entry is { no: string; isDefault: boolean } => !!entry.no);
  const matches = usable.filter((account) => known.some((entry) => entry.no === normalizeBankAccountNo(account.bankAccountNo)));
  const preferred =
    matches.find((account) => known.some((entry) => entry.isDefault && entry.no === normalizeBankAccountNo(account.bankAccountNo))) ??
    (matches.length === 1 ? matches[0] : null);
  if (preferred)
    return {
      ok: true,
      bankAccountNo: normalizeBankAccountNo(preferred.bankAccountNo)!,
      iBan: normalizeIban(preferred.iBan),
      source: "company",
    };
  return {
    ok: false,
    reason: `ТЕГ-д ${usable.length} данс бүртгэлтэй — нэхэмжлэхэд аль дансыг хэрэглэхийг POS тохиргоо → eBarimt → Нэхэмжлэх хэсэгт сонгоно (эсвэл Компанийн мэдээлэлд үндсэн дансаа тэмдэглэнэ)`,
  };
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; accounts: PosApiBankAccount[] | null; error: string | null }>();

/** Сервер горимд ТЕГ-ийн бүртгэлтэй дансууд (кэштэй); асууж чадахгүй бол null + шалтгаан. */
async function registeredAccounts(settings: InvoiceBankSettings): Promise<{ accounts: PosApiBankAccount[] | null; error: string | null }> {
  if (settings.ebarimtMode !== "server") return { accounts: null, error: "браузер горимд сервер PosAPI-д хүрэхгүй" };
  const tin = settings.ebarimtMerchantTin.trim();
  if (!MERCHANT_TIN_RE.test(tin) || !settings.ebarimtPosApiUrl.trim()) return { accounts: null, error: "мерчантын ТТД / PosAPI URL дутуу" };
  const key = `${settings.organizationId}|${tin}|${settings.ebarimtPosApiUrl.trim()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  try {
    const entry = { at: Date.now(), accounts: await posApiBankAccounts(settings.ebarimtPosApiUrl, tin), error: null };
    cache.set(key, entry);
    return entry;
  } catch (error) {
    // Алдааг кэшлэхгүй — дараагийн оролдлого дахин асууна.
    return { accounts: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Нэхэмжлэхэд хэрэглэх данс — тохиргоо, ТЕГ-ийн ганц данс эсвэл компанийн үндсэн данс. Шидэхгүй. */
export async function resolveInvoiceBank(settings: InvoiceBankSettings): Promise<InvoiceBank> {
  if (normalizeBankAccountNo(settings.ebarimtArapBankAccountNo)) return pickInvoiceBank(settings, null);
  const { accounts, error } = await registeredAccounts(settings);
  let companyAccounts: CompanyAccountHint[] = [];
  if (accounts && accounts.length > 1) {
    try {
      const { db } = await import("@/lib/db");
      const { organizationProfile } = await import("@/lib/db/schema");
      const { eq } = await import("drizzle-orm");
      const profile = await db.query.organizationProfile.findFirst({
        where: eq(organizationProfile.organizationId, settings.organizationId),
        columns: { bankAccounts: true },
      });
      companyAccounts = profile?.bankAccounts ?? [];
    } catch {
      companyAccounts = [];
    }
  }
  return pickInvoiceBank(settings, accounts, error, companyAccounts);
}
