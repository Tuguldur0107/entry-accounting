// НӨАТ-ийн дансны тохиргооны loader — server-дотоод хэрэглээ.
// ЗОРИУД "use server" файлд БИШ: userId параметртэй тул client-ээс шууд
// дуудагдах ёсгүй (server action болговол дурын userId-аар дуудагдана).

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { vatSettings } from "@/lib/db/schema";

export type VatSetting = typeof vatSettings.$inferSelect;

/**
 * НӨАТ-ийн дансны тохиргоо — байхгүй бол default-аар (31410000/13620000,
 * 10%) үүсгэнэ. costing_account_settings-тэй ижил ratified-seed хэв маяг:
 * default нь НЭГ удаа ил тохиргоо болж хадгалагдана.
 */
export async function loadVatSettings(userId: string): Promise<VatSetting> {
  const existing = await db.query.vatSettings.findFirst({
    where: eq(vatSettings.userId, userId),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(vatSettings)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const row = await db.query.vatSettings.findFirst({
    where: eq(vatSettings.userId, userId),
  });
  if (!row) throw new Error("НӨАТ-ийн тохиргоо үүсгэж чадсангүй");
  return row;
}
