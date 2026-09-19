// In-process ticker — DEFAULT (0 тохиргоо) scheduler (D7). Лицензийн beacon-той
// ижил хэв маяг (lib/licensing/beacon.ts): instrumentation.ts-ээс нэг удаа
// эхэлнэ, `started` guard, unref (shutdown-д саад болохгүй).
//
// 15 минут тутам: Улаанбаатарын цаг 08:00-оос хойш бол өдрийн ажлыг дуудна.
// Ажил бүр notification_runs-аар байгууллага × өдөрт НЭГ удаа л ажиллах тул
// давтан tick, олон instance, cron route-тэй давхцал бүгд аюулгүй.
//
// Унтраах: NOTIFICATIONS_TICKER=off (гадны cron-оор л ажиллуулах бол).

import { runDailyNotifications } from "./scheduler";

/** Өдрийн ажил эхлэх цаг — Улаанбаатарын цагаар. */
export const DAILY_JOB_HOUR_UB = 8;
const TICK_MS = 15 * 60 * 1000;
/** Deploy болмогц шууд биш — DB migration/push дуусах зайг өгнө. */
const FIRST_TICK_DELAY_MS = 60 * 1000;

let started = false;
let running = false;

function hourInUlaanbaatar(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ulaanbaatar",
      hour: "2-digit",
      hour12: false,
    }).format(now)
  );
}

export async function tick(): Promise<void> {
  if (running) return;
  if (hourInUlaanbaatar() < DAILY_JOB_HOUR_UB) return;
  running = true;
  try {
    const result = await runDailyNotifications();
    if (result.claimed > 0 || result.errors.length > 0)
      console.log(
        `[notifications] ${result.today}: ${result.claimed} байгууллага, ${result.emitted} мэдэгдэл` +
          (result.errors.length ? `, ${result.errors.length} алдаа` : "")
      );
    for (const failure of result.errors)
      console.error("[notifications] байгууллага", failure.organizationId, failure.error);
  } catch (error) {
    console.error("[notifications] ticker:", error);
  } finally {
    running = false;
  }
}

export function startNotificationTicker(): void {
  if (started) return;
  started = true;
  if (process.env.NOTIFICATIONS_TICKER === "off") return;
  if (!process.env.DATABASE_URL) return;

  const first = setTimeout(() => void tick(), FIRST_TICK_DELAY_MS);
  if (typeof first.unref === "function") first.unref();
  const timer = setInterval(() => void tick(), TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
}
