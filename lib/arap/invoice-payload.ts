// Нэхэмжлэхийн PDF/public хуудасны НЭГДСЭН өгөгдөл — хаанаас ч (auth route,
// public token, и-мэйл хавсралт) дуудсан ижил бүтэц буцаана. Ингэснээр
// хэвлэсэн, татсан, илгээсэн нэхэмжлэх хоорондоо зөрөхгүй.

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocuments,
  companySettings,
  inventoryItems,
} from "@/lib/db/schema";

export interface InvoicePayload {
  documentNo: string;
  date: string;
  dueDate: string;
  currency: string;
  description: string;
  totalAmount: number;
  paidAmount: number;
  status: string;
  counterparty: {
    name: string;
    registerNo: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  lines: {
    description: string;
    itemName: string | null;
    quantity: number | null;
    amount: number;
  }[];
  company: {
    name: string;
    registerNo: string | null;
    vatPayerNo: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    bankAccounts: { bankName: string; accountNo: string; accountName: string }[];
    logo: string | null;
    stamp: string | null;
    signatures: { name: string; title: string; image: string }[];
    autoStamp: boolean;
  };
}

/**
 * orgId + documentId-аар нэхэмжлэхийн бүрэн payload. Зөвхөн ar_invoice.
 * Байхгүй/өөр байгууллагынх бол null.
 */
export async function loadInvoicePayload(
  orgId: string,
  documentId: string
): Promise<InvoicePayload | null> {
  const [document, company] = await Promise.all([
    db.query.arApDocuments.findFirst({
      where: and(
        eq(arApDocuments.id, documentId),
        eq(arApDocuments.organizationId, orgId)
      ),
      with: {
        counterparty: true,
        lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] },
      },
    }),
    db.query.companySettings.findFirst({
      where: eq(companySettings.organizationId, orgId),
    }),
  ]);
  if (!document || document.documentType !== "ar_invoice") return null;

  // Барааны нэрс — мөрөнд itemId байвал
  const itemIds = [
    ...new Set(
      document.lines.map((line) => line.itemId).filter((id): id is string => !!id)
    ),
  ];
  const items = itemIds.length
    ? await db.query.inventoryItems.findMany({
        where: eq(inventoryItems.organizationId, orgId),
      })
    : [];
  const itemNameById = new Map(items.map((item) => [item.id, item.name]));

  return {
    documentNo: document.documentNo,
    date: document.date,
    dueDate: document.dueDate,
    currency: document.currency,
    description: document.description,
    totalAmount: Number(document.totalAmount),
    paidAmount: Number(document.paidAmount),
    status: document.status,
    counterparty: {
      name: document.counterparty.name,
      registerNo: document.counterparty.registerNo,
      email: document.counterparty.email,
      phone: document.counterparty.phone,
      address: document.counterparty.address,
    },
    lines: document.lines.map((line) => ({
      description: line.description,
      itemName: line.itemId ? (itemNameById.get(line.itemId) ?? null) : null,
      quantity: line.quantity != null ? Number(line.quantity) : null,
      amount: Number(line.amount),
    })),
    company: {
      name: company?.name ?? "",
      registerNo: company?.registerNo ?? null,
      vatPayerNo: company?.vatPayerNo ?? null,
      address: company?.address ?? null,
      phone: company?.phone ?? null,
      email: company?.email ?? null,
      bankAccounts: company?.bankAccounts ?? [],
      logo: company?.logo ?? null,
      stamp: company?.stamp ?? null,
      signatures: company?.signatures ?? [],
      autoStamp: company?.autoStamp ?? true,
    },
  };
}
