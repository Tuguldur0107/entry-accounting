// eBarimt-д илгээсэн баримтуудын НЭГДСЭН жагсаалт — DB давхарга ("use server" БИШ;
// list-page.ts дууддаг). Цэвэр төрөл/нийлбэр: list-types.ts.
//
// Мөр = eBarimt төлөвтэй БАРИМТ (POS борлуулалт, АР нэхэмжлэх) — илгээлтийн
// оролдлого бүр биш. Илгээгдсэн баримтын дүн нь ТЕГ-д очсон СҮҮЛИЙН receipt-ээс
// (`payload.request` — дахин бодохгүй): POS-ын хэсэгчилсэн буцаалтын дараа
// inactiveId засварын баримт (үлдсэн дүн) нь эх борлуулалтын бүтэн дүнг орлоно.

import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { arApDocuments, posEbarimtSubmissions, posSales } from "@/lib/db/schema";

import type { EbarimtDocumentRow, EbarimtDocumentSource } from "./list-types";

export * from "./list-types";

/** Эх бүрийн дээд хязгаар — сард үүнээс их бол `truncated` (огнооны мужаа нарийсгана). */
export const EBARIMT_LIST_LIMIT = 5000;

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

type TargetColumn = typeof posEbarimtSubmissions.saleId | typeof posEbarimtSubmissions.arapDocumentId;

interface ReceiptFacts {
  lastError: string | null;
  /** receipt байхгүй (DELETE-ийн мөр, бэлтгэгдээгүй) бол null. */
  receipt: { total: number; vat: number; cityTax: number; type: string | null; customerTin: string | null } | null;
}

const request = (field: "totalAmount" | "totalVAT" | "totalCityTax" | "type" | "customerTin") =>
  sql<string | null>`${posEbarimtSubmissions.payload}->'request'->>${field}::text`;

/**
 * Баримт бүрийн СҮҮЛИЙН илгээлт (DISTINCT ON — түүхийг бүтнээр татахгүй, payload-оос
 * зөвхөн хэрэгтэй талбарууд). `onlySent` → ТЕГ-д очсон сүүлийн receipt (дүнгийн эх).
 */
async function latestFacts(orgId: string, column: TargetColumn, ids: string[], onlySent: boolean) {
  const facts = new Map<string, ReceiptFacts>();
  if (ids.length === 0) return facts;
  const conditions = [eq(posEbarimtSubmissions.organizationId, orgId), inArray(column, ids)];
  if (onlySent)
    conditions.push(eq(posEbarimtSubmissions.status, "sent"), sql`${posEbarimtSubmissions.payload}->'request' is not null`);
  const rows = await db
    .selectDistinctOn([column], {
      targetId: column,
      lastError: posEbarimtSubmissions.lastError,
      hasRequest: sql<boolean>`${posEbarimtSubmissions.payload}->'request' is not null`,
      total: request("totalAmount"),
      vat: request("totalVAT"),
      cityTax: request("totalCityTax"),
      type: request("type"),
      customerTin: request("customerTin"),
    })
    .from(posEbarimtSubmissions)
    .where(and(...conditions))
    .orderBy(column, desc(posEbarimtSubmissions.createdAt));
  for (const row of rows) {
    if (!row.targetId) continue;
    facts.set(row.targetId, {
      lastError: row.lastError,
      receipt: row.hasRequest
        ? {
            total: num(row.total),
            vat: num(row.vat),
            cityTax: num(row.cityTax),
            type: row.type,
            customerTin: row.customerTin,
          }
        : null,
    });
  }
  return facts;
}

async function loadPosRows(orgId: string, from: string, to: string) {
  // Буцаалтын мөр (isReturn) өөрөө eBarimt баримт биш — эх борлуулалтын ДДТД-г
  // засдаг (queue.ts) тул eBarimt төлөвгүй; энд зөвхөн борлуулалт.
  const rows = await db.query.posSales.findMany({
    where: and(
      eq(posSales.organizationId, orgId),
      gte(posSales.date, from),
      lte(posSales.date, to),
      isNotNull(posSales.ebarimtStatus)
    ),
    columns: {
      id: true,
      documentNo: true,
      date: true,
      status: true,
      total: true,
      vatAmount: true,
      cityTaxAmount: true,
      ebarimtId: true,
      ebarimtStatus: true,
      ebarimtDate: true,
      ebarimtType: true,
      ebarimtCustomerTin: true,
    },
    with: { counterparty: { columns: { name: true } } },
    orderBy: [desc(posSales.soldAt)],
    limit: EBARIMT_LIST_LIMIT + 1,
  });
  const truncated = rows.length > EBARIMT_LIST_LIMIT;
  const kept = rows.slice(0, EBARIMT_LIST_LIMIT);
  const [sent, latest] = await Promise.all([
    latestFacts(
      orgId,
      posEbarimtSubmissions.saleId,
      kept.filter((row) => row.ebarimtStatus === "sent").map((row) => row.id),
      true
    ),
    latestFacts(
      orgId,
      posEbarimtSubmissions.saleId,
      kept.filter((row) => row.ebarimtStatus !== "sent" && row.ebarimtStatus !== "manual").map((row) => row.id),
      false
    ),
  ]);
  const result: EbarimtDocumentRow[] = kept.map((row) => {
    const receipt = row.ebarimtStatus === "sent" ? sent.get(row.id)?.receipt ?? null : null;
    return {
      key: `pos:${row.id}`,
      source: "pos",
      id: row.id,
      documentNo: row.documentNo,
      date: row.date,
      counterpartyName: row.counterparty?.name ?? null,
      customerTin: row.ebarimtCustomerTin,
      partiallyReturned: row.status === "partially_returned",
      ebarimtType: row.ebarimtType,
      status: row.ebarimtStatus ?? "",
      ebarimtId: row.ebarimtId,
      ebarimtDate: row.ebarimtDate,
      total: receipt ? receipt.total : num(row.total),
      vat: receipt ? receipt.vat : num(row.vatAmount),
      cityTax: receipt ? receipt.cityTax : num(row.cityTaxAmount),
      lastError: latest.get(row.id)?.lastError ?? null,
    };
  });
  return { rows: result, truncated };
}

async function loadArapRows(orgId: string, from: string, to: string) {
  const rows = await db.query.arApDocuments.findMany({
    where: and(
      eq(arApDocuments.organizationId, orgId),
      gte(arApDocuments.date, from),
      lte(arApDocuments.date, to),
      isNotNull(arApDocuments.ebarimtStatus)
    ),
    columns: {
      id: true,
      documentNo: true,
      date: true,
      baseTotalAmount: true,
      ebarimtId: true,
      ebarimtStatus: true,
      ebarimtDate: true,
      ebarimtType: true,
    },
    with: { counterparty: { columns: { name: true } } },
    orderBy: [desc(arApDocuments.date), desc(arApDocuments.createdAt)],
    limit: EBARIMT_LIST_LIMIT + 1,
  });
  const truncated = rows.length > EBARIMT_LIST_LIMIT;
  const kept = rows.slice(0, EBARIMT_LIST_LIMIT);
  const ids = kept.map((row) => row.id);
  const [sent, latest] = await Promise.all([
    latestFacts(orgId, posEbarimtSubmissions.arapDocumentId, ids, true),
    latestFacts(orgId, posEbarimtSubmissions.arapDocumentId, ids, false),
  ]);
  const result: EbarimtDocumentRow[] = kept.map((row) => {
    // Илгээгдсэн → ТЕГ-д очсон receipt; бусад → илгээх гэж буй receipt, бэлтгэгдээгүй
    // бол нэхэмжлэхийн MNT дүн (`baseTotalAmount` — валютын нэхэмжлэхэд ч MNT).
    const isSent = row.ebarimtStatus === "sent";
    const receipt = (isSent ? sent.get(row.id) : latest.get(row.id))?.receipt ?? null;
    return {
      key: `arap:${row.id}`,
      source: "arap",
      id: row.id,
      documentNo: row.documentNo,
      date: row.date,
      counterpartyName: row.counterparty?.name ?? null,
      customerTin: receipt?.customerTin ?? null,
      partiallyReturned: false,
      ebarimtType: row.ebarimtType ?? receipt?.type ?? null,
      status: row.ebarimtStatus ?? "",
      ebarimtId: row.ebarimtId,
      ebarimtDate: row.ebarimtDate,
      total: receipt ? receipt.total : num(row.baseTotalAmount),
      vat: receipt ? receipt.vat : 0,
      cityTax: receipt ? receipt.cityTax : 0,
      lastError: isSent ? null : latest.get(row.id)?.lastError ?? null,
    };
  });
  return { rows: result, truncated };
}

/**
 * Огнооны мужид eBarimt төлөвтэй баримтууд — огноо буурахаар. `sources` нь
 * дуудагчийн эрхээр шүүгдсэн эх (POS / АР уншилтын эрхгүй бол тэр эх орохгүй).
 */
export async function loadEbarimtDocuments(
  orgId: string,
  range: { from: string; to: string },
  sources: EbarimtDocumentSource[]
): Promise<{ rows: EbarimtDocumentRow[]; truncated: boolean }> {
  const [pos, arap] = await Promise.all([
    sources.includes("pos") ? loadPosRows(orgId, range.from, range.to) : { rows: [], truncated: false },
    sources.includes("arap") ? loadArapRows(orgId, range.from, range.to) : { rows: [], truncated: false },
  ]);
  const rows = [...pos.rows, ...arap.rows].sort(
    (a, b) => b.date.localeCompare(a.date) || b.documentNo.localeCompare(a.documentNo)
  );
  return { rows, truncated: pos.truncated || arap.truncated };
}
