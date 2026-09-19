// eBarimt in-process worker — DEFAULT (0 тохиргоо), lib/notifications/ticker.ts-тэй
// ижил хэв маяг: instrumentation.ts-ээс нэг удаа эхэлнэ, unref, `started` guard.
//
// 20 сек тутам: хугацаа нь болсон pending submission-уудыг PosAPI руу илгээнэ
// (server горимтой байгууллагууд). Өдөр бүр 23:30 УБ-аас хойш нэг удаа
// `sendData` (PosAPI-ийн дотоод санд үлдсэнийг ТЕГ рүү). 10 минут гацсан
// claimed мөрүүдийг чөлөөлнө. Унтраах: EBARIMT_WORKER=off.

import { processPendingEbarimt, releaseStaleClaims, runEbarimtSendData } from "./worker";

const TICK_MS = 20 * 1000;
const FIRST_TICK_DELAY_MS = 45 * 1000;
const SEND_DATA_HOUR_UB = 23;
const SEND_DATA_MINUTE_UB = 30;

let started = false;
let sendDataDoneFor = "";

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
