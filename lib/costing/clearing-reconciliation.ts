// КЛИРИНГИЙН (түр дансны) ТУЛГАЛТ — бизнес объект бүрээр.
// docs/cost 03-report-specifications §6 (corrected baseline: ЗААВАЛ).
//
// Тулгалтын түлхүүр: Данс + Объектын төрөл + Объектын ID (+ бүрэлдэхүүн).
// Хамааралгүй объектуудыг ХООРОНД нь шүүрдэж тэглэхийг хориглоно (§6.2) —
// объект бүр өөрийн Opening + Increase − Cleared = Ending мөртэй.
//
// Объектын шийдэл (GL мөрөөс):
//   1. journal_lines.cost_entry_id → өртгийн бичилт →
//        хуваарилалтын мөр байвал → "Зардлын хуваарилалт" (баримтын №)
//        эс бөгөөс хөдөлгөөнтэй бол → "Барааны хөдөлгөөн" (documentNo)
//   2. воучер нь АР/АП баримтын voucherId бол → "АР/АП баримт"
//   3. воучер нь мөнгөн гүйлгээний voucherId бол → "Мөнгөн гүйлгээ"
//   4. өөр юу ч биш → "Тодорхойгүй (гар журнал)" — ил үлдэгдэл, нуухгүй.

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocuments,
  cashDocuments,
  costComponents,
  costEntries,
  inventoryMovements,
  journalVouchers,
} from "@/lib/db/schema";
import { loadCostingAccountSettings } from "./master-data";
import { extractMainAccount } from "@/lib/reports/balances";
import type {
  ClearingObjectRow,
  ClearingReconciliation,
} from "./clearing-types";
import { roundMoney as round2 } from "@/lib/arap/accounting";

export async function loadClearingReconciliation(
  orgId: string,
  range: { from: string; to: string }
): Promise<ClearingReconciliation> {
  const [roles, components] = await Promise.all([
    loadCostingAccountSettings(orgId),
    db.query.costComponents.findMany({
      where: eq(costComponents.organizationId, orgId),
      columns: { id: true, code: true, name: true, accountNumber: true },
    }),
  ]);

  // Тулгах данснууд: ерөнхий клиринг + бүрэлдэхүүнүүдийн өөрийн данс.
  const accounts = [
    ...new Set(
      [
        roles.clearingAccountNumber,
        ...components.map((component) => component.accountNumber),
      ].filter((account): account is string => Boolean(account))
    ),
  ];

  // БҮХ түүхийг уншина (opening-д мужаас өмнөх нийлбэр хэрэгтэй).
  const vouchers = await db.query.journalVouchers.findMany({
    where: and(
      eq(journalVouchers.organizationId, orgId),
      inArray(journalVouchers.status, ["posted", "reversed"])
    ),
    with: { lines: true },
    columns: { id: true, date: true, description: true },
  });

  type RawLine = {
    voucherId: string;
    voucherDate: string;
    voucherDescription: string;
    account: string;
    delta: number; // дебет − кредит
    costEntryId: string | null;
  };
  const raw: RawLine[] = [];
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      const main = extractMainAccount(line.accountNumber);
      if (!accounts.includes(main)) continue;
      raw.push({
        voucherId: voucher.id,
        voucherDate: voucher.date,
        voucherDescription: line.description || voucher.description,
        account: main,
        delta: Number(line.debit) - Number(line.credit),
        costEntryId: line.costEntryId,
      });
    }
  }
  if (raw.length === 0)
    return { accounts: [], rows: [], unknownCount: 0, unknownAmount: 0 };

  // ── Объектын шийдэлд хэрэгтэй хайлтын хүснэгтүүд ──────────────────────────
  const entryIds = [
    ...new Set(
      raw.map((line) => line.costEntryId).filter((id): id is string => !!id)
    ),
  ];
  const voucherIds = [...new Set(raw.map((line) => line.voucherId))];

  const [entries, allocationLines, apDocs, cashDocs] = await Promise.all([
    entryIds.length > 0
      ? db.query.costEntries.findMany({
          where: and(
            eq(costEntries.organizationId, orgId),
            inArray(costEntries.id, entryIds)
          ),
          columns: {
            id: true,
            movementId: true,
            itemId: true,
            costComponentId: true,
            entryType: true,
          },
        })
      : Promise.resolve([]),
    db.query.costAllocationLines.findMany({
      with: {
        allocation: {
          columns: { documentNo: true, organizationId: true, costComponentId: true },
        },
      },
    }),
    db.query.arApDocuments.findMany({
      where: and(
        eq(arApDocuments.organizationId, orgId),
        inArray(arApDocuments.voucherId, voucherIds)
      ),
      columns: { voucherId: true, documentNo: true, documentType: true },
    }),
    db.query.cashDocuments.findMany({
      where: and(
        eq(cashDocuments.organizationId, orgId),
        inArray(cashDocuments.voucherId, voucherIds)
      ),
      columns: { voucherId: true, documentNo: true },
    }),
  ]);

  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const allocationByEntry = new Map(
    allocationLines
      .filter((line) => line.allocation?.organizationId === orgId && line.costEntryId)
      .map((line) => [line.costEntryId!, line.allocation])
  );
  const apByVoucher = new Map(
    apDocs
      .filter((doc) => doc.voucherId)
      .map((doc) => [doc.voucherId!, doc])
  );
  const cashByVoucher = new Map(
    cashDocs
      .filter((doc) => doc.voucherId)
      .map((doc) => [doc.voucherId!, doc])
  );
  const componentById = new Map(
    components.map((component) => [component.id, component])
  );

  const movementIds = [
    ...new Set(
      entries
        .map((entry) => entry.movementId)
        .filter((id): id is string => !!id)
    ),
  ];
  const movements =
    movementIds.length > 0
      ? await db.query.inventoryMovements.findMany({
          where: and(
            eq(inventoryMovements.organizationId, orgId),
            inArray(inventoryMovements.id, movementIds)
          ),
          columns: { id: true, documentNo: true },
        })
      : [];
  const movementById = new Map(movements.map((row) => [row.id, row]));

  // ── Мөр бүрийг объектод оноох ────────────────────────────────────────────
  interface Bucket {
    account: string;
    objectType: string;
    objectId: string;
    objectLabel: string;
    componentLabel: string | null;
    opening: number;
    increase: number;
    cleared: number;
    lastDate: string;
    known: boolean;
  }
  const buckets = new Map<string, Bucket>();

  for (const line of raw) {
    let objectType = "Тодорхойгүй (гар журнал)";
    let objectId = line.voucherId;
    let objectLabel = line.voucherDescription || line.voucherId.slice(0, 8);
    let componentLabel: string | null = null;
    let known = false;

    const entry = line.costEntryId ? entryById.get(line.costEntryId) : null;
    if (entry) {
      const allocation = allocationByEntry.get(entry.id);
      if (allocation) {
        objectType = "Зардлын хуваарилалт";
        objectId = allocation.documentNo;
        objectLabel = allocation.documentNo;
        const component = allocation.costComponentId
          ? componentById.get(allocation.costComponentId)
          : entry.costComponentId
            ? componentById.get(entry.costComponentId)
            : null;
        componentLabel = component
          ? `${component.code} · ${component.name}`
          : null;
        known = true;
      } else if (entry.movementId) {
        const movement = movementById.get(entry.movementId);
        objectType = "Барааны хөдөлгөөн";
        objectId = movement?.documentNo ?? entry.movementId;
        objectLabel = movement?.documentNo ?? entry.movementId.slice(0, 8);
        const component = entry.costComponentId
          ? componentById.get(entry.costComponentId)
          : null;
        componentLabel = component
          ? `${component.code} · ${component.name}`
          : null;
        known = true;
      }
    } else {
      const apDoc = apByVoucher.get(line.voucherId);
      const cashDoc = cashByVoucher.get(line.voucherId);
      if (apDoc) {
        objectType =
          apDoc.documentType === "ap_bill"
            ? "Өглөгийн нэхэмжлэх"
            : "Авлагын нэхэмжлэл";
        objectId = apDoc.documentNo;
        objectLabel = apDoc.documentNo;
        known = true;
      } else if (cashDoc) {
        objectType = "Мөнгөн гүйлгээ";
        objectId = cashDoc.documentNo;
        objectLabel = cashDoc.documentNo;
        known = true;
      }
    }

    const key = `${line.account}::${objectType}::${objectId}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        account: line.account,
        objectType,
        objectId,
        objectLabel,
        componentLabel,
        opening: 0,
        increase: 0,
        cleared: 0,
        lastDate: line.voucherDate,
        known,
      };
      buckets.set(key, bucket);
    }
    if (line.voucherDate > bucket.lastDate) bucket.lastDate = line.voucherDate;
    if (componentLabel && !bucket.componentLabel)
      bucket.componentLabel = componentLabel;

    if (line.voucherDate < range.from) {
      bucket.opening += line.delta;
    } else if (line.voucherDate <= range.to) {
      // Клирингт ОРОХ нь дебет (бүрэлдэхүүн хүлээн авах), ГАРАХ нь кредит
      // (нөөцөд капитализацилагдах). Дебет = Increase, кредит = Cleared.
      if (line.delta >= 0) bucket.increase += line.delta;
      else bucket.cleared += -line.delta;
    }
    // Мужийн дараах мөр тооцогдохгүй.
  }

  const rows: ClearingObjectRow[] = [...buckets.values()]
    .map((bucket) => {
      const opening = round2(bucket.opening);
      const increase = round2(bucket.increase);
      const cleared = round2(bucket.cleared);
      const ending = round2(opening + increase - cleared);
      return {
        account: bucket.account,
        objectType: bucket.objectType,
        objectId: bucket.objectId,
        objectLabel: bucket.objectLabel,
        componentLabel: bucket.componentLabel,
        opening,
        increase,
        cleared,
        ending,
        lastDate: bucket.lastDate,
        known: bucket.known,
        status:
          Math.abs(ending) <= 0.01
            ? ("cleared" as const)
            : bucket.known
              ? ("open" as const)
              : ("unknown" as const),
      };
    })
    // Идэвхгүй (бүх дүн 0) объектыг нуана — чимээ.
    .filter(
      (row) =>
        Math.abs(row.opening) > 0.005 ||
        Math.abs(row.increase) > 0.005 ||
        Math.abs(row.cleared) > 0.005
    )
    .sort((a, b) =>
      a.account === b.account
        ? Math.abs(b.ending) - Math.abs(a.ending)
        : a.account.localeCompare(b.account)
    );

  const accountSummaries = accounts
    .map((account) => {
      const accountRows = rows.filter((row) => row.account === account);
      return {
        account,
        opening: round2(
          accountRows.reduce((sum, row) => sum + row.opening, 0)
        ),
        increase: round2(
          accountRows.reduce((sum, row) => sum + row.increase, 0)
        ),
        cleared: round2(
          accountRows.reduce((sum, row) => sum + row.cleared, 0)
        ),
        ending: round2(accountRows.reduce((sum, row) => sum + row.ending, 0)),
        objectCount: accountRows.length,
      };
    })
    .filter(
      (summary) =>
        summary.objectCount > 0 ||
        Math.abs(summary.opening) > 0.005 ||
        Math.abs(summary.ending) > 0.005
    );

  const unknownRows = rows.filter((row) => row.status === "unknown");

  return {
    accounts: accountSummaries,
    rows,
    unknownCount: unknownRows.length,
    unknownAmount: round2(
      unknownRows.reduce((sum, row) => sum + row.ending, 0)
    ),
  };
}

/** Хоосон дүн — ачаалагч алдаагүй боловч тулгах данс/мөр байхгүй үед. */
export const EMPTY_CLEARING: ClearingReconciliation = {
  accounts: [],
  rows: [],
  unknownCount: 0,
  unknownAmount: 0,
};
