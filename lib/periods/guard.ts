// Хаагдсан периодын ХАМГААЛАЛТ — бичилт үүсгэдэг бүх зам үүгээр дайрна.
//
// Дүрэм: бүртгэлгүй период = НЭЭЛТТЭЙ. Период бүртгэл нь хаалт хийхэд л
// үүсдэг тул шинэ систем дээр бичилт саадгүй явна. Хаагдсан период руу
// бичих оролдлого нь ойлгомжтой монгол алдаагаар зогсоно.

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { accountingPeriods } from "@/lib/db/schema";
import { periodCodeOf } from "./period";
import {
  assertCalendarDate,
  isFuturePeriodDate,
  ulaanbaatarToday,
} from "./document-date";

/**
 * Байгууллага бүрийн advisory lock түлхүүрүүд (pg_advisory_xact_lock(hashtext(orgId), N)):
 *   1 — inventory үлдэгдэл, 2 — costing run, 3 — costing close / FA run,
 *   4 — production, 5 — ПЕРИОДЫН ХААЛТ (энэ файл).
 * Периодын түлхүүр 5-ыг post замууд SHARED, closePeriod EXCLUSIVE авдаг —
 * хаалт хийгдэж байх агшинд batch post зэрэгцээд хаагдсан сард бичихээс
 * сэргийлнэ (TOCTOU).
 */
export const PERIOD_GATE_LOCK_KEY = 5;

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ClosedPeriodError extends Error {
  constructor(public readonly periodCode: string) {
    super(`${periodCode} тайлант үе хаагдсан — энэ огноогоор бичилт хийх боломжгүй`);
    this.name = "ClosedPeriodError";
  }
}

/**
 * Ирээдүйн тайлант үед БАТЛАХ оролдлого (ENT-028: 2027-06-ны журнал
 * сануулгагүй батлагдаж байв). Ноорог хэвээр үлдээж болно.
 */
export class FuturePeriodError extends Error {
  readonly code = "FUTURE_PERIOD";
  constructor(public readonly periodCode: string, today: string) {
    super(
      `${periodCode} нь ирээдүйн тайлант үе (өнөөдөр ${today}) — батлах боломжгүй; ноорог хэвээр үлдээж, тэр сар эхэлсний дараа батална уу`
    );
    this.name = "FuturePeriodError";
  }
}

/** Батлах замууд (GL, касс, АР/АП, бараа) дуудна — ирээдүйн САРЫН огноо хориотой. */
export function assertNotFuturePeriod(date: string, today: string = ulaanbaatarToday()) {
  if (isFuturePeriodDate(date, today)) throw new FuturePeriodError(date.slice(0, 7), today);
}

/** Нэг огноо бичигдэх боломжтой эсэх (хаагдсан бол алдаа шиднэ). */
export async function assertPeriodOpen(orgId: string, date: string) {
  // Хуанлид байхгүй огноо (2025-02-30) — бичилтийн бүх зам энд дайрдаг тул
  // НЭГ газраас хориглоно (ENT-027: урьд сарын тайланд огт орохгүй бичилт
  // үүсдэг байв).
  assertCalendarDate(date);
  const code = periodCodeOf(date);
  const period = await db.query.accountingPeriods.findFirst({
    where: and(
      eq(accountingPeriods.organizationId, orgId),
      eq(accountingPeriods.code, code)
    ),
    columns: { status: true },
  });
  if (period?.status === "closed") throw new ClosedPeriodError(code);
}

/**
 * Бичилтийн ТРАНЗАКЦ ДОТОР дуудна: периодын shared lock аваад периодыг
 * ДАХИН шалгана. Транзакцийн гаднах assertPeriodOpen нь UX-ийн эрт
 * шалгалт; энэ нь closePeriod-той уралдахаас хамгаалдаг жинхэнэ түгжээ.
 * Бусад advisory lock-оос ӨМНӨ (транзакцийн эхэнд) авбал deadlock-гүй.
 */
export async function assertPeriodOpenInTx(
  tx: DbTx,
  orgId: string,
  date: string
) {
  assertCalendarDate(date);
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtext(${orgId}), ${PERIOD_GATE_LOCK_KEY})`
  );
  const code = periodCodeOf(date);
  const [period] = await tx
    .select({ status: accountingPeriods.status })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.organizationId, orgId),
        eq(accountingPeriods.code, code)
      )
    );
  if (period?.status === "closed") throw new ClosedPeriodError(code);
}

/** Хэд хэдэн огноог нэг дуудалтаар шалгана (batch post). */
export async function assertPeriodsOpen(orgId: string, dates: string[]) {
  for (const date of dates) assertCalendarDate(date);
  const codes = [...new Set(dates.map(periodCodeOf))];
  if (codes.length === 0) return;
  const rows = await db.query.accountingPeriods.findMany({
    where: eq(accountingPeriods.organizationId, orgId),
    columns: { code: true, status: true },
  });
  const closed = new Set(
    rows.filter((row) => row.status === "closed").map((row) => row.code)
  );
  const hit = codes.find((code) => closed.has(code));
  if (hit) throw new ClosedPeriodError(hit);
}
