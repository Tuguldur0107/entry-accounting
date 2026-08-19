// Settlement-ийн GL мөр бүтээгч — ЦЭВЭР логик (DB-гүй).
//
// Нэг л эх сурвалж: postCashDocument (lib/actions/cash.ts) болон банкны
// хуулгын импорт (app/api/cash/statements/save) хоёул үүгээр settlement
// журналын мөрөө бүтээнэ. Дүрэм: хяналтын данс нэхэмжлэхийн ТҮҮХЭН
// ханшаар хаагдаж, кассын тал төлбөрийн өдрийн ханшаар; зөрүү нь ханшийн
// олз/гарзын мөр (АР: төлбөр > түүхэн = олз; АП: эсрэгээр).

export function buildSettlementPostingLines({
  voucherId,
  documentType,
  cashAccountId,
  cashAccountNumber,
  controlAccountNumber,
  baseAmount,
  historicalBaseAmount,
  fxDifference,
  fxGainAccountNumber,
  fxLossAccountNumber,
  buildCode,
  description,
}: {
  voucherId: string;
  /** Нэхэмжлэхийн төрөл: ar_invoice | ap_bill. */
  documentType: string;
  cashAccountId: string | undefined | null;
  /** Бүтэн сегмент кодтой кассын данс. */
  cashAccountNumber: string;
  /** Бүтэн сегмент кодтой хяналтын данс. */
  controlAccountNumber: string;
  baseAmount: number;
  historicalBaseAmount: number;
  fxDifference: number;
  /** Ханшийн олз/гарзын данс — costing_account_settings-ээс (хатуу код биш). */
  fxGainAccountNumber: string;
  fxLossAccountNumber: string;
  /** Үндсэн дансыг бүтэн сегмент код болгогч (FX мөрөнд л хэрэглэнэ). */
  buildCode: (accountNumber: string) => string;
  description: string;
}) {
  const isReceivable = documentType === "ar_invoice";
  const lines = isReceivable
    ? [
        {
          voucherId,
          cashAccountId: cashAccountId ?? null,
          accountNumber: cashAccountNumber,
          debit: String(baseAmount),
          credit: "0",
          description,
          sortOrder: 0,
        },
        {
          voucherId,
          cashAccountId: null,
          accountNumber: controlAccountNumber,
          debit: "0",
          credit: String(historicalBaseAmount),
          description,
          sortOrder: 1,
        },
      ]
    : [
        {
          voucherId,
          cashAccountId: null,
          accountNumber: controlAccountNumber,
          debit: String(historicalBaseAmount),
          credit: "0",
          description,
          sortOrder: 0,
        },
        {
          voucherId,
          cashAccountId: cashAccountId ?? null,
          accountNumber: cashAccountNumber,
          debit: "0",
          credit: String(baseAmount),
          description,
          sortOrder: 1,
        },
      ];

  if (Math.abs(fxDifference) <= 0.01) return lines;

  const isGain = isReceivable ? fxDifference > 0 : fxDifference < 0;
  lines.push({
    voucherId,
    cashAccountId: null,
    accountNumber: buildCode(isGain ? fxGainAccountNumber : fxLossAccountNumber),
    debit: isGain ? "0" : String(Math.abs(fxDifference)),
    credit: isGain ? String(Math.abs(fxDifference)) : "0",
    description: `Ханшийн ${isGain ? "олз" : "гарз"}: ${description}`,
    sortOrder: 2,
  });
  return lines;
}
