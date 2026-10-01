// АР нэхэмжлэх → eBarimt оролт — DB давхарга ("use server" БИШ; queue.ts дууддаг).
// Цэвэр дүрэм: arap-receipt.ts. docs/pos/05-ebarimt-invoice-plan.md Шат 1–2.

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { arApDocuments, counterparties, inventoryCategories, type PosSettings } from "@/lib/db/schema";
import { toItemVatMode } from "@/lib/inventory/load-data";
import { baseKindOf, effectiveTin } from "@/lib/arap/counterparty-kind";
import { loadEntityKinds } from "@/lib/arap/entity-kinds";
import { loadVatSettings } from "@/lib/vat/settings";

import { EBARIMT_ERRORS } from "./constants";
import { arapInvoiceToEbarimtInput } from "./arap-receipt";
import { categoryClassificationMap } from "./readiness";
import { EbarimtError } from "./receipt";
import type { EbarimtSaleInput } from "./types";

/** Шидэнэ (`[EBARIMT_*]`) — payload зохиогдохгүй; queue нь failed болгож шалтгааныг ил харуулна. */
export async function loadArapInvoiceForEbarimt(
  orgId: string,
  documentId: string,
  settingsRow: PosSettings
): Promise<EbarimtSaleInput> {
  const doc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.id, documentId), eq(arApDocuments.organizationId, orgId)),
    with: {
      lines: {
        with: {
          item: {
            columns: {
              name: true,
              unit: true,
              barcode: true,
              barcodeType: true,
              vatMode: true,
              categoryCode: true,
              ebarimtClassificationCode: true,
              ebarimtTaxProductCode: true,
            },
          },
        },
        orderBy: (line, { asc }) => [asc(line.sortOrder)],
      },
    },
  });
  if (!doc) throw new EbarimtError(EBARIMT_ERRORS.notSent, "Нэхэмжлэх олдсонгүй");
  if (doc.status === "draft" || doc.status === "reversed")
    throw new EbarimtError(EBARIMT_ERRORS.notSent, `${doc.documentNo}: батлагдаагүй / буцаагдсан нэхэмжлэх илгээгдэхгүй`);

  const counterparty = await db.query.counterparties.findFirst({
    where: and(eq(counterparties.id, doc.counterpartyId), eq(counterparties.organizationId, orgId)),
    columns: { name: true, tin: true, registerNo: true, entityKind: true },
  });
  if (!counterparty) throw new EbarimtError(EBARIMT_ERRORS.notSent, "Харилцагч олдсонгүй");
  const [kinds, vat] = await Promise.all([loadEntityKinds(orgId), loadVatSettings(orgId)]);

  const hasCategory = doc.lines.some((line) => !!line.item?.categoryCode);
  const categories = hasCategory
    ? await db.query.inventoryCategories.findMany({
        where: eq(inventoryCategories.organizationId, orgId),
        columns: { id: true, code: true, name: true, parentId: true, ebarimtClassificationCode: true },
      })
    : [];
  const categoryClassification = categoryClassificationMap(categories);

  return arapInvoiceToEbarimtInput(
    {
      id: doc.id,
      documentNo: doc.documentNo,
      documentType: doc.documentType,
      currency: doc.currency,
      description: doc.description,
      customer: {
        name: counterparty.name,
        baseKind: baseKindOf(counterparty.entityKind, kinds),
        tin: effectiveTin(counterparty.tin, counterparty.registerNo),
      },
      lines: doc.lines.map((line) => ({
        accountNumber: line.accountNumber,
        description: line.description ?? "",
        amount: Number(line.amount),
        quantity: line.quantity === null ? null : Number(line.quantity),
        item: line.item
          ? {
              name: line.item.name,
              unit: line.item.unit,
              barcode: line.item.barcode,
              barcodeType: line.item.barcodeType,
              vatMode: toItemVatMode(line.item.vatMode),
              classificationCode:
                line.item.ebarimtClassificationCode?.trim() ||
                (line.item.categoryCode ? categoryClassification.get(line.item.categoryCode) ?? null : null),
              taxProductCode: line.item.ebarimtTaxProductCode ?? null,
            }
          : null,
      })),
    },
    {
      isVatPayer: vat.isVatPayer,
      outputVatAccount: vat.outputVatAccountNumber ?? null,
      paymentCode: settingsRow.ebarimtArapPaymentCode,
      bankAccountNo: settingsRow.ebarimtArapBankAccountNo,
      iBan: settingsRow.ebarimtArapIban || null,
      defaultClassificationCode: settingsRow.ebarimtArapClassificationCode,
      accountClassificationCodes: settingsRow.ebarimtArapAccountCodes ?? {},
    }
  );
}
