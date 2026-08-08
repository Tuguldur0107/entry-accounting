// Цалингийн тохиргооны loader — server-дотоод хэрэглээ (orgId параметртэй
// тул "use server" файлд БИШ — lib/vat/settings.ts-тэй ижил шалтгаанаар).

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { memberships, payrollSettings } from "@/lib/db/schema";

export type PayrollSetting = typeof payrollSettings.$inferSelect;

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
 * Цалингийн тохиргоо — байхгүй бол schema-гийн default-уудаар (CLAUDE.md §7
 * дансууд, доод цалин 792,000, cap ×10) үүсгэнэ. Ratified-seed хэв маяг.
 *
 * Фаз 01: scope нь байгууллага. creatorUserId нь мөр авто-үүсэх үеийн
 * createdBy — өгөөгүй бол org-ийн owner-ийг хайж тавина.
 */
export async function loadPayrollSettings(
  orgId: string,
  creatorUserId?: string
): Promise<PayrollSetting> {
  const existing = await db.query.payrollSettings.findFirst({
    where: eq(payrollSettings.organizationId, orgId),
  });
  if (existing) return existing;

  const userId = creatorUserId ?? (await orgOwnerUserId(orgId));
  const [created] = await db
    .insert(payrollSettings)
    .values({ userId, organizationId: orgId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const row = await db.query.payrollSettings.findFirst({
    where: eq(payrollSettings.organizationId, orgId),
  });
  if (!row) throw new Error("Цалингийн тохиргоо үүсгэж чадсангүй");
  return row;
}
