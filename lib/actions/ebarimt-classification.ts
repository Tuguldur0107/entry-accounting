"use server";

// eBarimt ангиллын код (7 орон) — хайлттай сонгогчийн server action.
// Албан жагсаалт server-т үлдэнэ (client bundle-д хэдэн мянган мөр оруулахгүй);
// байгууллагын аль хэдийн хэрэглэж буй кодыг нэмж санал болгоно.

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { requireAnyModuleAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { inventoryCategories, inventoryItems } from "@/lib/db/schema";
import { actionError, type ActionResult } from "@/lib/action-result";
import { EBARIMT_CLASSIFICATIONS } from "@/lib/ebarimt/classification-codes";
import {
  mergeClassificationMatches,
  searchClassifications,
  type ClassificationMatch,
} from "@/lib/ebarimt/classification-search";

export type ClassificationSearchResult = {
  matches: ClassificationMatch[];
  /** Албан жагсаалтын нийт мөр — 0 бол ачаалагдаагүй (UI тайлбар харуулна). */
  datasetSize: number;
};

export async function searchEbarimtClassifications(
  query: string
): Promise<ActionResult<ClassificationSearchResult>> {
  try {
    const { orgId } = await requireAnyModuleAction([
      ["inv", "read"],
      ["pos", "read"],
    ]);
    const q = String(query ?? "").slice(0, 80);
    const [itemRows, categoryRows] = await Promise.all([
      db
        .select({
          code: inventoryItems.ebarimtClassificationCode,
          count: sql<number>`count(*)`,
        })
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.organizationId, orgId),
            isNotNull(inventoryItems.ebarimtClassificationCode)
          )
        )
        .groupBy(inventoryItems.ebarimtClassificationCode),
      db
        .select({
          code: inventoryCategories.ebarimtClassificationCode,
          name: inventoryCategories.name,
        })
        .from(inventoryCategories)
        .where(
          and(
            eq(inventoryCategories.organizationId, orgId),
            isNotNull(inventoryCategories.ebarimtClassificationCode)
          )
        ),
    ]);
    const usage = new Map<string, string[]>();
    for (const row of itemRows)
      if (row.code) usage.set(row.code, [...(usage.get(row.code) ?? []), `${Number(row.count)} бараа`]);
    for (const row of categoryRows)
      if (row.code) usage.set(row.code, [...(usage.get(row.code) ?? []), `«${row.name}» ангилал`]);
    const orgUsed = [...usage.entries()].map(([code, parts]) => ({ code, usage: parts.join(" · ") }));
    return {
      matches: mergeClassificationMatches(searchClassifications(EBARIMT_CLASSIFICATIONS, q), orgUsed, q),
      datasetSize: EBARIMT_CLASSIFICATIONS.length,
    };
  } catch (caught) {
    return actionError("searchEbarimtClassifications", caught, "Ангиллын код хайж чадсангүй");
  }
}
