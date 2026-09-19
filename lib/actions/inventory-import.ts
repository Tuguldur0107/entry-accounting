"use server";

// Excel-ээс БАРААНЫ бүртгэл оруулах — код таарвал байгаа барааг шинэчилнэ,
// байхгүй бол шинээр бүртгэнэ (round-trip, employees импорттой ижил хэв маяг).
//
// Клиент спекээр урьдчилан шалгасан ч энд ДАХИН шалгана: баркодын
// давхардал, бүлэг идэвхтэй эсэх, үнийн харьцаа. Мөр тус бүр бие даан
// амжилтлана/унана — нэг мөрийн алдаа бусдыг унагахгүй. Үнэ өөрчлөгдсөн
// бүрд item_price_history-д мөр бичигдэнэ (docs/pos §3.2).

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireModuleAction } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  inventoryCategories,
  inventoryItems,
  itemPriceHistory,
} from "@/lib/db/schema";
import type { InventoryItemImport } from "@/lib/excel/specs";

export type InventoryItemsImportResult = {
  created: number;
  updated: number;
  failures: { code: string; error: string }[];
};

const VAT_MODES = new Set(["standard", "exempt", "zero"]);

function todayUlaanbaatar() {
  return new Date()
    .toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" })
    .slice(0, 10);
}

function priceOrNull(value: number | null | undefined, label: string): string | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`${label} 0-ээс багагүй тоо байна`);
  return String(parsed);
}

export async function importInventoryItems(
  rows: InventoryItemImport[]
): Promise<InventoryItemsImportResult> {
  const { orgId, userId } = await requireModuleAction("inv", "write");
  if (rows.length === 0) return { created: 0, updated: 0, failures: [] };
  if (rows.length > 1000) throw new Error("Нэг удаад дээд тал нь 1000 мөр");

  const categories = await db.query.inventoryCategories.findMany({
    where: and(
      eq(inventoryCategories.organizationId, orgId),
      eq(inventoryCategories.isActive, true)
    ),
    columns: { code: true },
  });
  const activeCategories = new Set(categories.map((category) => category.code));

  let created = 0;
  let updated = 0;
  const failures: { code: string; error: string }[] = [];

  for (const row of rows) {
    const code = row.code.trim();
    try {
      if (!code) throw new Error("Код хоосон байна");
      const name = row.name.trim();
      if (!name) throw new Error("Нэр хоосон байна");
      const unit = row.unit.trim() || "ш";
      const salesPrice = priceOrNull(row.salesPrice, "Борлуулах үнэ");
      const minSalesPrice = priceOrNull(row.minSalesPrice, "Доод үнэ");
      if (
        salesPrice != null &&
        minSalesPrice != null &&
        Number(minSalesPrice) > Number(salesPrice)
      )
        throw new Error("Доод үнэ борлуулах үнээс их байж болохгүй");
      const vatMode = row.vatMode ?? "standard";
      if (!VAT_MODES.has(vatMode))
        throw new Error("НӨАТ-ийн горим standard / exempt / zero байна");
      const categoryCode = row.categoryCode?.trim() || null;
      if (categoryCode && !activeCategories.has(categoryCode))
        throw new Error(`"${categoryCode}" бүлэг идэвхтэй жагсаалтад алга`);
      const barcode = row.barcode?.trim() || null;

      const existing = await db.query.inventoryItems.findFirst({
        where: and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.code, code)),
        columns: { id: true, salesPrice: true },
      });

      if (barcode) {
        const conditions = [
          eq(inventoryItems.organizationId, orgId),
          eq(inventoryItems.barcode, barcode),
        ];
        if (existing) conditions.push(ne(inventoryItems.id, existing.id));
        const duplicate = await db.query.inventoryItems.findFirst({
          where: and(...conditions),
          columns: { code: true },
        });
        if (duplicate)
          throw new Error(
            `"${barcode}" баркод өөр бараанд (${duplicate.code}) бүртгэгдсэн байна`
          );
      }

      await db.transaction(async (tx) => {
        let itemId: string;
        let previousPrice: string | null = null;
        if (existing) {
          itemId = existing.id;
          previousPrice = existing.salesPrice;
          await tx
            .update(inventoryItems)
            .set({
              name,
              unit,
              salesPrice,
              minSalesPrice,
              barcode,
              vatMode,
              categoryCode,
              isActive: row.isActive,
            })
            .where(
              and(eq(inventoryItems.id, existing.id), eq(inventoryItems.organizationId, orgId))
            );
        } else {
          const [inserted] = await tx
            .insert(inventoryItems)
            .values({
              userId,
              organizationId: orgId,
              code,
              name,
              unit,
              salesPrice,
              minSalesPrice,
              barcode,
              vatMode,
              categoryCode,
              isActive: row.isActive,
            })
            .returning({ id: inventoryItems.id });
          itemId = inserted.id;
        }

        const previous = previousPrice == null ? null : Number(previousPrice);
        const next = salesPrice == null ? null : Number(salesPrice);
        // Шинэ бараа үнэгүй бол түүх бичихгүй; өөрчлөлт л мөр болно.
        if (previous !== next)
          await tx.insert(itemPriceHistory).values({
            organizationId: orgId,
            itemId,
            salesPrice,
            effectiveFrom: todayUlaanbaatar(),
            createdBy: userId,
          });
      });

      if (existing) updated += 1;
      else created += 1;
    } catch (caught) {
      failures.push({
        code: code || "(хоосон)",
        error: caught instanceof Error ? caught.message : "Тодорхойгүй алдаа",
      });
    }
  }

  if (created > 0 || updated > 0) {
    for (const path of ["/inventory", "/inventory/items", "/inventory/movements", "/costing"])
      revalidatePath(path);
  }
  return { created, updated, failures };
}
