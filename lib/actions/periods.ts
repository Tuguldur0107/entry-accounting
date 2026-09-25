"use server";

// Нягтлан бодох периодын удирдлага — нээх / хаах / дахин нээх.
//
// Период бүртгэл нь ХААЛТ хийхэд үүсдэг: бүртгэлгүй период автоматаар
// нээлттэй. Тиймээс хэрэглэгч юу ч тохируулалгүй ажиллаж эхлээд, хаалт
// хийхээр шийдсэн үедээ л энэ дэлгэцийг хэрэглэнэ.

import { and, between, count, eq, gt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getActiveOrg, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  accountingPeriods,
  arApDocuments,
  cashDocuments,
  costEntries,
  costingAccountSettings,
  faDepreciationEntries,
  goodsReceipts,
  journalVouchers,
  inventoryMovements,
  posShifts,
  purchaseOrders,
} from "@/lib/db/schema";
import {
  deleteCashPeriodSnapshot,
  writeCashPeriodSnapshot,
} from "@/lib/cash/period-snapshot";
import {
  deleteInventoryPeriodSnapshot,
  writeInventoryPeriodSnapshot,
} from "@/lib/inventory/period-snapshot";
import {
  deletePeriodSnapshot,
  writePeriodSnapshot,
} from "@/lib/periods/snapshot";
import { PERIOD_GATE_LOCK_KEY } from "@/lib/periods/guard";
import {
  isPeriodCode,
  periodRange,
  previousPeriodCode,
  type PeriodStatus,
} from "@/lib/periods/period";
import { logAuditEvent } from "@/lib/audit";
import { markPeriodTrainingFlags } from "@/lib/ai-logging/service";
import { runBeforePeriodClose } from "@/lib/custom/loader";
import { fmtDateTimeUb } from "@/lib/format/datetime";

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
        /** Тухайн сард батлагдсан хүлээн авалттай НЭЭЛТТЭЙ PO үлдсэн. */
        | "open-purchase-orders"
        /** POS: нээлттэй ээлж үлдсэн (docs/pos §3.3 ⑦). */
        | "open-pos-shifts"
        /**
         * Тухайн сард батлагдсан зарлага/буцаалт/тохируулгатай бараа×агуулах
         * бүр сарын өртгийн тооцоололд "calculated" байх ёстой — хасах
         * үлдэгдэл г.м. шалтгаанаар зогссон бол сар хаагдахгүй (docs/pos §2.1 C1).
         */
        | "unvalued-movements"
        | "exists"
        | "not-closed"
        /** Өмнөх сар нээлттэй — хаалт дарааллаар (snapshot-ын зангуу). */
        | "previous-open"
        /** Дараагийн сар хаалттай — эхлээд түүнийг дахин нээнэ. */
        | "later-closed";
    }
  | {
      ok: false;
      /** custom/ hook хаалтыг зогсоосон — reason хэрэглэгчид харагдана. */
      code: "hook-rejected";
      reason: string;
    };

// Период нээх/хаах/дахин нээх — admin+ эрхтэй гишүүн; жагсаалт унших —
// гишүүн бүр. requireRole алдаа шидвэл дуудагч { ok: false } буцаана.
async function requireAdmin() {
  try {
    return await requireRole("admin");
  } catch {
    return null;
  }
}

/**
 * Периодын жагсаалт — өгөгдөл байгаа бүх сар + бүртгэгдсэн бүх период.
 * Бичилтгүй сарыг харуулах шаардлагагүй тул хоосон саруудыг алгасна.
 */
export async function listPeriods(): Promise<PeriodRow[]> {
  const { orgId } = await getActiveOrg();

  const [registered, vouchers, movements, entries] = await Promise.all([
    db.query.accountingPeriods.findMany({
      where: eq(accountingPeriods.organizationId, orgId),
    }),
    db.query.journalVouchers.findMany({
      where: eq(journalVouchers.organizationId, orgId),
      columns: { date: true, status: true },
    }),
    db.query.inventoryMovements.findMany({
      where: eq(inventoryMovements.organizationId, orgId),
      columns: { date: true },
    }),
    db.query.costEntries.findMany({
      where: eq(costEntries.organizationId, orgId),
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
    row.closedAt = fmtDateTimeUb(period.closedAt);
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
  const active = await requireAdmin();
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId, userId } = active;
  if (!isPeriodCode(code)) return { ok: false, code: "invalid-period" };

  const { startDate, endDate } = periodRange(code);
  const inserted = await db
    .insert(accountingPeriods)
    .values({
      userId,
      organizationId: orgId,
      code,
      startDate,
      endDate,
      status: "open",
    })
    .onConflictDoNothing({
      target: [accountingPeriods.organizationId, accountingPeriods.code],
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
 *
 * Хангамж (docs/procurement §3.3 ⑧, шийдвэр #7): тухайн сард батлагдсан
 * хүлээн авалттай НЭЭЛТТЭЙ захиалга (PO) байвал мөн ЗОГСОНО — PO хаагдаагүй
 * бол түр дансууд тэгшитгэгдээгүй, нэмэлт зардал хаалтын дараа ирэх
 * боломжтой хэвээр байна.
 */
export async function closePeriod(code: string): Promise<PeriodActionResult> {
  const active = await requireAdmin();
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId, userId } = active;
  if (!isPeriodCode(code)) return { ok: false, code: "invalid-period" };

  const { startDate, endDate } = periodRange(code);

  // Exclusive advisory lock: post замууд shared lock-оо транзакц дотроо
  // авдаг тул хаалт хийгдэж дуусах хүртэл шинэ бичилт хүлээнэ — ноорог
  // тооллого болон "closed" upsert хоёрын завсар бичилт орох боломжгүй.
  // Хангамжийн хориг ч ЭНЭ lock дотор шалгагдана: PO хаах / хүлээн авалт
  // батлах замууд shared lock авдаг тул зэрэгцээ бичилт хоригийг гүйцэж
  // чадахгүй.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${orgId}), ${PERIOD_GATE_LOCK_KEY})`
    );

    // ДАРААЛСАН хаалт: өмнөх сар нээлттэй (бүртгэлгүй ч) бол ЗОГСОНО —
    // snapshot-ууд (П28 GL, касс, бараа, өртгийн зангуу) "зангуунаас өмнөх
    // бүх үе хаагдсан, өөрчлөгдөхгүй" гэдэгт тулгуурладаг. Эхний тайлант
    // үе (өмнө нь ямар ч бичилтгүй) чөлөөтэй хаагдана.
    const previous = previousPeriodCode(code);
    const [previousRow] = await tx
      .select({ status: accountingPeriods.status })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.organizationId, orgId),
          eq(accountingPeriods.code, previous)
        )
      );
    if (previousRow?.status !== "closed") {
      const [earlier] = (await tx.execute(sql`
        select (
          exists (select 1 from journal_vouchers where organization_id = ${orgId} and date < ${startDate})
          or exists (select 1 from cash_documents where organization_id = ${orgId} and date < ${startDate})
          or exists (select 1 from inventory_movements where organization_id = ${orgId} and date < ${startDate})
          or exists (select 1 from ar_ap_documents where organization_id = ${orgId} and date < ${startDate})
          or exists (select 1 from cost_entries where organization_id = ${orgId} and date < ${startDate})
        ) as found
      `)) as unknown as { found: boolean }[];
      if (earlier?.found) return { kind: "previous-open" as const };
    }

    // Бүх дэд дэвтрийн ноорог энэ сард үлдсэн эсэх — хаасны дараа тэдгээр
    // ноорог батлагдах боломжгүй болж гацдаг тул бүгдийг шалгана.
    const draftCounts = await Promise.all([
      tx
        .select({ n: count() })
        .from(journalVouchers)
        .where(
          and(
            eq(journalVouchers.organizationId, orgId),
            eq(journalVouchers.status, "draft"),
            between(journalVouchers.date, startDate, endDate)
          )
        ),
      tx
        .select({ n: count() })
        .from(costEntries)
        .where(
          and(
            eq(costEntries.organizationId, orgId),
            eq(costEntries.status, "draft"),
            between(costEntries.date, startDate, endDate)
          )
        ),
      tx
        .select({ n: count() })
        .from(cashDocuments)
        .where(
          and(
            eq(cashDocuments.organizationId, orgId),
            eq(cashDocuments.status, "draft"),
            between(cashDocuments.date, startDate, endDate)
          )
        ),
      tx
        .select({ n: count() })
        .from(arApDocuments)
        .where(
          and(
            eq(arApDocuments.organizationId, orgId),
            eq(arApDocuments.status, "draft"),
            between(arApDocuments.date, startDate, endDate)
          )
        ),
      tx
        .select({ n: count() })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.organizationId, orgId),
            eq(inventoryMovements.status, "draft"),
            between(inventoryMovements.date, startDate, endDate)
          )
        ),
      tx
        .select({ n: count() })
        .from(faDepreciationEntries)
        .where(
          and(
            eq(faDepreciationEntries.organizationId, orgId),
            eq(faDepreciationEntries.status, "draft"),
            eq(faDepreciationEntries.periodMonth, code)
          )
        ),
      // Хангамж: батлагдаагүй хүлээн авалтын баримт — батлагдвал хаагдсан
      // сар руу капитализацийн журнал бичих болно.
      tx
        .select({ n: count() })
        .from(goodsReceipts)
        .where(
          and(
            eq(goodsReceipts.organizationId, orgId),
            eq(goodsReceipts.status, "draft"),
            between(goodsReceipts.date, startDate, endDate)
          )
        ),
    ]);
    if (draftCounts.some(([row]) => Number(row?.n ?? 0) > 0))
      return { kind: "drafts" as const };

    // Хангамжийн хориг (docs/procurement шийдвэр #7): тухайн сард батлагдсан
    // хүлээн авалттай, гэхдээ хаагдаагүй (open) захиалга байвал сар хаагдахгүй.
    const [openPo] = await tx
      .select({ n: count() })
      .from(goodsReceipts)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.purchaseOrderId))
      .where(
        and(
          eq(goodsReceipts.organizationId, orgId),
          eq(goodsReceipts.status, "confirmed"),
          between(goodsReceipts.date, startDate, endDate),
          eq(purchaseOrders.status, "open")
        )
      );
    // SIM2-023: байгууллага «анхааруулга» горим сонгосон бол хориглохгүй
    // (checklist-д анхааруулга хэвээр) — анхдагч нь OD-011-ийн хатуу хориг.
    if (Number(openPo?.n ?? 0) > 0) {
      const [mode] = await tx
        .select({ value: costingAccountSettings.openPoCloseMode })
        .from(costingAccountSettings)
        .where(eq(costingAccountSettings.organizationId, orgId));
      if (mode?.value !== "warn") return { kind: "open-purchase-orders" as const };
    }

    // POS: энэ сард (эсвэл өмнө нь) нээгдсэн, хаагдаагүй ээлж байвал хаагдахгүй —
    // ээлжийн зөрүү энэ сард бичигдэх ёстой (docs/pos §3.3 ⑥⑦).
    const [openShift] = await tx
      .select({ n: count() })
      .from(posShifts)
      .where(
        and(
          eq(posShifts.organizationId, orgId),
          eq(posShifts.status, "open"),
          sql`${posShifts.openedAt} < (${endDate}::date + interval '1 day')`
        )
      );
    if (Number(openShift?.n ?? 0) > 0) return { kind: "open-pos-shifts" as const };

    // C1 (docs/pos §2.1): сарын дунджаар үнэлэгдэх ёстой батлагдсан хөдөлгөөн
    // (зарлага, буцаалт, тохируулга) бүрийн бараа×агуулах тухайн сарын
    // cost_period_results-д "calculated" байх ёстой. Хасах үлдэгдэл, өртөггүй
    // орлого зэргээр зогссон эсвэл тооцоолол огт хийгээгүй бол COGS дутуу
    // хаагдахаас сэргийлнэ. Үнэ зохиохгүй — засаад дахин тооцно.
    const [unvalued] = (await tx.execute(sql`
      select count(*)::int as n
      from inventory_movements m
      where m.organization_id = ${orgId}
        and m.status = 'confirmed'
        and m.movement_type in ('issue', 'return_in', 'return_out', 'adjustment')
        and m.item_id is not null and m.warehouse_id is not null
        and m.date between ${startDate} and ${endDate}
        and not exists (
          select 1 from cost_period_results r
          where r.organization_id = ${orgId}
            and r.item_id = m.item_id and r.warehouse_id = m.warehouse_id
            and r.period_code = ${code} and r.status = 'calculated'
        )
    `)) as unknown as { n: number }[];
    if (Number(unvalued?.n ?? 0) > 0) return { kind: "unvalued-movements" as const };

    // custom/ hook — ноорог тооллогын ДАРАА, lock дотор.
    const hook = await runBeforePeriodClose({ orgId, userId, code, startDate, endDate });
    if (!hook.ok)
      return {
        kind: "hook" as const,
        reason: hook.reason || "Өргөтгөлийн hook хаалтыг зогсоолоо",
      };

    await tx
      .insert(accountingPeriods)
      .values({
        userId,
        organizationId: orgId,
        code,
        startDate,
        endDate,
        status: "closed",
        closedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [accountingPeriods.organizationId, accountingPeriods.code],
        set: { status: "closed", closedAt: new Date() },
      });
    // П28 — хаагдсан агшны дансны үлдэгдлийн snapshot (lock дотор тул
    // зэрэгцээ бичилтгүй үнэн төлөв). Дахин нээхэд устдаг.
    await writePeriodSnapshot(tx, { orgId, userId, code, startDate, endDate });
    // Кассын дансны хаалтын үлдэгдэл (дансны валютаар) — ижил lock дотор.
    await writeCashPeriodSnapshot(tx, { orgId, userId, code, endDate });
    // Бараа × агуулахын тоо хэмжээний үлдэгдэл — ижил lock дотор.
    await writeInventoryPeriodSnapshot(tx, { orgId, userId, code, endDate });
    // AI бүртгэл (docs/ai-logging.md §6): энэ мужид багтах баримтуудын
    // сургалтын шошго ИДЭВХЖИНЭ. Хаагдсан үеийн бичилт immutable тул
    // шошго нь тогтвортой — сургалтын шүүлтүүрийн 2 дахь нөхцөл.
    await markPeriodTrainingFlags(
      { orgId },
      { startDate, endDate, closed: true },
      tx
    );
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "close",
        entityType: "period",
        entityId: code,
        summary: `Период хаагдав — ${code} (${startDate} … ${endDate})`,
      },
      tx
    );
    return { kind: "closed" as const };
  });
  if (outcome.kind === "drafts") return { ok: false, code: "has-drafts" };
  if (outcome.kind === "previous-open") return { ok: false, code: "previous-open" };
  if (outcome.kind === "open-purchase-orders")
    return { ok: false, code: "open-purchase-orders" };
  if (outcome.kind === "open-pos-shifts") return { ok: false, code: "open-pos-shifts" };
  if (outcome.kind === "unvalued-movements")
    return { ok: false, code: "unvalued-movements" };
  if (outcome.kind === "hook")
    return { ok: false, code: "hook-rejected", reason: outcome.reason };

  revalidatePath("/settings/periods");
  return { ok: true };
}

/** Период дахин нээх — ил үйлдэл, closedAt цэвэрлэгдэнэ. */
export async function reopenPeriod(code: string): Promise<PeriodActionResult> {
  const active = await requireAdmin();
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId, userId } = active;
  if (!isPeriodCode(code)) return { ok: false, code: "invalid-period" };

  // Зөвхөн ХААЛТТАЙ периодыг дахин нээнэ — бүртгэлгүй/нээлттэй период
  // угаасаа нээлттэй тул "нээх" зүйл байхгүй (мөр статус update нь
  // хийсвэр амжилт мэт харагдахаас сэргийлнэ). Нэг транзакцад snapshot
  // мөн устдаг (П28) — нээлттэй периодын snapshot худал мэдээлэл.
  const reopened = await db.transaction(async (tx) => {
    // Зөвхөн ХАМГИЙН СҮҮЛИЙН хаалттай үеийг нээнэ — дунд нь нээлттэй үе
    // үүсвэл дараагийн хаалтуудын snapshot худал болно (хаалт дараалсантай
    // тэгш хэмтэй дүрэм).
    const [later] = await tx
      .select({ code: accountingPeriods.code })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.organizationId, orgId),
          eq(accountingPeriods.status, "closed"),
          gt(accountingPeriods.code, code)
        )
      )
      .limit(1);
    if (later) return "later-closed" as const;
    const [row] = await tx
      .update(accountingPeriods)
      .set({ status: "open", closedAt: null })
      .where(
        and(
          eq(accountingPeriods.organizationId, orgId),
          eq(accountingPeriods.code, code),
          eq(accountingPeriods.status, "closed")
        )
      )
      .returning({ code: accountingPeriods.code });
    if (!row) return false;
    await deletePeriodSnapshot(tx, { orgId, code });
    await deleteCashPeriodSnapshot(tx, { orgId, code });
    await deleteInventoryPeriodSnapshot(tx, { orgId, code });
    // Үе дахин нээгдэв — бичилт өөрчлөгдөж болох болсон тул сургалтын
    // шошгыг БУЦААНА (тэгш хэмтэй дүрэм; дахин хаахад сэргэнэ).
    const reopenRange = periodRange(code);
    await markPeriodTrainingFlags(
      { orgId },
      {
        startDate: reopenRange.startDate,
        endDate: reopenRange.endDate,
        closed: false,
      },
      tx
    );
    return true;
  });
  if (reopened === "later-closed") return { ok: false, code: "later-closed" };
  if (!reopened) return { ok: false, code: "not-closed" };

  // Аудитын мөр — хаагдсан периодыг нээх нь мэдрэг үйлдэл.
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "reopen",
    entityType: "period",
    entityId: code,
    summary: `Период дахин нээгдэв — ${code}`,
  });

  revalidatePath("/settings/periods");
  return { ok: true };
}
