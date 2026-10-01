// eBarimt-д илгээсэн баримтуудын НЭГДСЭН жагсаалт — DB давхарга ("use server" БИШ;
// list-page.ts дууддаг). Цэвэр төрөл/нийлбэр: list-types.ts.
//
// Мөр = eBarimt төлөвтэй БАРИМТ (POS борлуулалт, АР нэхэмжлэх) — илгээлтийн
// оролдлого бүр биш. ТЕГ-д бүртгэлтэй дүн нь баримт дээрээ (`ebarimtTotal/Vat/
// CityTax` — queue.ts markSent СҮҮЛИЙН амжилттай receipt-ээс бичнэ; хэсэгчилсэн
// буцаалтын засварын дараа ҮЛДСЭН дүн) — илгээлтийн түүхээс нөхөж бодохгүй.
// Буцаалтын засвар дуусаагүй бол `posSales.ebarimtCorrection` → «Анхаарах».

import { and, desc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { arApDocuments, posEbarimtSubmissions, posSales } from "@/lib/db/schema";

import {
  isReportedStatus,
  posEbarimtCorrection,
  type EbarimtDocumentRow,
  type EbarimtDocumentSource,
} from "./list-types";

export * from "./list-types";

/** Эх бүрийн дээд хязгаар — сард үүнээс их бол `truncated` (огнооны мужаа нарийсгана). */
export const EBARIMT_LIST_LIMIT = 5000;

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

type TargetColumn = typeof posEbarimtSubmissions.saleId | typeof posEbarimtSubmissions.arapDocumentId;

const request = (field: "totalAmount" | "totalVAT" | "totalCityTax" | "customerTin") =>
  sql<string | null>`${posEbarimtSubmissions.payload}->'request'->>${field}::text`;

/**
 * Баримт бүрийн СҮҮЛИЙН илгээлт — зөвхөн анхаарах мөрүүдэд (алдааны шалтгаан,
 * илгээх гэж буй receipt-ийн НӨАТ). DISTINCT ON + id-аар тогтвортой дараалал
 * (queue.ts editIndexOf-той ижил), payload-оос зөвхөн хэрэгтэй талбар.
 */
async function latestSubmissions(orgId: string, column: TargetColumn, ids: string[]) {
  const latest = new Map<
    string,
    {
      lastError: string | null;
      total: number | null;
      vat: number | null;
      cityTax: number | null;
      customerTin: string | null;
    }
  >();
  if (ids.length === 0) return latest;
  const rows = await db
    .selectDistinctOn([column], {
      targetId: column,
      lastError: posEbarimtSubmissions.lastError,
      total: request("totalAmount"),
      vat: request("totalVAT"),
      cityTax: request("totalCityTax"),
      customerTin: request("customerTin"),
    })
    .from(posEbarimtSubmissions)
    // Төлөлтийн баримт (kind=payment) нь нэхэмжлэхийн өөрийн илгээлт БИШ — хасна.
    .where(and(eq(posEbarimtSubmissions.organizationId, orgId), inArray(column, ids), ne(posEbarimtSubmissions.kind, "payment")))
    .orderBy(column, desc(posEbarimtSubmissions.createdAt), desc(posEbarimtSubmissions.id));
  for (const row of rows) {
    if (!row.targetId) continue;
    latest.set(row.targetId, {
      lastError: row.lastError,
      total: row.total === null ? null : num(row.total),
      vat: row.vat === null ? null : num(row.vat),
      cityTax: row.cityTax === null ? null : num(row.cityTax),
      customerTin: row.customerTin,
    });
  }
  return latest;
}

/**
 * Борлуулалт бүрийн Entry дахь ҮЛДСЭН дүн = борлуулалт − буцаалтууд, бэлэн мөнгөний
 * тоймлолтгүй (receipt.ts мөрийн нийлбэр — баримтад тоймлолт ордоггүй). ТЕГ-д
 * бүртгэлтэй дүнтэй тулгана (posEbarimtCorrection). POS панель ч үүнийг дуудна.
 */
export async function loadPosRemainingTotals(
  orgId: string,
  sales: { id: string; total: string | number; roundingAmount: string | number }[]
): Promise<Map<string, number>> {
  const remaining = new Map(sales.map((sale) => [sale.id, num(sale.total) - num(sale.roundingAmount)]));
  if (sales.length === 0) return remaining;
  const returns = await db
    .select({
      originalSaleId: posSales.originalSaleId,
      returned: sql<string>`sum(${posSales.total} - ${posSales.roundingAmount})`,
    })
    .from(posSales)
    .where(
      and(
        eq(posSales.organizationId, orgId),
        eq(posSales.isReturn, true),
        inArray(
          posSales.originalSaleId,
          sales.map((sale) => sale.id)
        )
      )
    )
    .groupBy(posSales.originalSaleId);
  for (const row of returns) {
    if (!row.originalSaleId) continue;
    remaining.set(row.originalSaleId, (remaining.get(row.originalSaleId) ?? 0) - num(row.returned));
  }
  return remaining;
}

/** ТЕГ-д бүртгэлтэй (sent / manual / cancelled) бол хадгалсан ТЕГ-ийн дүн байна. */
const hasRegisteredStatus = (status: string) => isReportedStatus(status) || status === "cancelled";

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
      roundingAmount: true,
      vatAmount: true,
      cityTaxAmount: true,
      ebarimtId: true,
      ebarimtStatus: true,
      ebarimtDate: true,
      ebarimtType: true,
      ebarimtCustomerTin: true,
      ebarimtTotal: true,
      ebarimtVat: true,
      ebarimtCityTax: true,
      ebarimtCorrection: true,
    },
    with: { counterparty: { columns: { name: true } } },
    orderBy: [desc(posSales.soldAt)],
    limit: EBARIMT_LIST_LIMIT + 1,
  });
  const truncated = rows.length > EBARIMT_LIST_LIMIT;
  const kept = rows.slice(0, EBARIMT_LIST_LIMIT);

  const remaining = await loadPosRemainingTotals(orgId, kept);
  const corrections = new Map(
    kept.map((row) => [
      row.id,
      posEbarimtCorrection({
        ebarimtStatus: row.ebarimtStatus,
        saleStatus: row.status,
        flag: row.ebarimtCorrection,
        registeredTotal: row.ebarimtTotal === null ? null : num(row.ebarimtTotal),
        remainingTotal: remaining.get(row.id) ?? 0,
      }),
    ])
  );
  const latest = await latestSubmissions(
    orgId,
    posEbarimtSubmissions.saleId,
    kept
      .filter((row) => !hasRegisteredStatus(row.ebarimtStatus ?? "") || corrections.get(row.id) === "pending" || corrections.get(row.id) === "failed")
      .map((row) => row.id)
  );

  const result: EbarimtDocumentRow[] = kept.map((row) => {
    const status = row.ebarimtStatus ?? "";
    const registered = hasRegisteredStatus(status) && row.ebarimtTotal !== null;
    return {
      key: `pos:${row.id}`,
      source: "pos",
      id: row.id,
      documentNo: row.documentNo,
      date: row.date,
      counterpartyName: row.counterparty?.name ?? null,
      customerTin: row.ebarimtCustomerTin,
      partiallyReturned: row.status === "partially_returned",
      correction: corrections.get(row.id) ?? null,
      ebarimtType: row.ebarimtType,
      status,
      ebarimtId: row.ebarimtId,
      ebarimtDate: row.ebarimtDate,
      total: registered ? num(row.ebarimtTotal) : num(row.total),
      vat: registered ? num(row.ebarimtVat) : num(row.vatAmount),
      cityTax: registered ? num(row.ebarimtCityTax) : num(row.cityTaxAmount),
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
      ebarimtCustomerTin: true,
      ebarimtTotal: true,
      ebarimtVat: true,
      ebarimtCityTax: true,
    },
    with: { counterparty: { columns: { name: true } } },
    orderBy: [desc(arApDocuments.date), desc(arApDocuments.createdAt)],
    limit: EBARIMT_LIST_LIMIT + 1,
  });
  const truncated = rows.length > EBARIMT_LIST_LIMIT;
  const kept = rows.slice(0, EBARIMT_LIST_LIMIT);
  // Зөвхөн илгээгдээгүй нэхэмжлэхэд (алдаа + илгээх гэж буй receipt).
  const latest = await latestSubmissions(
    orgId,
    posEbarimtSubmissions.arapDocumentId,
    kept.filter((row) => row.ebarimtStatus !== "sent").map((row) => row.id)
  );
  const result: EbarimtDocumentRow[] = kept.map((row) => {
    const status = row.ebarimtStatus ?? "";
    const registered = status === "sent" && row.ebarimtTotal !== null;
    const pending = latest.get(row.id);
    return {
      key: `arap:${row.id}`,
      source: "arap",
      id: row.id,
      documentNo: row.documentNo,
      date: row.date,
      counterpartyName: row.counterparty?.name ?? null,
      // Илгээгдсэн: ТЕГ-д очсон ТТД (markSent); бусад: илгээх гэж буй receipt-ийнх.
      customerTin: registered ? row.ebarimtCustomerTin : pending?.customerTin ?? null,
      partiallyReturned: false,
      // АР-ын кредит нэхэмжлэл/төлөлт eBarimt-д илгээгдэхгүй (docs/pos/05 Q1/Q5) — засвар байхгүй.
      correction: null,
      ebarimtType: row.ebarimtType,
      status,
      ebarimtId: row.ebarimtId,
      ebarimtDate: row.ebarimtDate,
      // Илгээгдээгүй: илгээх гэж буй receipt (бэлтгэгдсэн бол) эсвэл нэхэмжлэхийн MNT
      // дүн (`baseTotalAmount` — валютын нэхэмжлэхэд ч MNT, баримтын валютаар БИШ).
      total: registered ? num(row.ebarimtTotal) : pending?.total ?? num(row.baseTotalAmount),
      vat: registered ? num(row.ebarimtVat) : pending?.vat ?? 0,
      cityTax: registered ? num(row.ebarimtCityTax) : pending?.cityTax ?? 0,
      lastError: status === "sent" ? null : pending?.lastError ?? null,
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
