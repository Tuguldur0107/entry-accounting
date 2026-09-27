// eBarimt-д илгээсэн баримтуудын НЭГДСЭН жагсаалт — DB давхарга ("use server" БИШ;
// `/tax/ebarimt` хуудас дууддаг). Цэвэр төрөл/нийлбэр: list-types.ts.
//
// Мөр = eBarimt төлөвтэй БАРИМТ (POS борлуулалт/буцаалт, АР нэхэмжлэх) — илгээлтийн
// оролдлого бүр биш. Дүн: POS-д борлуулалтын баганаас, АР-д ИЛГЭЭСЭН payload-оос
// (ТЕГ-д очсон НӨАТ-ыг яг тэр хэвээр нь харуулна — дахин бодохгүй).

import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { arApDocuments, posEbarimtSubmissions, posSales } from "@/lib/db/schema";

import { signedAmount, type EbarimtDocumentRow, type EbarimtDocumentSource } from "./list-types";

export * from "./list-types";

/** Эх бүрийн дээд хязгаар — сард үүнээс их бол `truncated` (огнооны мужаа нарийсгана). */
export const EBARIMT_LIST_LIMIT = 5000;

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Сүүлийн илгээлтийн алдаа + АР-ын илгээсэн receipt (`payload.request`)-ийн дүн. */
async function latestSubmissions(
  orgId: string,
  column: typeof posEbarimtSubmissions.saleId | typeof posEbarimtSubmissions.arapDocumentId,
  ids: string[]
) {
  const latest = new Map<string, { lastError: string | null; payload: Record<string, unknown> | null }>();
  if (ids.length === 0) return latest;
  const rows = await db
    .select({
      targetId: column,
      lastError: posEbarimtSubmissions.lastError,
      payload: posEbarimtSubmissions.payload,
    })
    .from(posEbarimtSubmissions)
    .where(and(eq(posEbarimtSubmissions.organizationId, orgId), inArray(column, ids)))
    .orderBy(desc(posEbarimtSubmissions.createdAt));
  for (const row of rows) {
    if (!row.targetId || latest.has(row.targetId)) continue;
    latest.set(row.targetId, { lastError: row.lastError, payload: row.payload ?? null });
  }
  return latest;
}

async function loadPosRows(orgId: string, from: string, to: string) {
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
      isReturn: true,
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
  const errors = await latestSubmissions(
    orgId,
    posEbarimtSubmissions.saleId,
    kept.filter((row) => row.ebarimtStatus !== "sent").map((row) => row.id)
  );
  const result: EbarimtDocumentRow[] = kept.map((row) => ({
    key: `pos:${row.id}`,
    source: "pos",
    id: row.id,
    documentNo: row.documentNo,
    date: row.date,
    counterpartyName: row.counterparty?.name ?? null,
    customerTin: row.ebarimtCustomerTin,
    isReturn: row.isReturn,
    ebarimtType: row.ebarimtType,
    status: row.ebarimtStatus ?? "",
    ebarimtId: row.ebarimtId,
    ebarimtDate: row.ebarimtDate,
    total: signedAmount(row.isReturn, num(row.total)),
    vat: signedAmount(row.isReturn, num(row.vatAmount)),
    cityTax: signedAmount(row.isReturn, num(row.cityTaxAmount)),
    lastError: errors.get(row.id)?.lastError ?? null,
  }));
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
      totalAmount: true,
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
  const submissions = await latestSubmissions(
    orgId,
    posEbarimtSubmissions.arapDocumentId,
    kept.map((row) => row.id)
  );
  const result: EbarimtDocumentRow[] = kept.map((row) => {
    const submission = submissions.get(row.id);
    // queue.ts: payload = { request } — PosAPI-д очсон (очих) receipt.
    const payload = (submission?.payload?.request ?? null) as Record<string, unknown> | null;
    return {
      key: `arap:${row.id}`,
      source: "arap",
      id: row.id,
      documentNo: row.documentNo,
      date: row.date,
      counterpartyName: row.counterparty?.name ?? null,
      customerTin: typeof payload?.customerTin === "string" ? payload.customerTin : null,
      isReturn: false,
      ebarimtType: row.ebarimtType ?? (typeof payload?.type === "string" ? payload.type : null),
      status: row.ebarimtStatus ?? "",
      ebarimtId: row.ebarimtId,
      ebarimtDate: row.ebarimtDate,
      total: payload ? num(payload.totalAmount) : num(row.totalAmount),
      vat: payload ? num(payload.totalVAT) : 0,
      cityTax: payload ? num(payload.totalCityTax) : 0,
      lastError: row.ebarimtStatus === "sent" ? null : submission?.lastError ?? null,
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
