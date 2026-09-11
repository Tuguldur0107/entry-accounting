// PO хаалтын журналын мөрүүд — ЦЭВЭР (DB-гүй, тесттэй) хөдөлгөгч.
//
// docs/procurement §3.3 ⑥: хүлээн авалт нь бараа материалын түр дансыг
// кредитэлж (Cr), PO-той нэхэмжлэх нь өглөгийн түр дансыг дебетэлж (Dr)
// байсан. Хаалтад хоёрыг эсрэгээрээ тэгшитгэж, зөрүү (хүлээн авалт ба
// нэхэмжлэхийн өдрийн МБ ханшийн ялгаа) нь ханшийн олз/гарз болно —
// хоёр түр данс PO объектоороо 0 болно.
//
// Дансны дугаар кодод ХАТУУ БИЧИГДЭХГҮЙ — дуудагч нь
// loadCostingAccountSettings-ээс өгнө (JPR-006).

import { roundMoney } from "@/lib/arap/accounting";
import { PO_BUSINESS_OBJECT } from "@/lib/procurement/constants";

export type PoCloseLine = {
  accountNumber: string;
  debit: string;
  credit: string;
  description: string;
  sortOrder: number;
  businessObjectType: typeof PO_BUSINESS_OBJECT;
  businessObjectId: string;
};

/** Мөр орох/орохгүйн доод хязгаар (₮) — бөөрөнхийллийн шуугианыг хасна. */
const LINE_EPSILON = 0.005;
/** Ханшийн зөрүүг тусдаа мөрөөр бичих доод хязгаар (₮). */
const FX_EPSILON = 0.01;

/**
 * Түр дансдын PO-гийн үлдэгдлээс хаалтын мөрүүдийг үүсгэнэ.
 *
 * `invClearingBalance` / `apClearingBalance` нь тухайн PO-д холбогдсон
 * журналын мөрүүдийн Σ(debit − credit):
 *   - бараа материалын түр данс — хүлээн авалтаар кредитлэгддэг тул ≤ 0
 *   - өглөгийн түр данс — нэхэмжлэхээр дебетлэгддэг тул ≥ 0
 *
 * Дүрэм: `invCredit = −invClearingBalance`, `apDebit = apClearingBalance`;
 * `Dr invClearing invCredit`, `Cr apClearing apDebit`,
 * `diff = apDebit − invCredit` → `diff > 0.01` бол `Dr fxLoss diff`,
 * `diff < −0.01` бол `Cr fxGain −diff`.
 *
 * Чиглэл буруу (сөрөг) бол ШИДНЭ — журналууд эвдэрсэн гэсэн үг тул
 * автоматаар "нөхөж" бичихийг хориглоно (docs/cost: зөрүүг нуухгүй).
 * Хоёр үлдэгдэл хоёулаа 0 бол бичих зүйлгүй тул мөн ШИДНЭ.
 */
export function buildPoCloseLines(input: {
  purchaseOrderId: string;
  /** Σ(debit − credit) бараа материалын түр дансанд (хүлээгдэх нь ≤ 0 = Cr). */
  invClearingBalance: number;
  /** Σ(debit − credit) өглөгийн түр дансанд (хүлээгдэх нь ≥ 0 = Dr). */
  apClearingBalance: number;
  accounts: {
    invClearing: string;
    apClearing: string;
    fxGain: string;
    fxLoss: string;
  };
  buildCode: (main: string) => string;
  description: string;
}): PoCloseLine[] {
  const invCredit = roundMoney(-input.invClearingBalance);
  const apDebit = roundMoney(input.apClearingBalance);
  if (invCredit < -LINE_EPSILON || apDebit < -LINE_EPSILON)
    throw new Error(
      "Түр дансны үлдэгдлийн чиглэл буруу байна — захиалгын журналуудыг шалгана уу"
    );

  // НЭГ ТАЛТ үлдэгдэл — хүлээн авалт эсвэл нэхэмжлэхийн аль нэг нь GL-д
  // БИЧИГДЭЭГҮЙ (ноорог хэвээр эсвэл буцаагдсан) гэсэн үг. Ийм үед зөрүүг
  // "ханшийн" олз/гарз гэж бичвэл бүтэн худалдан авалтын дүнгээр хуурамч
  // орлого/зардал үүснэ — тиймээс хаалтыг ЗОГСООНО (баримтын түвшний
  // blocker-оос гадуур сүүлчийн хамгаалалт).
  const invPosted = invCredit > LINE_EPSILON;
  const apPosted = apDebit > LINE_EPSILON;
  if (invPosted !== apPosted)
    throw new Error(
      invPosted
        ? "Өглөгийн түр дансанд бичилт алга — нэхэмжлэх батлагдаагүй (ноорог) байна. Эхлээд нэхэмжлэхээ батлаад захиалгыг хаана уу"
        : "Бараа материалын түр дансанд бичилт алга — хүлээн авалт батлагдаагүй эсвэл буцаагдсан байна. Эхлээд хүлээн авалтаа батлаад захиалгыг хаана уу"
    );

  // Ханшийн зөрүү нь огнооны ялгаанаас үүсдэг тул худалдан авалтын дүнгийн
  // ӨЧҮҮХЭН хувь байх ёстой. 25%-иас дээш бол өгөгдөл эвдэрсэн (дутуу
  // нэхэмжлэх, буцаагдсан хуваарилалт г.м.) — чимээгүй бичихгүй, зогсооно.
  const spread = Math.abs(roundMoney(apDebit - invCredit));
  const scale = Math.max(invCredit, apDebit);
  if (scale > 0 && spread / scale > 0.25)
    throw new Error(
      `Түр дансдын зөрүү хэт их байна (${spread.toLocaleString("en-US")} / ${scale.toLocaleString("en-US")}) — ханшийн зөрүү гэж бичихгүй. Хүлээн авалт, нэхэмжлэх, хуваарилалтаа шалгана уу`
    );

  const key = {
    businessObjectType: PO_BUSINESS_OBJECT,
    businessObjectId: input.purchaseOrderId,
  } as const;
  const lines: PoCloseLine[] = [];

  if (invCredit > LINE_EPSILON)
    lines.push({
      ...key,
      accountNumber: input.buildCode(input.accounts.invClearing),
      debit: String(invCredit),
      credit: "0",
      description: input.description,
      sortOrder: 0,
    });
  if (apDebit > LINE_EPSILON)
    lines.push({
      ...key,
      accountNumber: input.buildCode(input.accounts.apClearing),
      debit: "0",
      credit: String(apDebit),
      description: input.description,
      sortOrder: 1,
    });

  // diff > 0 → өглөг илүү (ханш өссөн) → гарз; diff < 0 → олз.
  const diff = roundMoney(apDebit - invCredit);
  if (Math.abs(diff) > FX_EPSILON)
    lines.push({
      ...key,
      accountNumber: input.buildCode(
        diff > 0 ? input.accounts.fxLoss : input.accounts.fxGain
      ),
      debit: diff > 0 ? String(diff) : "0",
      credit: diff > 0 ? "0" : String(-diff),
      description: `Ханшийн ${diff > 0 ? "гарз" : "олз"}: ${input.description}`,
      sortOrder: 2,
    });

  if (lines.length === 0)
    throw new Error("Хаах үлдэгдэл алга — түр дансууд аль хэдийн 0 байна");
  return lines;
}
