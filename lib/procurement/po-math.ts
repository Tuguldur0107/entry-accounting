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
  /** Нэхэмжлэгдсэн нийлбэр тоо. */
  invoiced: number;
  /** Нэхэмжлэгдсэн нийлбэр дүн (PO валют). */
  invoicedAmount: number;
  /** Захиалгын мөрийн дүн (тоо × нэгж үнэ, PO валют). */
  orderedAmount: number;
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

    const invoiceDiff = round4(line.ordered - line.invoiced);
    if (invoiceDiff > tolerance) {
      uninvoicedLines += 1;
      uninvoicedQty += invoiceDiff;
    } else if (invoiceDiff < -tolerance) {
      overInvoicedLines += 1;
      overInvoicedQty += -invoiceDiff;
    }

    const lineAmountDiff = roundMoney(line.orderedAmount - line.invoicedAmount);
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

  return blockers;
}
