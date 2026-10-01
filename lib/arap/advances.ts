// Урьдчилгааны DB давхарга (docs/dev/arap.md §5l): дансны роль, харилцагчийн
// урьдчилгааны үлдэгдэл. Эрхийн шалгалт action-д (lib/actions/arap-advances.ts);
// энд зөвхөн orgId-оор scope. Цэвэр логик lib/arap/advance-math.ts.

import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arapAdvanceApplications,
  arapAdvanceSettings,
  cashDocuments,
  counterparties,
} from "@/lib/db/schema";

import {
  computeAdvanceBalances,
  type AdvanceBalance,
  type AdvanceSide,
} from "./advance-math";

export * from "./advance-math";

export type AdvanceSettings = {
  customerAdvanceAccountNumber: string;
  supplierAdvanceAccountNumber: string;
};

/** Дансны роль — мөргүй бол default-аар (31300001 / 18000001) НЭГ удаа үүсгэнэ. */
export async function loadAdvanceSettings(orgId: string): Promise<AdvanceSettings> {
  const existing = await db.query.arapAdvanceSettings.findFirst({
    where: eq(arapAdvanceSettings.organizationId, orgId),
  });
  if (existing) return existing;
  await db
    .insert(arapAdvanceSettings)
    .values({ organizationId: orgId })
    .onConflictDoNothing();
  const row = await db.query.arapAdvanceSettings.findFirst({
    where: eq(arapAdvanceSettings.organizationId, orgId),
  });
  if (!row) throw new Error("Урьдчилгааны тохиргоо үүсгэж чадсангүй");
  return row;
}

export function advanceAccountFor(settings: AdvanceSettings, side: AdvanceSide): string {
  return side === "customer"
    ? settings.customerAdvanceAccountNumber
    : settings.supplierAdvanceAccountNumber;
}

export type CounterpartyAdvanceBalance = AdvanceBalance & {
  counterpartyName: string;
  accountNumber: string;
};

/**
 * Харилцагчийн урьдчилгааны үлдэгдэл (MNT) — урьдчилгааны дансан дээрх
 * харилцагчтай, нэхэмжлэхгүй, батлагдсан кассын баримт − суутгасан дүн.
 * `tx` өгвөл транзакц дотор (суутгахын өмнөх дахин шалгалт) уншина.
 */
export async function loadAdvanceBalances(
  orgId: string,
  options: {
    counterpartyId?: string;
    side?: AdvanceSide;
    settings?: AdvanceSettings;
    executor?: Pick<typeof db, "select">;
  } = {}
): Promise<CounterpartyAdvanceBalance[]> {
  const executor = options.executor ?? db;
  const settings = options.settings ?? (await loadAdvanceSettings(orgId));
  const sides: AdvanceSide[] = options.side ? [options.side] : ["customer", "supplier"];
  const accountBySide = new Map(sides.map((side) => [side, advanceAccountFor(settings, side)]));
  const sideByAccount = new Map([...accountBySide].map(([side, account]) => [account, side]));

  const cashWhere: SQL[] = [
    eq(cashDocuments.organizationId, orgId),
    eq(cashDocuments.status, "posted"),
    isNull(cashDocuments.arApDocumentId),
    isNotNull(cashDocuments.counterpartyId),
    inArray(cashDocuments.counterAccountNumber, [...sideByAccount.keys()]),
  ];
  if (options.counterpartyId) cashWhere.push(eq(cashDocuments.counterpartyId, options.counterpartyId));
  const cash = await executor
    .select({
      counterpartyId: cashDocuments.counterpartyId,
      documentType: cashDocuments.documentType,
      account: cashDocuments.counterAccountNumber,
      amount: sql<string>`sum(${cashDocuments.baseAmount})`,
    })
    .from(cashDocuments)
    .where(and(...cashWhere))
    .groupBy(cashDocuments.counterpartyId, cashDocuments.documentType, cashDocuments.counterAccountNumber);

  const applicationWhere: SQL[] = [
    eq(arapAdvanceApplications.organizationId, orgId),
    inArray(arapAdvanceApplications.side, sides),
  ];
  if (options.counterpartyId)
    applicationWhere.push(eq(arapAdvanceApplications.counterpartyId, options.counterpartyId));
  const applications = await executor
    .select({
      counterpartyId: arapAdvanceApplications.counterpartyId,
      side: arapAdvanceApplications.side,
      amount: sql<string>`sum(${arapAdvanceApplications.amount})`,
    })
    .from(arapAdvanceApplications)
    .where(and(...applicationWhere))
    .groupBy(arapAdvanceApplications.counterpartyId, arapAdvanceApplications.side);

  const balances = computeAdvanceBalances(
    cash
      .filter((row) => row.counterpartyId && row.account && sideByAccount.has(row.account))
      .map((row) => ({
        counterpartyId: row.counterpartyId as string,
        side: sideByAccount.get(row.account as string)!,
        documentType: row.documentType,
        amount: Number(row.amount),
      })),
    applications.map((row) => ({
      counterpartyId: row.counterpartyId,
      side: row.side as AdvanceSide,
      amount: Number(row.amount),
    }))
  );
  if (balances.length === 0) return [];
  const names = await executor
    .select({ id: counterparties.id, name: counterparties.name })
    .from(counterparties)
    .where(
      and(
        eq(counterparties.organizationId, orgId),
        inArray(counterparties.id, [...new Set(balances.map((row) => row.counterpartyId))])
      )
    );
  const nameById = new Map(names.map((row) => [row.id, row.name]));
  return balances
    .map((row) => ({
      ...row,
      counterpartyName: nameById.get(row.counterpartyId) ?? "",
      accountNumber: accountBySide.get(row.side) ?? "",
    }))
    .sort(
      (left, right) =>
        left.counterpartyName.localeCompare(right.counterpartyName) ||
        left.side.localeCompare(right.side)
    );
}

/** Суутгалын журналууд — актад (statement) давхар тооцохгүйн тулд. */
export async function loadAdvanceApplicationVoucherIds(
  orgId: string,
  counterpartyId?: string
): Promise<Set<string>> {
  const rows = await db
    .select({ voucherId: arapAdvanceApplications.voucherId })
    .from(arapAdvanceApplications)
    .where(
      and(
        eq(arapAdvanceApplications.organizationId, orgId),
        ...(counterpartyId ? [eq(arapAdvanceApplications.counterpartyId, counterpartyId)] : [])
      )
    );
  return new Set(rows.map((row) => row.voucherId));
}
