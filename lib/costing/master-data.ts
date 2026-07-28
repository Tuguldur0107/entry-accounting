// Өртгийн master data-ийн НЭГДСЭН ачаалагч + анхны утгын seed.
//
// Spec (docs/cost) нь кодод хаалттай жагсаалт, хатуу дансны дугаар байхыг
// хориглодог (FR-MD-CC-002, FR-MD-IT-001, JPR-006). Гэхдээ систем нь өнөөдөр
// ажиллаж байгаа тул хоосон тохиргоотой үлдээвэл бичилт зогсоно. Тиймээс
// product owner-ийн шийдвэрийн дагуу (README change-control 0.2) ӨНӨӨГИЙН
// ажиллаж буй дүрмүүдийг ЭХНИЙ УТГА болгон нэг удаа seed хийж, түүнээс хойш
// зөвхөн ТОХИРГООНООС уншина. Кодод байгаа тогтмолууд нь зөвхөн seed-ийн
// эх утга — posting үед хэрэглэгдэхгүй.

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  costComponents,
  costingAccountSettings,
  inventoryIssueTypes,
  type CostComponent,
  type CostingAccountSetting,
  type InventoryIssueType,
} from "@/lib/db/schema";

/** Seed-ийн эх утгууд — 0.1 хувилбарт кодод хатуу бичигдсэн байсан дүрмүүд. */
export const RATIFIED_ACCOUNT_SEED = {
  clearingAccountNumber: "14000099",
  adjustmentGainAccountNumber: "51800003",
  adjustmentLossAccountNumber: "87100004",
  nrvExpenseAccountNumber: "87100005",
  nrvReserveAccountNumber: "14900001",
} as const;

/**
 * Анхны зарлагын төрөл — өнөөгийн зан төлөвийг ЯГ хуулбарлана: зарлага бүр
 * тухайн барааны costing_item_settings.cogsAccountNumber рүү дебетлэгддэг.
 * Тиймээс "item_cogs" posting profile — тогтмол данс биш.
 */
const DEFAULT_ISSUE_TYPES = [
  {
    code: "COGS",
    name: "Борлуулалтын өртөг",
    destinationClass: "Борлуулалтын өртөг (COGS)",
    debitAccountSource: "item_cogs" as const,
    debitAccountNumber: null,
  },
];

export async function loadCostingAccountSettings(
  userId: string
): Promise<CostingAccountSetting> {
  const existing = await db.query.costingAccountSettings.findFirst({
    where: eq(costingAccountSettings.userId, userId),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(costingAccountSettings)
    .values({ userId, ...RATIFIED_ACCOUNT_SEED })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Зэрэгцээ insert — нөгөөх нь ялсан бол уншаад буцаана.
  const row = await db.query.costingAccountSettings.findFirst({
    where: eq(costingAccountSettings.userId, userId),
  });
  if (!row) throw new Error("Өртгийн дансны тохиргоо үүсгэж чадсангүй");
  return row;
}

/** Зарлагын төрлүүд — хоосон бол анхны "COGS" төрлийг үүсгэнэ. */
export async function loadIssueTypes(
  userId: string,
  options?: { activeOnly?: boolean }
): Promise<InventoryIssueType[]> {
  let rows = await db.query.inventoryIssueTypes.findMany({
    where: eq(inventoryIssueTypes.userId, userId),
    orderBy: (type, { asc }) => [asc(type.code)],
  });

  if (rows.length === 0) {
    await db
      .insert(inventoryIssueTypes)
      .values(
        DEFAULT_ISSUE_TYPES.map((type) => ({
          userId,
          createdBy: userId,
          updatedBy: userId,
          ...type,
        }))
      )
      .onConflictDoNothing();
    rows = await db.query.inventoryIssueTypes.findMany({
      where: eq(inventoryIssueTypes.userId, userId),
      orderBy: (type, { asc }) => [asc(type.code)],
    });
  }

  return options?.activeOnly ? rows.filter((row) => row.isActive) : rows;
}

/** Анхны (кодоор "COGS") зарлагын төрөл — төрөл заагаагүй хуучин бичилтэд. */
export async function defaultIssueType(
  userId: string
): Promise<InventoryIssueType | null> {
  const rows = await loadIssueTypes(userId, { activeOnly: true });
  return rows.find((row) => row.code === "COGS") ?? rows[0] ?? null;
}

export async function loadCostComponents(
  userId: string,
  options?: { activeOnly?: boolean }
): Promise<CostComponent[]> {
  const rows = await db.query.costComponents.findMany({
    where: options?.activeOnly
      ? and(
          eq(costComponents.userId, userId),
          eq(costComponents.isActive, true)
        )
      : eq(costComponents.userId, userId),
    orderBy: (component, { asc }) => [asc(component.code)],
  });
  return rows;
}

/**
 * Зарлагын төрлийн ДЕБЕТ дансыг шийднэ (FR-MD-IT-002 posting profile).
 * Буцаах утга нь бичих МӨЧИД тогтоогдож cost_entries-д хадгалагдана —
 * хожим master data өөрчлөгдөхөд түүхэн бичилт өөрчлөгдөхгүй (JPR-005).
 */
export function resolveIssueDebitAccount(
  issueType: InventoryIssueType,
  itemCogsAccountNumber: string
): string {
  if (issueType.debitAccountSource === "item_cogs")
    return itemCogsAccountNumber;
  const account = issueType.debitAccountNumber?.trim();
  if (!account)
    throw new Error(
      `"${issueType.name}" зарлагын төрөлд дебет данс тохируулаагүй байна`
    );
  return account;
}
