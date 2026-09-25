// Өөр валюттай мөнгөн дансны хооронд шилжүүлэг (валют худалдан авах/зарах) —
// SIM2-021. ЦЭВЭР (tests/sim2-exchange-transfer.test.ts).
//
// Нэг кассын баримт нэг валюттай тул солилцоо = ХОЁР баримт түр дансаар:
//   зарлага (эх данс, эх валютаар) → Кт эх данс / Дт түр данс
//   орлого (хүлээн авах данс)      → Дт хүлээн авах / Кт түр данс
// Хоёр тал ИЖИЛ ₮ дүнтэй тул түр данс 0 болно. Ханш ЗОХИОХГҮЙ: хүлээн авсан
// дүн (toAmount) эсвэл арилжааны ханш (exchangeRate) ил өгөгдөнө. Валютын
// дансны дансны ханштай зөрүү нь сарын FX тэгшитгэлээр гарна.

export type CurrencyExchangePlan = {
  /** Эх данснаас гарах дүн (эх дансны валютаар). */
  fromAmount: number;
  /** Эх баримтын ханш (1 валют = ? ₮; MNT бол 1). */
  fromRate: number;
  /** Хүлээн авах дансанд орох дүн (тэр дансны валютаар). */
  toAmount: number;
  toRate: number;
  /** Хоёр талын ₮ дүн — түр данс тэглэгдэнэ. */
  mnt: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const round8 = (value: number) => Math.round(value * 1e8) / 1e8;

export function planCurrencyExchange(input: {
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  toAmount?: number | null;
  exchangeRate?: number | null;
}): CurrencyExchangePlan {
  const from = input.fromCurrency.trim().toUpperCase() || "MNT";
  const to = input.toCurrency.trim().toUpperCase() || "MNT";
  if (from === to) throw new Error("Дансууд ижил валюттай — энгийн шилжүүлэг хийнэ");
  if (from !== "MNT" && to !== "MNT")
    throw new Error(
      `[CROSS_CURRENCY] ${from} → ${to} шууд солилцоо дэмжигдэхгүй — хоёр алхмаар (${from} → MNT, MNT → ${to})`
    );
  const amount = round2(Number(input.amount));
  if (!(amount > 0)) throw new Error("Дүн 0-ээс их байна");
  const toAmount = input.toAmount != null ? round2(Number(input.toAmount)) : null;
  const rate = input.exchangeRate != null ? Number(input.exchangeRate) : null;
  if (toAmount === null && !(rate && rate > 0))
    throw new Error(
      "[RATE_REQUIRED] Валют солилцоонд хүлээн авсан дүн (toAmount) эсвэл арилжааны ханш (exchangeRate) өгнө — ханш зохиохгүй"
    );
  if (toAmount !== null && !(toAmount > 0)) throw new Error("toAmount 0-ээс их байна");

  if (from === "MNT") {
    // Валют худалдан авах: ₮ төлж валют авна.
    const fc = toAmount ?? round2(amount / rate!);
    if (!(fc > 0)) throw new Error("Хүлээн авах валютын дүн 0 болж байна");
    return { fromAmount: amount, fromRate: 1, toAmount: fc, toRate: round8(amount / fc), mnt: amount };
  }
  // Валют зарах: валют өгч ₮ авна.
  const mnt = toAmount ?? round2(amount * rate!);
  if (!(mnt > 0)) throw new Error("Хүлээн авах ₮ дүн 0 болж байна");
  return { fromAmount: amount, fromRate: round8(mnt / amount), toAmount: mnt, toRate: 1, mnt };
}
