// Хаагдсан периодын ХАМГААЛАЛТ — бичилт үүсгэдэг бүх зам үүгээр дайрна.
//
// Дүрэм: бүртгэлгүй период = НЭЭЛТТЭЙ. Период бүртгэл нь хаалт хийхэд л
// үүсдэг тул шинэ систем дээр бичилт саадгүй явна. Хаагдсан период руу
// бичих оролдлого нь ойлгомжтой монгол алдаагаар зогсоно.

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { accountingPeriods } from "@/lib/db/schema";
import { periodCodeOf } from "./period";

export class ClosedPeriodError extends Error {
  constructor(public readonly periodCode: string) {
    super(`${periodCode} период хаагдсан — энэ огноогоор бичилт хийх боломжгүй`);
    this.name = "ClosedPeriodError";
  }
}

/** Нэг огноо бичигдэх боломжтой эсэх (хаагдсан бол алдаа шиднэ). */
export async function assertPeriodOpen(userId: string, date: string) {
  const code = periodCodeOf(date);
  const period = await db.query.accountingPeriods.findFirst({
    where: and(
      eq(accountingPeriods.userId, userId),
      eq(accountingPeriods.code, code)
    ),
    columns: { status: true },
  });
  if (period?.status === "closed") throw new ClosedPeriodError(code);
}

/** Хэд хэдэн огноог нэг дуудалтаар шалгана (batch post). */
export async function assertPeriodsOpen(userId: string, dates: string[]) {
  const codes = [...new Set(dates.map(periodCodeOf))];
  if (codes.length === 0) return;
  const rows = await db.query.accountingPeriods.findMany({
    where: eq(accountingPeriods.userId, userId),
    columns: { code: true, status: true },
  });
  const closed = new Set(
    rows.filter((row) => row.status === "closed").map((row) => row.code)
  );
  const hit = codes.find((code) => closed.has(code));
  if (hit) throw new ClosedPeriodError(hit);
}
