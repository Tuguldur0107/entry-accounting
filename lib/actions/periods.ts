"use server";

// Нягтлан бодох периодын удирдлага — нээх / хаах / дахин нээх.
//
// Период бүртгэл нь ХААЛТ хийхэд үүсдэг: бүртгэлгүй период автоматаар
// нээлттэй. Тиймээс хэрэглэгч юу ч тохируулалгүй ажиллаж эхлээд, хаалт
// хийхээр шийдсэн үедээ л энэ дэлгэцийг хэрэглэнэ.

import { and, between, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  accountingPeriods,
  arApDocuments,
  cashDocuments,
  costEntries,
  faDepreciationEntries,
  journalVouchers,
  inventoryMovements,
} from "@/lib/db/schema";
import { PERIOD_GATE_LOCK_KEY } from "@/lib/periods/guard";
import { isPeriodCode, periodRange, type PeriodStatus } from "@/lib/periods/period";
import { logAuditEvent } from "@/lib/audit";

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
      code:
        | "unauthenticated"
        | "invalid-period"
        | "has-drafts"
        | "exists"
        | "not-closed";
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

  const { startDate, endDate } = periodRange(code);

  // Exclusive advisory lock: post замууд shared lock-оо транзакц дотроо
  // авдаг тул хаалт хийгдэж дуусах хүртэл шинэ бичилт хүлээнэ — ноорог
  // тооллого болон "closed" upsert хоёрын завсар бичилт орох боломжгүй.
  const hasDrafts = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${userId}), ${PERIOD_GATE_LOCK_KEY})`
    );

    // Бүх дэд дэвтрийн ноорог энэ сард үлдсэн эсэх — хаасны дараа тэдгээр
    // ноорог батлагдах боломжгүй болж гацдаг тул бүгдийг шалгана.
    const draftCounts = await Promise.all([
      tx
        .select({ n: count() })
        .from(journalVouchers)
        .where(
          and(
            eq(journalVouchers.userId, userId),
            eq(journalVouchers.status, "draft"),
            between(journalVouchers.date, startDate, endDate)
          )
        ),
      tx
        .select({ n: count() })
        .from(costEntries)
        .where(
          and(
            eq(costEntries.userId, userId),
            eq(costEntries.status, "draft"),
            between(costEntries.date, startDate, endDate)
          )
        ),
      tx
        .select({ n: count() })
        .from(cashDocuments)
        .where(
          and(
            eq(cashDocuments.userId, userId),
            eq(cashDocuments.status, "draft"),
            between(cashDocuments.date, startDate, endDate)
          )
        ),
      tx
        .select({ n: count() })
        .from(arApDocuments)
        .where(
          and(
            eq(arApDocuments.userId, userId),
            eq(arApDocuments.status, "draft"),
            between(arApDocuments.date, startDate, endDate)
          )
        ),
      tx
        .select({ n: count() })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.userId, userId),
            eq(inventoryMovements.status, "draft"),
            between(inventoryMovements.date, startDate, endDate)
          )
        ),
      tx
        .select({ n: count() })
        .from(faDepreciationEntries)
        .where(
          and(
            eq(faDepreciationEntries.userId, userId),
            eq(faDepreciationEntries.status, "draft"),
            eq(faDepreciationEntries.periodMonth, code)
          )
        ),
    ]);
    if (draftCounts.some(([row]) => Number(row?.n ?? 0) > 0)) return true;

    await tx
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
    await logAuditEvent(
      {
        userId,
        action: "close",
        entityType: "period",
        entityId: code,
        summary: `Период хаагдав — ${code} (${startDate} … ${endDate})`,
      },
      tx
    );
    return false;
  });
  if (hasDrafts) return { ok: false, code: "has-drafts" };

  revalidatePath("/settings/periods");
  return { ok: true };
}

/** Период дахин нээх — ил үйлдэл, closedAt цэвэрлэгдэнэ. */
export async function reopenPeriod(code: string): Promise<PeriodActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "unauthenticated" };
  if (!isPeriodCode(code)) return { ok: false, code: "invalid-period" };

  // Зөвхөн ХААЛТТАЙ периодыг дахин нээнэ — бүртгэлгүй/нээлттэй период
  // угаасаа нээлттэй тул "нээх" зүйл байхгүй (мөр статус update нь
  // хийсвэр амжилт мэт харагдахаас сэргийлнэ).
  const [reopened] = await db
    .update(accountingPeriods)
    .set({ status: "open", closedAt: null })
    .where(
      and(
        eq(accountingPeriods.userId, userId),
        eq(accountingPeriods.code, code),
        eq(accountingPeriods.status, "closed")
      )
    )
    .returning({ code: accountingPeriods.code });
  if (!reopened) return { ok: false, code: "not-closed" };

  // Аудитын мөр — хаагдсан периодыг нээх нь мэдрэг үйлдэл.
  await logAuditEvent({
    userId,
    action: "reopen",
    entityType: "period",
    entityId: code,
    summary: `Период дахин нээгдэв — ${code}`,
  });

  revalidatePath("/settings/periods");
  return { ok: true };
}
