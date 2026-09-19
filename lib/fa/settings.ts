// Үндсэн хөрөнгийн тохиргооны loader — server-дотоод хэрэглээ (orgId
// параметртэй тул "use server" файлд БИШ; lib/vat/settings.ts-тэй ижил
// шалтгаанаар).

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { faSettings, memberships } from "@/lib/db/schema";
import { isDepreciationBasis, type DepreciationBasis } from "@/lib/fa/depreciation";

export type FaSetting = typeof faSettings.$inferSelect;

/** Мөр авто-үүсгэхэд createdBy болгох хэрэглэгч — байгууллагын owner. */
async function orgOwnerUserId(orgId: string): Promise<string> {
  const owner = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.organizationId, orgId),
      eq(memberships.role, "owner")
    ),
    columns: { userId: true },
  });
  if (!owner) throw new Error("Байгууллагын owner гишүүнчлэл олдсонгүй");
  return owner.userId;
}

/**
 * ҮХ-ийн тохиргоо — байхгүй бол schema-гийн default-аар (сарын суурь)
 * үүсгэнэ. Ratified-seed хэв маяг.
 */
export async function loadFaSettings(
  orgId: string,
  creatorUserId?: string
): Promise<FaSetting> {
  const existing = await db.query.faSettings.findFirst({
    where: eq(faSettings.organizationId, orgId),
  });
  if (existing) return existing;

  const userId = creatorUserId ?? (await orgOwnerUserId(orgId));
  const [created] = await db
    .insert(faSettings)
    .values({ userId, organizationId: orgId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const row = await db.query.faSettings.findFirst({
    where: eq(faSettings.organizationId, orgId),
  });
  if (!row) throw new Error("Үндсэн хөрөнгийн тохиргоо үүсгэж чадсангүй");
  return row;
}

/** Тохиргооны элэгдлийн суурь — гажиг утга сарын суурь руу унана. */
export function basisOf(settings: FaSetting): DepreciationBasis {
  return isDepreciationBasis(settings.depreciationBasis)
    ? settings.depreciationBasis
    : "monthly";
}

/** Элэгдлийн суурийг солих (Тохиргооны дэлгэцээс). */
export async function saveFaDepreciationBasis(
  orgId: string,
  userId: string,
  basis: DepreciationBasis
): Promise<void> {
  await loadFaSettings(orgId, userId);
  await db
    .update(faSettings)
    .set({ depreciationBasis: basis, updatedAt: new Date() })
    .where(eq(faSettings.organizationId, orgId));
}
