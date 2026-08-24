// Татварын дансны тохиргоо — НӨАТ-аас бусад татвар бүрийн өглөг + авлагын
// данс. Ratified-seed (vat_settings-тэй ижил хэв маяг): мөр байхгүй бол
// schema-гийн default-уудаар НЭГ удаа ил тохиргоо болгож үүсгэнэ.
//
// Мөн тохиргоонд заагдсан данс байгууллагын дансны жагсаалтад байхгүй бол
// стандарт нэрээр нь нэмдэг (шинэ 3100000X/136X0000 дансууд хуучин орг-д
// syncStandardAccounts хүлээлгүй шууд ажиллана).

import { and, eq, inArray } from "drizzle-orm";

import { STANDARD_ACCOUNTS } from "@/lib/constants/standard-accounts";
import { db } from "@/lib/db";
import { chartOfAccounts, memberships, taxSettings } from "@/lib/db/schema";

export type TaxSetting = typeof taxSettings.$inferSelect;

async function orgOwnerUserId(orgId: string): Promise<string> {
  const owner = await db.query.memberships.findFirst({
    where: and(eq(memberships.organizationId, orgId), eq(memberships.role, "owner")),
    columns: { userId: true },
  });
  if (!owner) throw new Error("Байгууллагын owner гишүүнчлэл олдсонгүй");
  return owner.userId;
}

/** Тохиргоонд заагдсан данснуудаас chart-д байхгүйг нь стандарт нэрээр нэмнэ. */
async function ensureAccountsExist(
  orgId: string,
  userId: string,
  mains: string[]
): Promise<void> {
  const wanted = [...new Set(mains.filter((main) => /^\d{8}$/.test(main)))];
  if (wanted.length === 0) return;
  const existing = await db.query.chartOfAccounts.findMany({
    where: and(
      eq(chartOfAccounts.organizationId, orgId),
      inArray(chartOfAccounts.number, wanted)
    ),
    columns: { number: true },
  });
  const have = new Set(existing.map((row) => row.number));
  const missing = wanted.filter((main) => !have.has(main));
  if (missing.length === 0) return;
  await db.insert(chartOfAccounts).values(
    missing.map((number) => ({
      userId,
      organizationId: orgId,
      number,
      name:
        STANDARD_ACCOUNTS.find((account) => account.number === number)?.name ??
        "Татварын данс",
    }))
  );
}

export async function loadTaxSettings(
  orgId: string,
  creatorUserId?: string
): Promise<TaxSetting> {
  let row = await db.query.taxSettings.findFirst({
    where: eq(taxSettings.organizationId, orgId),
  });
  const userId = creatorUserId ?? (await orgOwnerUserId(orgId));

  if (!row) {
    const [created] = await db
      .insert(taxSettings)
      .values({ userId, organizationId: orgId })
      .onConflictDoNothing()
      .returning();
    row =
      created ??
      (await db.query.taxSettings.findFirst({
        where: eq(taxSettings.organizationId, orgId),
      })) ??
      undefined;
  }
  if (!row) throw new Error("Татварын тохиргоо үүсгэж чадсангүй");

  await ensureAccountsExist(orgId, userId, [
    row.citPayableAccountNumber,
    row.citReceivableAccountNumber,
    row.whtPayableAccountNumber,
    row.whtReceivableAccountNumber,
    row.propertyPayableAccountNumber,
    row.propertyReceivableAccountNumber,
    row.customsPayableAccountNumber,
    row.customsReceivableAccountNumber,
    row.pitReceivableAccountNumber,
    row.siReceivableAccountNumber,
  ]);

  return row;
}
