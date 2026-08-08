// Цалингийн тохиргооны loader — server-дотоод хэрэглээ (userId параметртэй
// тул "use server" файлд БИШ — lib/vat/settings.ts-тэй ижил шалтгаанаар).

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { payrollSettings } from "@/lib/db/schema";

export type PayrollSetting = typeof payrollSettings.$inferSelect;

/**
 * Цалингийн тохиргоо — байхгүй бол schema-гийн default-уудаар (CLAUDE.md §7
 * дансууд, доод цалин 792,000, cap ×10) үүсгэнэ. Ratified-seed хэв маяг.
 */
export async function loadPayrollSettings(
  userId: string
): Promise<PayrollSetting> {
  const existing = await db.query.payrollSettings.findFirst({
    where: eq(payrollSettings.userId, userId),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(payrollSettings)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const row = await db.query.payrollSettings.findFirst({
    where: eq(payrollSettings.userId, userId),
  });
  if (!row) throw new Error("Цалингийн тохиргоо үүсгэж чадсангүй");
  return row;
}
