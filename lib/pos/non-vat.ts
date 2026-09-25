// НӨАТ-гүй POS борлуулалт — ЦЭВЭР дүрэм (tests/pos-non-vat.test.ts), CLIENT-SAFE.
//
// Кассын «НӨАТ» унтраалттай борлуулалт (хэрэглэгчийн хүсэлт — өмнө баримт
// олгосон борлуулалтыг нөхөж оруулах, залруулга г.м.):
//   • НӨАТ задлахгүй — мөрийн дүн бүтнээрээ орлого (vatAmount = 0)
//   • eBarimt ҮҮСГЭХГҮЙ — дараалалд орохгүй, дараа нь «Илгээх» ч боломжгүй
//     (НӨАТ задлаагүй баримтыг ТЕГ-д илгээвэл дүн зөрнө)
//   • GL — pos_settings-ийн ТУСДАА орлого / авлагын данс (тайлан, гүйлгээ
//     баланст ил харагдана); данс тохируулаагүй бол татгалзана (ЗОХИОХГҮЙ)
//   • Шалтгаан ЗААВАЛ, эрх pos:post (менежерийн зөвшөөрөлтэй адил), аудитад ил
// НӨАТ төлөгч БУС байгууллагад бүх борлуулалт аль хэдийн НӨАТ-гүй тул туг нөлөөгүй.

/** Шалтгааны бэлэн сонголт (чөлөөт текст ч болно). */
export const NON_VAT_REASON_PRESETS = ["Нөхөж оруулсан борлуулалт", "Залруулга"] as const;

export const NON_VAT_ERRORS = {
  reasonRequired: "NON_VAT_REASON_REQUIRED",
  accountsRequired: "NON_VAT_ACCOUNTS_REQUIRED",
  ebarimtConflict: "NON_VAT_EBARIMT_CONFLICT",
} as const;

/** Менежерийн зөвшөөрлийн шалтгаан (approvalReasons) — pos:post шаардана. */
export const NON_VAT_APPROVAL_REASON = "НӨАТ-гүй борлуулалт (eBarimt үүсэхгүй)";

export interface NonVatSaleInput {
  nonVat?: boolean | null;
  nonVatReason?: string | null;
  /** Гар ДДТД эсвэл худалдан авагчийн eBarimt мэдээлэл өгсөн эсэх. */
  hasEbarimtData?: boolean;
}

export interface NonVatAccountSettings {
  nonVatRevenueAccountNumber: string | null;
  nonVatReceivableAccountNumber: string | null;
}

export type NonVatPlan =
  | { nonVat: false }
  | { nonVat: true; reason: string; revenueAccountNumber: string; receivableAccountNumber: string };

/**
 * Борлуулалтын НӨАТ-ын горимыг шийднэ. Буруу бол `[CODE] текст`-ээр ШИДНЭ.
 * `orgIsVatPayer` = vat_settings.isVatPayer (төлөгч бус бол туг нөлөөгүй).
 */
export function planNonVatSale(
  input: NonVatSaleInput,
  settings: NonVatAccountSettings,
  orgIsVatPayer: boolean
): NonVatPlan {
  if (!input.nonVat || !orgIsVatPayer) return { nonVat: false };
  const reason = (input.nonVatReason ?? "").trim();
  if (reason.length < 3)
    throw new Error(`[${NON_VAT_ERRORS.reasonRequired}] НӨАТ-гүй борлуулалтын шалтгааныг бичнэ үү (нөхөж оруулсан, залруулга г.м.)`);
  if (input.hasEbarimtData)
    throw new Error(
      `[${NON_VAT_ERRORS.ebarimtConflict}] НӨАТ-гүй борлуулалтад eBarimt худалдан авагч / ДДТД өгөхгүй — «НӨАТ»-ийг асаана уу`
    );
  const revenueAccountNumber = settings.nonVatRevenueAccountNumber?.trim() ?? "";
  const receivableAccountNumber = settings.nonVatReceivableAccountNumber?.trim() ?? "";
  if (!revenueAccountNumber || !receivableAccountNumber)
    throw new Error(
      `[${NON_VAT_ERRORS.accountsRequired}] НӨАТ-гүй борлуулалтын орлого, авлагын данс тохируулаагүй — POS тохиргоо → Данс`
    );
  return { nonVat: true, reason: reason.slice(0, 200), revenueAccountNumber, receivableAccountNumber };
}
