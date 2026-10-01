// eBarimt in-process worker — DEFAULT (0 тохиргоо), lib/notifications/ticker.ts-тэй
// ижил хэв маяг: instrumentation.ts-ээс нэг удаа эхэлнэ, unref, `started` guard.
//
// 20 сек тутам: хугацаа нь болсон pending submission-уудыг PosAPI руу илгээнэ
// (server горимтой байгууллагууд). Өдөр бүр 23:30 УБ-аас хойш нэг удаа
// `sendData` (PosAPI-ийн дотоод санд үлдсэнийг ТЕГ рүү). 10 минут гацсан
// claimed мөрүүдийг чөлөөлнө. 10 мин тутам ТЕГ-ийн TPI-ээс нэхэмжлэхийн
// үлдэгдэл татах хугацаа болсон байгууллагыг шалгана (өдөрт нэг, ЗӨВХӨН 01:00–07:00 УБ — TPI-ийн албан хязгаар;
// анхны нөхөлт үргэлжилж байвал 10 мин тутам — tax-reconcile.ts isTaxSyncDue).
// Унтраах: EBARIMT_WORKER=off.

import { runDueEbarimtPurchaseSyncs } from "./purchase-sync";
import { runDueEbarimtTaxSyncs } from "./tax-sync";
import { processPendingEbarimt, releaseStaleClaims, runEbarimtSendData } from "./worker";

const TICK_MS = 20 * 1000;
const FIRST_TICK_DELAY_MS = 45 * 1000;
const SEND_DATA_HOUR_UB = 23;
const SEND_DATA_MINUTE_UB = 30;
const TAX_SYNC_CHECK_MS = 10 * 60 * 1000;

let started = false;
let sendDataDoneFor = "";
let taxSyncCheckedAt = 0;
let taxSyncRunning = false;

/** ТЕГ-ийн TPI татлага — урт (≤31 өдөр × хуудас) тул тикийг БЛОКЛОХГҮЙ, давхар эхлэхгүй. */
function maybeRunTaxSync(): void {
  const now = Date.now();
  if (taxSyncRunning || now - taxSyncCheckedAt < TAX_SYNC_CHECK_MS) return;
  taxSyncCheckedAt = now;
  taxSyncRunning = true;
  // Борлуулалт → худалдан авалт ДАРААЛАН (ТЕГ-ийг зэрэг ачаалахгүй); нэгний алдаа нөгөөд нөлөөлөхгүй.
  void runDueEbarimtTaxSyncs()
    .then(async (result) => {
      if (result.synced > 0) console.log(`[ebarimt] ТЕГ-ийн TPI татлага: ${result.synced} байгууллага`);
      for (const error of result.errors) console.error("[ebarimt] TPI", error);
      const purchases = await runDueEbarimtPurchaseSyncs();
      if (purchases.synced > 0) console.log(`[ebarimt] ТЕГ-ийн худалдан авалт: ${purchases.synced} байгууллага`);
      for (const error of purchases.errors) console.error("[ebarimt] TPI худалдан авалт", error);
    })
    .finally(() => {
      taxSyncRunning = false;
    });
}

function ulaanbaatarParts(now = new Date()): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ulaanbaatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}

export async function ebarimtTick(): Promise<void> {
  try {
    await releaseStaleClaims();
    const result = await processPendingEbarimt();
    if (result.sent > 0 || result.failed > 0 || result.errors.length > 0)
      console.log(`[ebarimt] ${result.claimed} авав, ${result.sent} илгээв, ${result.failed} алдаа`);
    for (const failure of result.errors) console.error("[ebarimt]", failure.submissionId, failure.error);
    const { date, hour, minute } = ulaanbaatarParts();
    if (sendDataDoneFor !== date && (hour > SEND_DATA_HOUR_UB || (hour === SEND_DATA_HOUR_UB && minute >= SEND_DATA_MINUTE_UB))) {
      sendDataDoneFor = date;
      const sent = await runEbarimtSendData();
      if (sent.organizations > 0) console.log(`[ebarimt] sendData: ${sent.organizations} байгууллага, ${sent.errors.length} алдаа`);
      for (const error of sent.errors) console.error("[ebarimt] sendData", error);
    }
    maybeRunTaxSync();
  } catch (error) {
    console.error("[ebarimt] ticker:", error);
  }
}

export function startEbarimtWorker(): void {
  if (started) return;
  started = true;
  if (process.env.EBARIMT_WORKER === "off") return;
  if (!process.env.DATABASE_URL) return;
  const first = setTimeout(() => void ebarimtTick(), FIRST_TICK_DELAY_MS);
  if (typeof first.unref === "function") first.unref();
  const timer = setInterval(() => void ebarimtTick(), TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
}
