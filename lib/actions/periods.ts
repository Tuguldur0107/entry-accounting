"use server";

// Нягтлан бодох периодын удирдлага — нээх / хаах / дахин нээх.
//
// Период бүртгэл нь ХААЛТ хийхэд үүсдэг: бүртгэлгүй период автоматаар
// нээлттэй. Тиймээс хэрэглэгч юу ч тохируулалгүй ажиллаж эхлээд, хаалт
// хийхээр шийдсэн үедээ л энэ дэлгэцийг хэрэглэнэ.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  accountingPeriods,
  costEntries,
  journalVouchers,
  inventoryMovements,
} from "@/lib/db/schema";
import { isPeriodCode, periodRange, type PeriodStatus } from "@/lib/periods/period";

export interface PeriodRow {
  code: string;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
  closedAt: string | null;
  /** Тухайн периодод харьяалагдах бичилтийн тоо — хаахын өмнөх мэдээлэл. */
  voucherCount: number;
  draftVoucherCount: number;
  movementCount: number;
  draftCostEntryCount: number;
}

export type PeriodActionResult =
  | { ok: true }
  | {
      ok: false;
      code: "unauthenticated" | "invalid-period" | "has-drafts" | "exists";
    };

async function requireUser() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Нэвтрэх шаардлагатай");
  return userId;
}

/**
 * Периодын жагсаалт — өгөгдөл байгаа бүх сар + бүртгэгдсэн бүх период.
 * Бичилтгүй сарыг харуулах шаардлагагүй тул хоосон саруудыг алгасна.
 */
export async function listPeriods(): Promise<PeriodRow[]> {
  const userId = await requireUser();

  const [registered, vouchers, movements, entries] = await Promise.all([
    db.query.accountingPeriods.findMany({
      where: eq(accountingPeriods.userId, userId),
    }),
    db.query.journalVouchers.findMany({
      where: eq(journalVouchers.userId, userId),
      columns: { date: true, status: true },
    }),
    db.query.inventoryMovements.findMany({
      where: eq(inventoryMovements.userId, userId),
      columns: { date: true },
    }),
    db.query.costEntries.findMany({
      where: eq(costEntries.userId, userId),
      columns: { date: true, status: true },
    }),
  ]);

  const byCode = new Map<string, PeriodRow>();
  const ensure = (code: string): PeriodRow => {
    let row = byCode.get(code);
    if (!row) {
      const { startDate, endDate } = periodRange(code);
      row = {
        code,
        startDate,
        endDate,
        status: "open",
        closedAt: null,
        voucherCount: 0,
        draftVoucherCount: 0,
        movementCount: 0,
        draftCostEntryCount: 0,
      };
      byCode.set(code, row);
    }
    return row;
  };

  for (const period of registered) {
    const row = ensure(period.code);
    row.status = period.status === "closed" ? "closed" : "open";
    row.closedAt = period.closedAt?.toISOString().slice(0, 16) ?? null;
  }
  for (const voucher of vouchers) {
    const row = ensure(voucher.date.slice(0, 7));
    row.voucherCount += 1;
    if (voucher.status === "draft") row.draftVoucherCount += 1;
  }
  for (const movement of movements) ensure(movement.date.slice(0, 7)).movementCount += 1;
  for (const entry of entries)
    if (entry.status === "draft") ensure(entry.date.slice(0, 7)).draftCostEntryCount += 1;

  return [...byCode.values()].sort((a, b) => (a.code < b.code ? 1 : -1));
}

/**
 * Шинэ тайлант үе бүртгэх — нээлттэй төлөвтэй мөр үүсгэнэ. Бүртгэлгүй сар
 * угаасаа нээлттэй тул энэ нь зөвхөн жагсаалтад урьдчилан харагдуулах,
 * дараа нь хаах суурь болдог. Давхардвал "exists" буцаана.
 */
export async function createPeriod(code: string): Promise<PeriodActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "unauthenticated" };
  if (!isPeriodCode(code)) return { ok: false, code: "invalid-period" };

  const { startDate, endDate } = periodRange(code);
  const inserted = await db
    .insert(accountingPeriods)
    .values({ userId, code, startDate, endDate, status: "open" })
    .onConflictDoNothing({
      target: [accountingPeriods.userId, accountingPeriods.code],
    })
    .returning({ code: accountingPeriods.code });
  if (inserted.length === 0) return { ok: false, code: "exists" };

  revalidatePath("/settings/periods");
  return { ok: true };
}

/**
 * Тайлант үе хаах. Ноорог бичилт үлдсэн бол ЗОГСОНО — ноорог нь хаагдсан
 * тайлант үед батлагдах боломжгүй болж "гацна" (CLAUDE.md §4: ноорог нь
 * period close-д ороогүй байх ёстой).
 */
export async function closePeriod(code: string): Promise<PeriodActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "unauthenticated" };
  if (!isPeriodCode(code)) return { ok: false, code: "invalid-period" };

  const rows = await listPeriods();
  const row = rows.find((entry) => entry.code === code);
  if (row && (row.draftVoucherCount > 0 || row.draftCostEntryCount > 0))
    return { ok: false, code: "has-drafts" };

  const { startDate, endDate } = periodRange(code);
  await db
    .insert(accountingPeriods)
    .values({
      userId,
      code,
      startDate,
      endDate,
      status: "closed",
      closedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [accountingPeriods.userId, accountingPeriods.code],
      set: { status: "closed", closedAt: new Date() },
    });

  revalidatePath("/settings/periods");
  return { ok: true };
}

/** Период дахин нээх — ил үйлдэл, closedAt цэвэрлэгдэнэ. */
export async function reopenPeriod(code: string): Promise<PeriodActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "unauthenticated" };
  if (!isPeriodCode(code)) return { ok: false, code: "invalid-period" };

  await db
    .update(accountingPeriods)
    .set({ status: "open", closedAt: null })
    .where(
      and(
        eq(accountingPeriods.userId, userId),
        eq(accountingPeriods.code, code)
      )
    );

  revalidatePath("/settings/periods");
  return { ok: true };
}
