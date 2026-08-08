// НӨАТ-ийн дансны тохиргооны loader — server-дотоод хэрэглээ.
// ЗОРИУД "use server" файлд БИШ: orgId параметртэй тул client-ээс шууд
// дуудагдах ёсгүй (server action болговол дурын orgId-аар дуудагдана).

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { memberships, vatSettings } from "@/lib/db/schema";

export type VatSetting = typeof vatSettings.$inferSelect;

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
 * НӨАТ-ийн дансны тохиргоо — байхгүй бол default-аар (31410000/13620000,
 * 10%) үүсгэнэ. costing_account_settings-тэй ижил ratified-seed хэв маяг:
 * default нь НЭГ удаа ил тохиргоо болж хадгалагдана.
 *
 * Фаз 01: scope нь байгууллага. creatorUserId нь мөр авто-үүсэх үеийн
 * createdBy — өгөөгүй бол org-ийн owner-ийг хайж тавина.
 */
export async function loadVatSettings(
  orgId: string,
  creatorUserId?: string
): Promise<VatSetting> {
  const existing = await db.query.vatSettings.findFirst({
    where: eq(vatSettings.organizationId, orgId),
  });
  if (existing) return existing;

  const userId = creatorUserId ?? (await orgOwnerUserId(orgId));
  const [created] = await db
    .insert(vatSettings)
    .values({ userId, organizationId: orgId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const row = await db.query.vatSettings.findFirst({
    where: eq(vatSettings.organizationId, orgId),
  });
  if (!row) throw new Error("НӨАТ-ийн тохиргоо үүсгэж чадсангүй");
  return row;
}
