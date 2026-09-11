// Захиалгын (PO) гүйцэтгэлийн ЦЭВЭР арифметик — DB-гүй, тесттэй.
//
// docs/procurement §3.4: PO мөр бүрд Σ хүлээн авсан = захиалсан, Σ
// нэхэмжилсэн тоо = захиалсан тоо, Σ нэхэмжилсэн дүн (PO валют) = PO
// мөрийн дүн байх ёстой; бүх нэмэлт зардал хуваарилагдсан байна. Зөрвөл PO
// хаагдахгүй — шалтгааныг МОНГОЛ текстээр буцаана (UI улаанаар харуулна).

import { roundMoney } from "@/lib/arap/accounting";

export type PoLineProgress = {
  /** Захиалсан тоо хэмжээ. */
  ordered: number;
  /** Батлагдсан хүлээн авалтуудын нийлбэр тоо. */
  received: number;
  /**
   * Нэхэмжлэгдсэн нийлбэр тоо — НООРОГ нэхэмжлэх Ч ОРНО.
   * Энэ нь ИЛҮҮ НЭХЭМЖЛЭХЭЭС хамгаалах (`OVER_INVOICED`) суурь.
   */
  invoiced: number;
  /** Нэхэмжлэгдсэн нийлбэр дүн (PO валют) — ноорог Ч ОРНО. */
  invoicedAmount: number;
  /** Захиалгын мөрийн дүн (тоо × нэгж үнэ, PO валют). */
  orderedAmount: number;
  /**
   * ЗӨВХӨН БАТЛАГДСАН (posted | partially_paid | paid) нэхэмжлэхийн тоо.
   * PO ХААЛТЫН нөхцөлд ЭНЭ хэрэглэгдэнэ — клирингийн үлдэгдэл нь зөвхөн
   * posted журналаас бүрддэг тул ноорогтой PO хаагдвал тэнцэл эвдэрнэ.
   * Өгөгдөөгүй бол `invoiced`-ээр орлоно (хуучин дуудагчид хэвээр ажиллана).
   */
  postedInvoiced?: number;
  /** ЗӨВХӨН батлагдсан нэхэмжлэхийн нийлбэр дүн (PO валют). */
  postedInvoicedAmount?: number;
};

/** Тоо хэмжээний нарийвчлал — numeric(18,4). */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function fmtQty(value: number): string {
  return String(round4(value));
}

function fmtAmount(value: number): string {
  return roundMoney(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

/** Хүлээн аваагүй үлдэгдэл (сөрөг гарахгүй — илүү хүлээн авалт blocker-т). */
export function remainingToReceive(p: PoLineProgress): number {
  return Math.max(0, round4(p.ordered - p.received));
}

/** Нэхэмжлээгүй үлдэгдэл тоо хэмжээ (сөрөг гарахгүй). */
export function remainingToInvoice(p: PoLineProgress): number {
  return Math.max(0, round4(p.ordered - p.invoiced));
}

/** PO хаах боломжтой эсэх — шалтгааны монгол текстүүдийг буцаана (хоосон = хаагдана). */
export function poCloseBlockers(input: {
  lines: PoLineProgress[];
  /** Хуваарилагдаагүй нэмэлт зардлын мөрүүд (MNT). */
  unallocatedCostAmount: number;
  /**
   * PO-д холбогдсон НООРОГ нэхэмжлэхийн тоо. Ноорог нэхэмжлэх GL-д ороогүй
   * тул түр дансдын үлдэгдэлд тусаагүй байдаг — хаавал хаалтын журнал бүтэн
   * дүнг хуурамч ханшийн олз/гарз болгоно.
   */
  draftInvoiceCount?: number;
  /**
   * PO-гийн НООРОГ өртгийн бичилтийн тоо (`landed_cost` / `receipt_capitalize`)
   * — батлагдаагүй тул GL-д ороогүй.
   */
  draftCostEntryCount?: number;
  tolerance?: number;
}): string[] {
  const tolerance = input.tolerance ?? 0.005;
  if (input.lines.length === 0) return ["Захиалгад мөр байхгүй байна"];

  const blockers: string[] = [];
  let unreceivedLines = 0;
  let unreceivedQty = 0;
  let overReceivedLines = 0;
  let overReceivedQty = 0;
  let uninvoicedLines = 0;
  let uninvoicedQty = 0;
  let overInvoicedLines = 0;
  let overInvoicedQty = 0;
  let amountLines = 0;
  let amountDiff = 0;

  for (const line of input.lines) {
    const receiveDiff = round4(line.ordered - line.received);
    if (receiveDiff > tolerance) {
      unreceivedLines += 1;
      unreceivedQty += receiveDiff;
    } else if (receiveDiff < -tolerance) {
      overReceivedLines += 1;
      overReceivedQty += -receiveDiff;
    }

    // ХААЛТЫН нөхцөлд ЗӨВХӨН батлагдсан нэхэмжлэх тоологдоно (ноорог нь
    // GL-д ороогүй). `postedInvoiced` өгөгдөөгүй бол хуучин зан төлөв.
    const postedInvoiced = line.postedInvoiced ?? line.invoiced;
    const postedInvoicedAmount =
      line.postedInvoicedAmount ?? line.invoicedAmount;

    const invoiceDiff = round4(line.ordered - postedInvoiced);
    if (invoiceDiff > tolerance) {
      uninvoicedLines += 1;
      uninvoicedQty += invoiceDiff;
    } else if (invoiceDiff < -tolerance) {
      overInvoicedLines += 1;
      overInvoicedQty += -invoiceDiff;
    }

    const lineAmountDiff = roundMoney(line.orderedAmount - postedInvoicedAmount);
    if (Math.abs(lineAmountDiff) > tolerance) {
      amountLines += 1;
      amountDiff += lineAmountDiff;
    }
  }

  if (unreceivedLines > 0)
    blockers.push(
      `Хүлээн аваагүй үлдэгдэл байна — ${unreceivedLines} мөр (${fmtQty(unreceivedQty)} нэгж)`
    );
  if (overReceivedLines > 0)
    blockers.push(
      `Захиалснаас илүү хүлээн авсан — ${overReceivedLines} мөр (${fmtQty(overReceivedQty)} нэгж)`
    );
  if (uninvoicedLines > 0)
    blockers.push(
      `Нэхэмжлээгүй үлдэгдэл байна — ${uninvoicedLines} мөр (${fmtQty(uninvoicedQty)} нэгж)`
    );
  if (overInvoicedLines > 0)
    blockers.push(
      `Захиалснаас илүү нэхэмжилсэн — ${overInvoicedLines} мөр (${fmtQty(overInvoicedQty)} нэгж)`
    );
  if (amountLines > 0)
    blockers.push(
      `Нэхэмжлэхийн дүн захиалгын дүнтэй таарахгүй — ${amountLines} мөр (зөрүү ${fmtAmount(amountDiff)})`
    );

  const unallocated = roundMoney(input.unallocatedCostAmount);
  if (unallocated > tolerance)
    blockers.push(
      `Хуваарилагдаагүй нэмэлт зардал байна — ${fmtAmount(unallocated)}₮`
    );

  const draftInvoices = input.draftInvoiceCount ?? 0;
  if (draftInvoices > 0)
    blockers.push(
      `Захиалгад холбогдсон НООРОГ нэхэмжлэх байна — ${draftInvoices} баримт (эхлээд нэхэмжлэхийг батална уу)`
    );

  const draftCostEntries = input.draftCostEntryCount ?? 0;
  if (draftCostEntries > 0)
    blockers.push(
      `Батлагдаагүй өртгийн бичилт байна — ${draftCostEntries} бичилт (эхлээд өртгийн бичилтийг батална уу)`
    );

  return blockers;
}
