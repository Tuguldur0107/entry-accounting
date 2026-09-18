// Сегментийн утгын АВТОМАТ бүрдүүлэлт — DB давхарга.
//
// Хоёр эх сурвалж:
//   ① Компани (S1/S6) — `organizations` бүртгэлээс автоматаар (эзэмшигчийн
//      бүх байгууллага). Хуудас нээх бүрд дуудагдана — хэрэглэгч юу ч
//      дарахгүйгээр шинэ компани S1/S6-д ГАРЧ ИРНЭ.
//   ② Бусад сегмент (S2, S4, S5, S7, S8, S9, S10) — SEGMENT_DEFAULT_VALUES
//      жишиг лавлах; хэрэглэгч "Стандарт утга татах" товчоор дуудна.
//
// ЭНЭ МОДУЛЬ "use server" БИШ — action, script, хуудас гурвуул шууд дуудна
// (rate-store.ts-тэй ижил хэв маяг).

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { memberships, organizations, segmentValues } from "@/lib/db/schema";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import {
  COMPANY_SEGMENT_IDS,
  defaultValuesForSegment,
  isCompanySegment,
} from "@/lib/constants/segment-defaults";
import {
  planCompanySegmentValues,
  type CompanyRef,
} from "@/lib/gl/company-segments";

export interface SegmentSyncResult {
  added: number;
  updated: number;
}

const COMPANY_SEGMENTS = [...COMPANY_SEGMENT_IDS];
const COMPANY_CODE_LENGTH =
  SEGMENT_DEFS.find((def) => def.id === 1)?.length ?? 3;

/**
 * Тухайн байгууллагын "группын компаниуд" — эзэмшигч (owner) нь нэг байх
 * бүх байгууллага, үүссэн дарааллаар. Эзэмшигч олдохгүй бол (хуучин дата)
 * зөвхөн өөрөө.
 */
export async function loadGroupCompanies(orgId: string): Promise<CompanyRef[]> {
  const owner = await db.query.memberships.findFirst({
    where: and(eq(memberships.organizationId, orgId), eq(memberships.role, "owner")),
    orderBy: [asc(memberships.createdAt)],
    columns: { userId: true },
  });

  if (!owner) {
    const self = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { id: true, name: true },
    });
    return self ? [{ organizationId: self.id, name: self.name }] : [];
  }

  const rows = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(and(eq(memberships.userId, owner.userId), eq(memberships.role, "owner")))
    .orderBy(asc(organizations.createdAt));

  return rows.map((row) => ({ organizationId: row.id, name: row.name }));
}

/**
 * S1/S6-ыг компаниудын бүртгэлтэй тэнцүүлнэ (идемпотент).
 * Юу ч өөрчлөгдөөгүй бол DB-д бичихгүй → хуудас нээх бүрд дуудахад аюулгүй.
 */
export async function syncCompanySegmentValues(
  orgId: string,
  actorUserId: string
): Promise<SegmentSyncResult> {
  const companies = await loadGroupCompanies(orgId);
  if (companies.length === 0) return { added: 0, updated: 0 };

  const existing = await db.query.segmentValues.findMany({
    where: and(
      eq(segmentValues.organizationId, orgId),
      inArray(segmentValues.segmentId, COMPANY_SEGMENTS)
    ),
    columns: {
      id: true,
      segmentId: true,
      code: true,
      name: true,
      linkedOrganizationId: true,
    },
  });

  const plan = planCompanySegmentValues({
    companies,
    existing,
    segmentIds: COMPANY_SEGMENTS,
    codeLength: COMPANY_CODE_LENGTH,
  });
  if (plan.create.length === 0 && plan.update.length === 0)
    return { added: 0, updated: 0 };

  if (plan.create.length > 0)
    await db
      .insert(segmentValues)
      .values(
        plan.create.map((row) => ({
          userId: actorUserId,
          organizationId: orgId,
          segmentId: row.segmentId,
          code: row.code,
          name: row.name,
          linkedOrganizationId: row.linkedOrganizationId,
          modules: (
            SEGMENT_DEFS.find((def) => def.id === row.segmentId)?.defaultModules ?? []
          ).join(","),
        }))
      )
      // Зэрэг хоёр хүсэлт (хуудас + action) орвол давхардуулахгүй.
      .onConflictDoNothing();

  for (const row of plan.update)
    await db
      .update(segmentValues)
      .set({ name: row.name, linkedOrganizationId: row.linkedOrganizationId })
      .where(
        and(eq(segmentValues.id, row.id), eq(segmentValues.organizationId, orgId))
      );

  return { added: plan.create.length, updated: plan.update.length };
}

/**
 * Эзэмшигчийн БҮХ байгууллагад S1/S6-ыг шинэчилнэ — компани нэмэх/нэр солих
 * үед бусад компанийн жагсаалт ч дагаж шинэчлэгдэнэ.
 */
export async function syncCompanySegmentValuesForGroup(
  orgId: string,
  actorUserId: string
): Promise<SegmentSyncResult> {
  const companies = await loadGroupCompanies(orgId);
  const total: SegmentSyncResult = { added: 0, updated: 0 };
  for (const company of companies) {
    const result = await syncCompanySegmentValues(company.organizationId, actorUserId);
    total.added += result.added;
    total.updated += result.updated;
  }
  return total;
}

/**
 * Нэг сегментийн стандарт утгуудыг нэмнэ — байгаа КОДЫГ ХӨНДӨХГҮЙ
 * (хэрэглэгчийн нэр/тохиргоо дарагдахгүй). S1/S6 бол компанийн sync.
 */
export async function syncSegmentDefaultValues(
  orgId: string,
  actorUserId: string,
  segmentId: number
): Promise<SegmentSyncResult> {
  if (isCompanySegment(segmentId))
    return syncCompanySegmentValues(orgId, actorUserId);

  const defaults = defaultValuesForSegment(segmentId);
  if (defaults.length === 0) return { added: 0, updated: 0 };

  const existing = await db.query.segmentValues.findMany({
    where: and(
      eq(segmentValues.organizationId, orgId),
      eq(segmentValues.segmentId, segmentId)
    ),
    columns: { code: true },
  });
  const existingCodes = new Set(existing.map((row) => row.code));
  const toAdd = defaults.filter((value) => !existingCodes.has(value.code));
  if (toAdd.length === 0) return { added: 0, updated: 0 };

  await db
    .insert(segmentValues)
    .values(
      toAdd.map((value) => ({
        userId: actorUserId,
        organizationId: orgId,
        segmentId,
        code: value.code,
        name: value.name,
        modules: value.modules.join(","),
      }))
    )
    .onConflictDoNothing();

  return { added: toAdd.length, updated: 0 };
}

/** Идэвхтэй бүх сегментийн стандарт утгыг нэг дор татна (S3-аас бусад). */
export async function syncAllSegmentDefaultValues(
  orgId: string,
  actorUserId: string,
  segmentIds: number[]
): Promise<SegmentSyncResult> {
  const total: SegmentSyncResult = { added: 0, updated: 0 };
  for (const segmentId of segmentIds) {
    if (segmentId === 3) continue;
    const result = await syncSegmentDefaultValues(orgId, actorUserId, segmentId);
    total.added += result.added;
    total.updated += result.updated;
  }
  return total;
}
