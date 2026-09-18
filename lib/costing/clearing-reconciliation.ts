// КЛИРИНГИЙН (түр дансны) ТУЛГАЛТ — бизнес объект бүрээр.
// docs/cost 03-report-specifications §6 (corrected baseline: ЗААВАЛ).
//
// Тулгалтын түлхүүр: Данс + Объектын төрөл + Объектын ID (+ бүрэлдэхүүн).
// Хамааралгүй объектуудыг ХООРОНД нь шүүрдэж тэглэхийг хориглоно (§6.2) —
// объект бүр өөрийн Opening + Increase − Cleared = Ending мөртэй.
//
// Объектын шийдэл (GL мөрөөс):
//   0. journal_lines.business_object_type/id — БИЧИХ МӨЧИД тавигдсан түлхүүр
//        (FR-PROC-004, ж: "purchase_order" + PO id) → PO дугаараар нэрлэнэ.
//        Хангамжийн Dr (өглөгийн түр данс) ба Cr (бараа мат. түр данс) НЭГ
//        объектод буух цорын ганц найдвартай зам тул ЭНЭ нь ТЭРГҮҮН.
//   1. journal_lines.cost_entry_id → өртгийн бичилт →
//        хуваарилалтын мөр байвал → "Зардлын хуваарилалт" (баримтын №)
//        эс бөгөөс хөдөлгөөнтэй бол → "Барааны хөдөлгөөн" (documentNo)
//   2. воучер нь АР/АП баримтын voucherId бол → "АР/АП баримт"
//        (PO-той баримт бол түлхүүргүй хуучин мөрийг ч PO объектод буулгана)
//   3. воучер нь мөнгөн гүйлгээний voucherId бол → "Мөнгөн гүйлгээ"
//   4. өөр юу ч биш → "Тодорхойгүй (гар журнал)" — ил үлдэгдэл, нуухгүй.
//
// БУЦААЛТ: мөр өөрөө нотолгоогүй бол ЭХ журналынхаа (reversalOfVoucherId)
// ижил данс дээрх мөрийн объектыг өвлөнө — эс бөгөөс эх + буцаалт хоёулаа
// тусдаа "нээлттэй" объект болж, тэгширсэн хос нь худал сэрэмжлүүлэг өгнө.

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocumentLines,
  arApDocuments,
  cashDocuments,
  costComponents,
  costEntries,
  inventoryItems,
  inventoryMovements,
  journalVouchers,
  purchaseOrders,
} from "@/lib/db/schema";
import { PO_BUSINESS_OBJECT } from "@/lib/procurement/constants";
import {
  resolveClearingObjectWithReversal,
  type ClearingLookups,
} from "./clearing-objects";
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

  // Тулгах данснууд: бараа материалын түр данс + ӨГЛӨГИЙН түр данс
  // (хангамж — docs/procurement §3.1) + бүрэлдэхүүнүүдийн өөрийн данс.
  const accounts = [
    ...new Set(
      [
        roles.clearingAccountNumber,
        roles.apClearingAccountNumber,
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
    columns: {
      id: true,
      date: true,
      description: true,
      reversalOfVoucherId: true,
    },
  });
  // Буцаалт → эх журнал (объект өвлүүлэхэд).
  const reversalOf = new Map(
    vouchers
      .filter((voucher) => voucher.reversalOfVoucherId)
      .map((voucher) => [voucher.id, voucher.reversalOfVoucherId!])
  );

  type RawLine = {
    voucherId: string;
    voucherDate: string;
    voucherDescription: string;
    account: string;
    delta: number; // дебет − кредит
    costEntryId: string | null;
    businessObjectType: string | null;
    businessObjectId: string | null;
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
        businessObjectType: line.businessObjectType,
        businessObjectId: line.businessObjectId,
      });
    }
  }
  if (raw.length === 0)
    return {
      accounts: [],
      rows: [],
      unknownCount: 0,
      unknownAmount: 0,
      unknownGross: 0,
    };

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
      columns: {
        voucherId: true,
        documentNo: true,
        documentType: true,
        // Хангамж: түлхүүргүй хуучин мөрийг ч PO объектод буулгана.
        purchaseOrderId: true,
      },
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
          // sourceType/sourceId — PO-гүй худалдан авалтын гинжийг сэргээнэ
          // (АП мөр Dr клиринг → түүнээс үүссэн хөдөлгөөн Cr клиринг).
          columns: {
            id: true,
            documentNo: true,
            sourceType: true,
            sourceId: true,
          },
        })
      : [];
  const movementById = new Map(movements.map((row) => [row.id, row]));

  // Хөдөлгөөн нь АР/АП-ийн мөрөөс үүссэн бол тэр БАРИМТЫН объектод буулгана —
  // эс бөгөөс нэг худалдан авалт хоёр объект болж хэзээ ч тэгширэхгүй.
  const arapLineIds = [
    ...new Set(
      movements
        .filter((row) => row.sourceType === "arap_line" && row.sourceId)
        .map((row) => row.sourceId as string)
    ),
  ];
  const arapLineDocs =
    arapLineIds.length > 0
      ? await db
          .select({
            lineId: arApDocumentLines.id,
            documentNo: arApDocuments.documentNo,
            documentType: arApDocuments.documentType,
            purchaseOrderId: arApDocuments.purchaseOrderId,
          })
          .from(arApDocumentLines)
          .innerJoin(
            arApDocuments,
            eq(arApDocumentLines.documentId, arApDocuments.id)
          )
          .where(
            and(
              eq(arApDocuments.organizationId, orgId),
              inArray(arApDocumentLines.id, arapLineIds)
            )
          )
      : [];
  const apByArapLine = new Map(
    arapLineDocs.map((row) => [row.lineId, row])
  );

  // Хөдөлгөөнгүй үлдсэн (устгагдсан хөдөлгөөний буцаагдсан) өртгийн бичилт —
  // барааны нэрээр нэрлэнэ, "Тодорхойгүй" руу унагахгүй.
  const orphanItemIds = [
    ...new Set(
      entries
        .filter((entry) => !entry.movementId && entry.itemId)
        .map((entry) => entry.itemId as string)
    ),
  ];
  const orphanItems =
    orphanItemIds.length > 0
      ? await db.query.inventoryItems.findMany({
          where: and(
            eq(inventoryItems.organizationId, orgId),
            inArray(inventoryItems.id, orphanItemIds)
          ),
          columns: { id: true, code: true, name: true },
        })
      : [];
  const itemById = new Map(orphanItems.map((item) => [item.id, item]));

  // Захиалгын дугаарууд — объектын шошгод (мөрийн түлхүүр ба PO-той АР/АП
  // баримт хоёуланг нэрлэнэ).
  const orderIds = [
    ...new Set(
      [
        ...raw
          .filter((line) => line.businessObjectType === PO_BUSINESS_OBJECT)
          .map((line) => line.businessObjectId),
        ...apDocs.map((doc) => doc.purchaseOrderId),
      ].filter((id): id is string => !!id)
    ),
  ];
  const orders =
    orderIds.length > 0
      ? await db.query.purchaseOrders.findMany({
          where: and(
            eq(purchaseOrders.organizationId, orgId),
            inArray(purchaseOrders.id, orderIds)
          ),
          columns: { id: true, documentNo: true },
        })
      : [];
  const orderById = new Map(orders.map((order) => [order.id, order]));

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

  // Воучер + данс бүрийн түүхий мөрүүд — буцаалт эхийнхээ мөрийг олоход.
  const rawByVoucherAccount = new Map<string, RawLine[]>();
  for (const line of raw) {
    const indexKey = `${line.voucherId}::${line.account}`;
    const list = rawByVoucherAccount.get(indexKey);
    if (list) list.push(line);
    else rawByVoucherAccount.set(indexKey, [line]);
  }

  const lookups: ClearingLookups = {
    entryById,
    allocationByEntry,
    movementById,
    apByArapLine,
    apByVoucher,
    cashByVoucher,
    componentById,
    orderById,
    itemById,
  };

  for (const line of raw) {
    const { objectType, objectId, objectLabel, componentLabel, known } =
      resolveClearingObjectWithReversal(line, lookups, {
        reversalOf,
        linesByVoucherAccount: rawByVoucherAccount,
      });

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

  const allRows: ClearingObjectRow[] = [...buckets.values()].map((bucket) => {
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
  });

  // Идэвхгүй (бүх дүн 0) объектыг хүснэгтээс нуана — чимээ.
  const rows: ClearingObjectRow[] = allRows
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
      // Дүн нь БҮХ объектоос (тэгширсэн нь ч тооцогдоно) — данс үнэхээр
      // тэнцсэн эсэхийг харуулах цорын ганц зөв тоо.
      const accountRows = allRows.filter((row) => row.account === account);
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
        // Хүснэгтэд харагдах (идэвхтэй) объектын тоо.
        objectCount: rows.filter((row) => row.account === account).length,
      };
    })
    // Огт хөдөлгөөнгүй данс л хасагдана.
    .filter((summary) => allRows.some((row) => row.account === summary.account));

  const unknownRows = rows.filter((row) => row.status === "unknown");

  return {
    accounts: accountSummaries,
    rows,
    unknownCount: unknownRows.length,
    unknownAmount: round2(
      unknownRows.reduce((sum, row) => sum + row.ending, 0)
    ),
    unknownGross: round2(
      unknownRows.reduce((sum, row) => sum + Math.abs(row.ending), 0)
    ),
  };
}

/** Хоосон дүн — ачаалагч алдаагүй боловч тулгах данс/мөр байхгүй үед. */
export const EMPTY_CLEARING: ClearingReconciliation = {
  accounts: [],
  rows: [],
  unknownCount: 0,
  unknownAmount: 0,
  unknownGross: 0,
};
