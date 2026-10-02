// eTax хавсралт мэдээний ЭХ ӨГӨГДӨЛ (SERVER, DB): Entry-ийн АР/АП баримтаас борлуулалт ба
// худалдан авалтын задаргаа — харилцагчаар нэгтгэсэн эсвэл баримт бүрээр. docs/dev/etax.md §7.
// Дүн ЗОХИОХГҮЙ: НӨАТ = баримтын мөрүүдээс НӨАТ-ын дансны (vat_settings) дүн, нийт = баримтын
// totalAmount (суурь валютаар), цэвэр = нийт − НӨАТ; буцаалт (кредит/дебит нэхэмжлэх) СӨРӨГ.
// Хамрах: батлагдсан (posted/partially_paid/paid) баримт, огноо тайлант үед; reversed ОРОХГҮЙ.

import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { ledgerSign } from "@/lib/arap/document-kind";
import { mainAccountOfCode } from "@/lib/arap/credit-note";
import { db } from "@/lib/db";
import { arApDocumentLines, arApDocuments, counterparties } from "@/lib/db/schema";
import { periodRange } from "@/lib/periods/period";
import { loadVatSettings } from "@/lib/vat/settings";

import type { EtaxSheetSourceRow } from "./api";
import type { EtaxSheetGranularity, EtaxSheetSource } from "./constants";

const SOURCE_TYPES: Record<EtaxSheetSource, readonly string[]> = {
  sales: ["ar_invoice", "ar_credit_note"],
  purchases: ["ap_bill", "ap_debit_note"],
};
const COUNTED_STATUSES = ["posted", "partially_paid", "paid"];

const round2 = (value: number) => Math.round(value * 100) / 100;

export async function loadVatSheetRows(orgId: string, periodCode: string, source: EtaxSheetSource, granularity: EtaxSheetGranularity): Promise<EtaxSheetSourceRow[]> {
  const { startDate, endDate } = periodRange(periodCode);
  const settings = await loadVatSettings(orgId);
  const vatMain = mainAccountOfCode(source === "sales" ? settings.outputVatAccountNumber : settings.inputVatAccountNumber);

  const docs = await db
    .select({
      id: arApDocuments.id,
      documentNo: arApDocuments.documentNo,
      documentType: arApDocuments.documentType,
      date: arApDocuments.date,
      baseTotal: arApDocuments.baseTotalAmount,
      total: arApDocuments.totalAmount,
      ebarimtId: arApDocuments.ebarimtId,
      supplierEbarimtId: arApDocuments.supplierEbarimtId,
      counterpartyId: arApDocuments.counterpartyId,
      counterpartyName: counterparties.name,
      registerNo: counterparties.registerNo,
      tin: counterparties.tin,
    })
    .from(arApDocuments)
    .leftJoin(counterparties, eq(counterparties.id, arApDocuments.counterpartyId))
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        inArray(arApDocuments.documentType, [...SOURCE_TYPES[source]]),
        inArray(arApDocuments.status, COUNTED_STATUSES),
        gte(arApDocuments.date, startDate),
        lte(arApDocuments.date, endDate)
      )
    )
    .orderBy(arApDocuments.date, arApDocuments.documentNo);
  if (docs.length === 0) return [];

  const lines = await db
    .select({ documentId: arApDocumentLines.documentId, accountNumber: arApDocumentLines.accountNumber, amount: arApDocumentLines.amount })
    .from(arApDocumentLines)
    .where(inArray(arApDocumentLines.documentId, docs.map((d) => d.id)));
  const vatByDoc = new Map<string, number>();
  for (const line of lines) {
    if (mainAccountOfCode(line.accountNumber) !== vatMain) continue;
    vatByDoc.set(line.documentId, (vatByDoc.get(line.documentId) ?? 0) + Number(line.amount));
  }

  const perDocument: EtaxSheetSourceRow[] = docs.map((d) => {
    const sign = ledgerSign(d.documentType);
    const total = round2(sign * Number(d.baseTotal ?? d.total ?? 0));
    const vat = round2(sign * (vatByDoc.get(d.id) ?? 0));
    return {
      registerNo: d.registerNo?.trim() || null,
      tin: d.tin?.trim() || null,
      name: d.counterpartyName?.trim() || "Харилцагчгүй",
      documentNo: d.documentNo,
      date: d.date,
      ddtd: (source === "sales" ? d.ebarimtId : d.supplierEbarimtId)?.trim() || null,
      netAmount: round2(total - vat),
      vatAmount: vat,
      totalAmount: total,
      documentCount: 1,
    };
  });
  if (granularity === "document") return perDocument;

  // Харилцагчаар нэгтгэх — түлхүүр: регистр → ТТД → нэр (регистргүй иргэд нэрээр тусдаа).
  const groups = new Map<string, EtaxSheetSourceRow>();
  for (const row of perDocument) {
    const key = row.registerNo ?? row.tin ?? `name:${row.name}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...row, documentNo: null, date: null, ddtd: null });
      continue;
    }
    existing.netAmount = round2(existing.netAmount + row.netAmount);
    existing.vatAmount = round2(existing.vatAmount + row.vatAmount);
    existing.totalAmount = round2(existing.totalAmount + row.totalAmount);
    existing.documentCount += row.documentCount;
    existing.tin = existing.tin ?? row.tin;
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "mn"));
}
