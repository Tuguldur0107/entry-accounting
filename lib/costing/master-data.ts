// Өртгийн master data-ийн НЭГДСЭН ачаалагч + анхны утгын seed.
//
// Spec (docs/cost) нь кодод хаалттай жагсаалт, хатуу дансны дугаар байхыг
// хориглодог (FR-MD-CC-002, FR-MD-IT-001, JPR-006). Гэхдээ систем нь өнөөдөр
// ажиллаж байгаа тул хоосон тохиргоотой үлдээвэл бичилт зогсоно. Тиймээс
// product owner-ийн шийдвэрийн дагуу (README change-control 0.2) ӨНӨӨГИЙН
// ажиллаж буй дүрмүүдийг ЭХНИЙ УТГА болгон нэг удаа seed хийж, түүнээс хойш
// зөвхөн ТОХИРГООНООС уншина. Кодод байгаа тогтмолууд нь зөвхөн seed-ийн
// эх утга — posting үед хэрэглэгдэхгүй.

import { and, eq, inArray } from "drizzle-orm";

import { STANDARD_ACCOUNTS } from "@/lib/constants/standard-accounts";
import { db } from "@/lib/db";
import {
  chartOfAccounts,
  costComponents,
  costingAccountSettings,
  inventoryIssueTypes,
  memberships,
  type CostComponent,
  type CostingAccountSetting,
  type InventoryIssueType,
} from "@/lib/db/schema";

/**
 * Seed мөр үүсгэхэд userId (notNull, createdBy утгатай) хэрэгтэй. Дуудагч
 * ихэвчлэн өөрийн userId-г дамжуулна; өгөөгүй үед байгууллагын хамгийн
 * эртний owner-ийг ашиглана (cross-batch дуудлагууд orgId-г л мэддэг).
 */
async function seedCreatorUserId(
  orgId: string,
  creatorUserId?: string
): Promise<string> {
  if (creatorUserId) return creatorUserId;
  const row = await db.query.memberships.findFirst({
    where: eq(memberships.organizationId, orgId),
    orderBy: (m, { asc: ascOrder }) => [ascOrder(m.createdAt)],
    columns: { userId: true, role: true },
  });
  if (!row) throw new Error("Байгууллагын гишүүнчлэл олдсонгүй");
  return row.userId;
}

/**
 * Тохиргоонд заагдсан данснуудаас chart-д байхгүйг нь стандарт нэрээр нэмнэ
 * (lib/tax/settings.ts ensureAccountsExist-ийн хэв маяг). Шинэ роль
 * (31000099 «Өглөгийн түр данс») нэмэгдэхэд syncStandardAccounts хүлээлгүй
 * хуучин байгууллагад ч бичилт ажиллана.
 *
 * `resolveUserId` нь ЗАЛХУУ — дутуу данс байхгүй бол owner хайлт хийхгүй
 * (loadCostingAccountSettings нь бичилтийн халуун замд байнга дуудагддаг).
 */
async function ensureAccountsExist(
  orgId: string,
  mains: string[],
  resolveUserId: () => Promise<string>
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
  const userId = await resolveUserId();
  await db
    .insert(chartOfAccounts)
    .values(
      missing.map((number) => ({
        userId,
        organizationId: orgId,
        number,
        name:
          STANDARD_ACCOUNTS.find((account) => account.number === number)?.name ??
          "Өртгийн данс",
      }))
    )
    // Зэрэгцээ бичилт — (organizationId, number) unique тул нөгөөх нь ялж
    // болно; давхардал алдаа болж бичилтийн урсгалыг унагахгүй.
    .onConflictDoNothing();
}

/** Seed-ийн эх утгууд — 0.1 хувилбарт кодод хатуу бичигдсэн байсан дүрмүүд. */
export const RATIFIED_ACCOUNT_SEED = {
  clearingAccountNumber: "14000099",
  adjustmentGainAccountNumber: "51800003",
  adjustmentLossAccountNumber: "87100004",
  nrvExpenseAccountNumber: "87100005",
  nrvReserveAccountNumber: "14900001",
  /** Валютын төлбөрийн (settlement) ханшийн олз — өмнө нь cash.ts-д хатуу байсан. */
  fxGainAccountNumber: "51800001",
  /** Валютын төлбөрийн (settlement) ханшийн гарз. */
  fxLossAccountNumber: "87000003",
  /**
   * Өглөгийн түр данс — PO-той АП нэхэмжлэх бүр Dr, PO хаалтад Cr
   * (docs/procurement §3.1). Бараа материалын түр данстай PO объектоор
   * тэгширнэ.
   */
  apClearingAccountNumber: "31000099",
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
  orgId: string,
  creatorUserId?: string
): Promise<CostingAccountSetting> {
  const resolveUserId = () => seedCreatorUserId(orgId, creatorUserId);
  /** Ролийн дансууд chart-д байгаа эсэхийг баталгаажуулаад мөрийг буцаана. */
  const withAccounts = async (row: CostingAccountSetting) => {
    await ensureAccountsExist(
      orgId,
      [
        row.clearingAccountNumber,
        row.apClearingAccountNumber,
        row.fxGainAccountNumber,
        row.fxLossAccountNumber,
      ],
      resolveUserId
    );
    return row;
  };

  const existing = await db.query.costingAccountSettings.findFirst({
    where: eq(costingAccountSettings.organizationId, orgId),
  });
  if (existing) return await withAccounts(existing);

  const userId = await resolveUserId();
  const [created] = await db
    .insert(costingAccountSettings)
    .values({ userId, organizationId: orgId, ...RATIFIED_ACCOUNT_SEED })
    .onConflictDoNothing()
    .returning();
  if (created) return await withAccounts(created);

  // Зэрэгцээ insert — нөгөөх нь ялсан бол уншаад буцаана.
  const row = await db.query.costingAccountSettings.findFirst({
    where: eq(costingAccountSettings.organizationId, orgId),
  });
  if (!row) throw new Error("Өртгийн дансны тохиргоо үүсгэж чадсангүй");
  return await withAccounts(row);
}

/** Зарлагын төрлүүд — хоосон бол анхны "COGS" төрлийг үүсгэнэ. */
export async function loadIssueTypes(
  orgId: string,
  options?: { activeOnly?: boolean; creatorUserId?: string }
): Promise<InventoryIssueType[]> {
  let rows = await db.query.inventoryIssueTypes.findMany({
    where: eq(inventoryIssueTypes.organizationId, orgId),
    orderBy: (type, { asc }) => [asc(type.code)],
  });

  if (rows.length === 0) {
    const userId = await seedCreatorUserId(orgId, options?.creatorUserId);
    await db
      .insert(inventoryIssueTypes)
      .values(
        DEFAULT_ISSUE_TYPES.map((type) => ({
          userId,
          organizationId: orgId,
          createdBy: userId,
          updatedBy: userId,
          ...type,
        }))
      )
      .onConflictDoNothing();
    rows = await db.query.inventoryIssueTypes.findMany({
      where: eq(inventoryIssueTypes.organizationId, orgId),
      orderBy: (type, { asc }) => [asc(type.code)],
    });
  }

  return options?.activeOnly ? rows.filter((row) => row.isActive) : rows;
}

/** Анхны (кодоор "COGS") зарлагын төрөл — төрөл заагаагүй хуучин бичилтэд. */
export async function defaultIssueType(
  orgId: string
): Promise<InventoryIssueType | null> {
  const rows = await loadIssueTypes(orgId, { activeOnly: true });
  return rows.find((row) => row.code === "COGS") ?? rows[0] ?? null;
}

export async function loadCostComponents(
  orgId: string,
  options?: { activeOnly?: boolean }
): Promise<CostComponent[]> {
  const rows = await db.query.costComponents.findMany({
    where: options?.activeOnly
      ? and(
          eq(costComponents.organizationId, orgId),
          eq(costComponents.isActive, true)
        )
      : eq(costComponents.organizationId, orgId),
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
