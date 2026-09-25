"use server";

// Фаз 01 — Байгууллагын удирдлага: сонголт, гишүүнчлэл, мэдээлэл.
// Дүрэм: client-ээс orgId parameter зөвхөн ЭНД (switchOrganization) ирдэг ба
// гишүүнчлэлээр ЗААВАЛ баталгаажина — бусад бүх action getActiveOrg()-оос авна.

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, asc, eq, sql } from "drizzle-orm";

import {
  auth,
  createPersonalOrg,
  currentSupportSession,
  getActiveOrg,
  requireRole,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { purgeOrganization } from "@/lib/org/purge";
import {
  auditEvents,
  chartOfAccounts,
  organizationProfile,
  memberships,
  organizations,
  orgInvitations,
  users,
  type MembershipRole,
} from "@/lib/db/schema";
import { DEFAULT_ACCOUNTS } from "@/lib/constants/standard-accounts";
import {
  ensureCashFlowSegmentValues,
  syncCompanySegmentValuesForGroup,
} from "@/lib/gl/segment-sync";
import { actionError, type ActionResult } from "@/lib/action-result";
import { logAuditEvent } from "@/lib/audit";
import { assertCompanyCreatable, assertSeatAvailable } from "@/lib/billing/guards";
import { inheritSubscriptionForNewOrg } from "@/lib/billing/inherit";
import { ORG_INVITATION_TTL_DAYS } from "@/lib/db/schema";
import { roleAtLeast } from "@/lib/permissions";
import { fmtDateTimeUb } from "@/lib/format/datetime";

/**
 * Компанийн бүртгэл өөрчлөгдөхөд S1/S6 сегментийн утга дагаж шинэчлэгдэнэ
 * (шинэ компани → шинэ код, нэр солих → нэр шинэчлэгдэнэ). Сегментийн
 * шинэчлэлт унасан ч байгууллагын үйлдэл ЗОГСОХГҮЙ.
 */
async function refreshCompanySegments(orgId: string, userId: string) {
  try {
    await syncCompanySegmentValuesForGroup(orgId, userId);
  } catch (caught) {
    console.error("refreshCompanySegments:", caught);
  }
}

const ORG_COOKIE = "ea-org";
const ROLES: MembershipRole[] = ["owner", "admin", "accountant", "viewer"];

export type OrgSummary = { id: string; name: string; role: MembershipRole };

/** Удирдлага хуудасны зүүн жагсаалтад — гишүүдийн тоотой. */
export type OrgOverview = OrgSummary & {
  registryNo: string | null;
  memberCount: number;
};

export type OrgMemberView = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
  joinedAt: string;
  /** Модулийн нарийн эрх (memberships.permissions JSON) — null = default. */
  permissions: string | null;
};

export type OrgInvitationView = {
  id: string;
  email: string;
  role: MembershipRole;
  createdAt: string;
  /** Линк хүчингүй болох өдөр (YYYY-MM-DD). */
  expiresAt: string;
  url: string;
};

export type OrgSettingsData = {
  org: { id: string; name: string; registryNo: string | null };
  myRole: MembershipRole;
  members: OrgMemberView[];
  invitations: OrgInvitationView[];
  myOrgs: OrgOverview[];
};

function inviteUrl(token: string) {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000";
  return `${base}/register?invite=${token}`;
}

/** Topbar-ийн сонголт + Байгууллага хуудасны өгөгдөл. */
export async function getOrgSettingsData(): Promise<OrgSettingsData> {
  const { orgId, userId, role } = await getActiveOrg();

  const [org, memberRows, myMemberships, invitationRows, memberCounts] =
    await Promise.all([
      db.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
        columns: { id: true, name: true, registryNo: true },
      }),
      db
        .select({
          membershipId: memberships.id,
          userId: memberships.userId,
          role: memberships.role,
          permissions: memberships.permissions,
          joinedAt: memberships.createdAt,
          name: users.name,
          email: users.email,
        })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(eq(memberships.organizationId, orgId))
        .orderBy(asc(memberships.createdAt)),
      db
        .select({
          id: organizations.id,
          name: organizations.name,
          registryNo: organizations.registryNo,
          role: memberships.role,
        })
        .from(memberships)
        .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
        .where(eq(memberships.userId, userId))
        .orderBy(asc(memberships.createdAt)),
      // Урилга (линктэй!) — ЗӨВХӨН admin+ харна; хугацаа дууссаныг харуулахгүй.
      roleAtLeast(role, "admin")
        ? db.query.orgInvitations.findMany({
            where: and(
              eq(orgInvitations.organizationId, orgId),
              sql`${orgInvitations.acceptedAt} is null`,
              sql`${orgInvitations.expiresAt} > now()`
            ),
            orderBy: [asc(orgInvitations.createdAt)],
          })
        : Promise.resolve([]),
      // Миний байгууллага бүрийн гишүүдийн тоо — зүүн жагсаалтад.
      db
        .select({
          organizationId: memberships.organizationId,
          count: sql<number>`count(*)::int`,
        })
        .from(memberships)
        .where(
          sql`${memberships.organizationId} in (
            select organization_id from memberships where user_id = ${userId}
          )`
        )
        .groupBy(memberships.organizationId),
    ]);
  if (!org) throw new Error("Байгууллага олдсонгүй");

  const countByOrg = new Map(
    memberCounts.map((row) => [row.organizationId, row.count])
  );

  return {
    org,
    myRole: role,
    members: memberRows.map((row) => ({
      membershipId: row.membershipId,
      userId: row.userId,
      name: row.name,
      email: row.email,
      role: row.role as MembershipRole,
      joinedAt: row.joinedAt.toISOString().slice(0, 10),
      permissions: row.permissions,
    })),
    invitations: invitationRows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role as MembershipRole,
      createdAt: row.createdAt.toISOString().slice(0, 10),
      expiresAt: row.expiresAt.toISOString().slice(0, 10),
      url: inviteUrl(row.token),
    })),
    myOrgs: myMemberships.map((row) => ({
      id: row.id,
      name: row.name,
      registryNo: row.registryNo,
      role: row.role as MembershipRole,
      memberCount: countByOrg.get(row.id) ?? 1,
    })),
  };
}

/** Гишүүний профайл — мэдээлэл + энэ байгууллага дахь сүүлийн үйлдлүүд. */
export async function getMemberDetail(membershipId: string): Promise<ActionResult<Awaited<ReturnType<typeof getMemberDetailCore>>>> {
  try {
    return await getMemberDetailCore(membershipId);
  } catch (caught) {
    return actionError("getMemberDetail", caught, "Гишүүний мэдээлэл ачаалагдсангүй");
  }
}

async function getMemberDetailCore(membershipId: string) {
  const { orgId } = await getActiveOrg();
  const [row] = await db
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      role: memberships.role,
      joinedAt: memberships.createdAt,
      name: users.name,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(eq(memberships.id, membershipId), eq(memberships.organizationId, orgId))
    );
  if (!row) throw new Error("Гишүүн олдсонгүй");

  const events = await db.query.auditEvents.findMany({
    where: and(
      eq(auditEvents.organizationId, orgId),
      eq(auditEvents.userId, row.userId)
    ),
    orderBy: [sql`${auditEvents.createdAt} desc`],
    limit: 8,
  });

  return {
    name: row.name,
    email: row.email,
    role: row.role as MembershipRole,
    joinedAt: row.joinedAt.toISOString().slice(0, 10),
    recentEvents: events.map((event) => ({
      id: event.id,
      action: event.action,
      entityType: event.entityType,
      summary: event.summary,
      at: fmtDateTimeUb(event.createdAt) ?? "",
    })),
  };
}

/** Topbar сонголтод — хөнгөн жагсаалт (гишүүдийн join-гүй). */
export async function getMyOrgs(): Promise<{
  activeOrgId: string;
  orgs: OrgSummary[];
}> {
  const { orgId, userId, role } = await getActiveOrg();
  // Дэмжлэгийн сесс идэвхтэй үед сонголт БАЙХГҮЙ: зөвхөн зочилж буй
  // байгууллага харагдана — өөрийн байгууллага руу буцах зам нь топбарын
  // «Дэмжлэгээс гарах» (cookie цэвэрлэгдэж ердийн жагсаалт сэргэнэ).
  const support = await currentSupportSession(userId);
  if (support)
    return {
      activeOrgId: orgId,
      orgs: [{ id: orgId, name: support.orgName, role }],
    };
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
  return {
    activeOrgId: orgId,
    orgs: rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role as MembershipRole,
    })),
  };
}

/** Байгууллага солих — гишүүнчлэлээ баталгаажуулж cookie-д хадгална. */
export async function switchOrganization(orgId: string): Promise<ActionResult> {
  try {
    return await switchOrganizationCore(orgId);
  } catch (caught) {
    return actionError("switchOrganization", caught, "Байгууллага солигдсонгүй");
  }
}

async function switchOrganizationCore(orgId: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Нэвтрэх шаардлагатай");

  const membership = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.organizationId, orgId),
      eq(memberships.userId, userId)
    ),
    columns: { id: true },
  });
  if (!membership) throw new Error("Та энэ байгууллагын гишүүн биш байна");

  (await cookies()).set(ORG_COOKIE, orgId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
  return {};
}

/** Шинэ байгууллага үүсгээд шууд түүн рүү шилжинэ. */
/**
 * Шинэ байгууллага (компани) бүртгэх — үүсгэсэн хүн owner болж, шинэ
 * байгууллага идэвхтэй болно. Реквизит нь компанийн мэдээлэлд (нэхэмжлэх,
 * тайланд хэрэглэгддэг company_settings) хамт хадгалагдана.
 */
export async function createOrganization(data: {
  name: string;
  registryNo?: string;
  vatPayerNo?: string;
  address?: string;
  phone?: string;
  email?: string;
}): Promise<ActionResult> {
  try {
    return await createOrganizationCore(data);
  } catch (caught) {
    return actionError("createOrganization", caught, "Байгууллага үүссэнгүй");
  }
}

async function createOrganizationCore(data: {
  name: string;
  registryNo?: string;
  vatPayerNo?: string;
  address?: string;
  phone?: string;
  email?: string;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Нэвтрэх шаардлагатай");
  const name = data.name.trim();
  if (!name) throw new Error("Байгууллагын нэр оруулна уу");
  // Багцын хязгаар — идэвхтэй байгууллагын entitlement-ээр (multi_company, компанийн тоо).
  const current = await getActiveOrg();
  await assertCompanyCreatable(current.orgId, userId);

  const clean = (value?: string) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  };

  const orgId = await createPersonalOrg(userId, name);
  if (clean(data.registryNo))
    await db
      .update(organizations)
      .set({ registryNo: clean(data.registryNo) })
      .where(eq(organizations.id, orgId));

  // Реквизитийг компанийн мэдээлэлд шууд суулгана — Тохиргоо → Компанийн
  // мэдээлэл хуудсанд бэлэн бөглөгдсөн байх ба нэхэмжлэхэд шууд хэрэглэгдэнэ.
  await db.insert(organizationProfile).values({
    userId,
    organizationId: orgId,
    name,
    registerNo: clean(data.registryNo),
    vatPayerNo: clean(data.vatPayerNo),
    address: clean(data.address),
    phone: clean(data.phone),
    email: clean(data.email),
  });

  // Группын багц ӨВЛӨЛТ: эх байгууллагын багцыг шинэ компанид хуулна
  // (үнэ 0 — төлбөр эх дээрээ). Энэгүйгээр 2 дахь компани мөргүй үүсч,
  // өөрийн 14 хоногийн trial дуусмагц БИЧИХ ЭРХГҮЙ болдог байв.
  await inheritSubscriptionForNewOrg(current.orgId, orgId, userId);

  // Шинэ компани = S1/S6 сегментийн шинэ утга (эзэмшигчийн БҮХ компанид).
  await refreshCompanySegments(orgId, userId);
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "create",
    entityType: "organization",
    entityId: orgId,
    summary: `Байгууллага үүсгэв — ${name}`,
  });

  (await cookies()).set(ORG_COOKIE, orgId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
  return { id: orgId };
}

/**
 * Байгууллага үүсгэх ЦӨМ — session/cookie-гүй, userId-г ИЛ авдаг тул MCP/REST
 * замаас (token-ий эзний нэрээр) дуудагдана. Атом транзакц: organizations +
 * owner membership + organization_profile (+ сонголтоор стандарт дансны мод).
 *
 * Идэвхтэй байгууллага (cookie) СОЛИХГҮЙ — дуудагч (вэб) өөрөө шийднэ. Эрх:
 * нэвтэрсэн дурын хэрэглэгч өөрийн шинэ байгууллага үүсгэж болно (web
 * signup/switcher-тэй ижил), тиум role шалгалт энд байхгүй.
 */
export async function createOrganizationForUser(input: {
  userId: string;
  name: string;
  registryNo?: string | null;
  vatPayerNo?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Стандарт дансны модыг (DEFAULT_ACCOUNTS) шинэ байгууллагад суулгах эсэх. */
  seedAccounts?: boolean;
}): Promise<{ orgId: string }> {
  const name = input.name.trim();
  if (!name) throw new Error("Байгууллагын нэр оруулна уу");
  // API/MCP зам — token-ий байгууллагын entitlement-ээр шалгана (runAsOrg
  // контекстгүй дуудагдвал шалгалт алгасна: script/seed).
  // Эх байгууллага — хязгаарын шалгалтад ба доорх багцын ӨВЛӨЛТӨД хоёуланд.
  let sourceOrgId: string | null = null;
  try {
    const current = await getActiveOrg();
    sourceOrgId = current.orgId;
    await assertCompanyCreatable(current.orgId, input.userId);
  } catch (caught) {
    if (caught instanceof Error && caught.message.startsWith("[")) throw caught;
  }
  const clean = (value?: string | null) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  };
  const registryNo = clean(input.registryNo);

  const orgId = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name, registryNo })
      .returning({ id: organizations.id });
    await tx.insert(memberships).values({
      organizationId: org.id,
      userId: input.userId,
      role: "owner",
    });
    // Реквизит (organizations-ийн 1:1 дагавар) — нэхэмжлэхэд шууд хэрэглэгдэнэ.
    await tx.insert(organizationProfile).values({
      userId: input.userId,
      organizationId: org.id,
      name,
      registerNo: registryNo,
      vatPayerNo: clean(input.vatPayerNo),
      address: clean(input.address),
      phone: clean(input.phone),
      email: clean(input.email),
    });
    if (input.seedAccounts)
      await tx.insert(chartOfAccounts).values(
        DEFAULT_ACCOUNTS.map((account) => ({
          userId: input.userId,
          organizationId: org.id,
          ...account,
        }))
      );
    return org.id;
  });
  // SIM2-014: мөнгөн гүйлгээний S8 ангилал шинэ компанид бэлэн байна.
  await ensureCashFlowSegmentValues(orgId, input.userId).catch((caught) =>
    console.error("[createOrganization] S8 seed", caught)
  );
  // Группын багц ӨВЛӨЛТ — вэбийн замтай ИЖИЛ (docs/billing §6).
  if (sourceOrgId) await inheritSubscriptionForNewOrg(sourceOrgId, orgId, input.userId);
  await logAuditEvent({
    userId: input.userId,
    organizationId: orgId,
    action: "create",
    entityType: "organization",
    entityId: orgId,
    summary: `Байгууллага үүсгэв (API/MCP) — ${name}`,
  });
  return { orgId };
}

/**
 * Байгууллага УСТГАХ ЦӨМ — session/cookie-гүй, userId + orgId-г ИЛ авдаг тул
 * MCP/REST замаас дуудагдана. `deleteOrganization`-той ижил хамгаалалт: зөвхөн
 * тухайн байгууллагын OWNER, нэрийг ЯГ давхар бичиж баталгаажуулна. Бүх дата
 * (журнал, баримт, тохиргоо, audit) cascade-аар БУЦАЛТГҮЙ устана. Cookie
 * хөндөхгүй (MCP-д session байхгүй) — дуудагч идэвхтэй компанийхаа cookie-г
 * өөрөө удирдана.
 */
export async function deleteOrganizationForUser(input: {
  userId: string;
  orgId: string;
  confirmName: string;
}): Promise<{ deletedName: string }> {
  const membership = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.organizationId, input.orgId),
      eq(memberships.userId, input.userId)
    ),
    columns: { role: true },
  });
  if (!membership) throw new Error("Байгууллагын гишүүнчлэл олдсонгүй");
  if (membership.role !== "owner")
    throw new Error("Байгууллагыг зөвхөн owner устгана");

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, input.orgId),
    columns: { name: true },
  });
  if (!org) throw new Error("Байгууллага олдсонгүй");
  if (input.confirmName.trim() !== org.name)
    throw new Error(
      `Баталгаажуулахын тулд байгууллагын нэрийг яг бичнэ үү: "${org.name}"`
    );

  // Устгалт audit_events-ийг ч устгах тул сервер лог л үлдэнэ.
  console.log(
    `[org-audit] deleteOrganizationForUser org=${input.orgId} "${org.name}" by user=${input.userId} at=${new Date().toISOString()}`
  );
  await purgeOrganization(input.orgId);
  return { deletedName: org.name };
}

/** Нэр/ТТД засах — admin+. */
export async function updateOrganization(data: {
  name: string;
  registryNo?: string;
}): Promise<ActionResult> {
  try {
    return await updateOrganizationCore(data);
  } catch (caught) {
    return actionError("updateOrganization", caught, "Байгууллага шинэчлэгдсэнгүй");
  }
}

async function updateOrganizationCore(data: {
  name: string;
  registryNo?: string;
}) {
  const { orgId, userId } = await requireRole("admin");
  const name = data.name.trim();
  if (!name) throw new Error("Байгууллагын нэр оруулна уу");
  await db
    .update(organizations)
    .set({ name, registryNo: data.registryNo?.trim() || null })
    .where(eq(organizations.id, orgId));
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "update",
    entityType: "organization",
    entityId: orgId,
    summary: `Байгууллагын мэдээлэл өөрчлөв — ${name}${data.registryNo?.trim() ? ` (${data.registryNo.trim()})` : ""}`,
  });
  // Нэр солигдвол S1/S6 утгын НЭР дагана — код хэвээр (журнал хоцрохгүй).
  await refreshCompanySegments(orgId, userId);
  revalidatePath("/settings/gl");
  revalidatePath("/admin/org");
  revalidatePath("/", "layout");
  return {};
}

/**
 * Гишүүн урих — admin+. Бүртгэлтэй email бол шууд нэмнэ; бүртгэлгүй бол
 * ойлгомжтой алдаа (спекийн pending урилга нь дараагийн сайжруулалт).
 */
export type InviteResult =
  | { outcome: "added" }
  | { outcome: "invited"; url: string; emailed: boolean };

/**
 * Гишүүн нэмэх — бүртгэлтэй и-мэйл шууд гишүүн болно; бүртгэлгүй бол урилга
 * үүсгэж, Resend тохируулсан үед урилгын и-мэйл илгээнэ (үгүй бол линкийг
 * буцаана — админ өөрөө дамжуулна). Урилгын линкээр бүртгүүлмэгц идэвхжинэ.
 */
export async function inviteMember(data: {
  email: string;
  role: MembershipRole;
}): Promise<ActionResult<InviteResult>> {
  try {
    return await inviteMemberCore(data);
  } catch (caught) {
    return actionError("inviteMember", caught, "Урилга илгээгдсэнгүй");
  }
}

async function inviteMemberCore(data: {
  email: string;
  role: MembershipRole;
}): Promise<InviteResult> {
  const { orgId, userId: invitedBy } = await requireRole("admin");
  const email = data.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("И-мэйл хаяг буруу байна");
  // Суудлын хязгаар (гишүүд + хүлээгдэж буй урилга) — хатуу.
  await assertSeatAvailable(orgId);
  if (!ROLES.includes(data.role) || data.role === "owner")
    throw new Error("Эрх нь admin/accountant/viewer байна (owner шилжүүлэхгүй)");

  const user = await db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${email}`,
    columns: { id: true },
  });

  if (user) {
    const existing = await db.query.memberships.findFirst({
      where: and(
        eq(memberships.organizationId, orgId),
        eq(memberships.userId, user.id)
      ),
      columns: { id: true },
    });
    if (existing) throw new Error("Энэ хэрэглэгч аль хэдийн гишүүн байна");

    const [created] = await db
      .insert(memberships)
      .values({
        organizationId: orgId,
        userId: user.id,
        role: data.role,
      })
      .returning({ id: memberships.id });
    await logAuditEvent({
      userId: invitedBy,
      organizationId: orgId,
      action: "member_added",
      entityType: "membership",
      entityId: created.id,
      summary: `Гишүүн нэмэв — ${email} (${data.role})`,
    });
    revalidatePath("/admin/org");
    return { outcome: "added" };
  }

  // Бүртгэлгүй — урилга. Давхар илгээвэл хуучныг шинэчилнэ (нэг pending/и-мэйл).
  // Дахин урихад хугацаа ба token ШИНЭЧЛЭГДЭНЭ — хуучин (магадгүй алдагдсан)
  // линк хүчингүй болж, шинэ линк дахин 7 хоног хүчинтэй.
  const expiresAt = new Date(Date.now() + ORG_INVITATION_TTL_DAYS * 24 * 60 * 60_000);
  const [invitation] = await db
    .insert(orgInvitations)
    .values({ organizationId: orgId, email, role: data.role, invitedBy, expiresAt })
    .onConflictDoUpdate({
      target: [orgInvitations.organizationId, orgInvitations.email],
      targetWhere: sql`accepted_at is null`,
      set: { role: data.role, invitedBy, expiresAt, token: sql`gen_random_uuid()` },
    })
    .returning({ id: orgInvitations.id, token: orgInvitations.token });
  await logAuditEvent({
    userId: invitedBy,
    organizationId: orgId,
    action: "invited",
    entityType: "invitation",
    entityId: invitation.id,
    summary: `Урилга илгээв — ${email} (${data.role}), ${ORG_INVITATION_TTL_DAYS} хоног хүчинтэй`,
  });

  const url = inviteUrl(invitation.token);
  let emailed = false;
  // Илгээгч хаяг env-ээс (sandbox fallback үгүй) — тохируулаагүй бол и-мэйл
  // алгасаад урилгын линкийг буцаана (урилга өөрөө үүссэн хэвээр).
  let inviteFrom: string | null = null;
  try {
    const { resolveInvoiceSender } = await import("@/lib/email/sender");
    inviteFrom = resolveInvoiceSender(null, process.env).from;
  } catch {
    inviteFrom = null;
  }
  if (process.env.RESEND_API_KEY && inviteFrom) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { name: true },
    });
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: inviteFrom,
      to: email,
      subject: `«${org?.name ?? "Байгууллага"}» таныг Entry Accounting-д урьж байна`,
      text: [
        `Сайн байна уу,`,
        ``,
        `Таныг «${org?.name ?? ""}» байгууллагын бүртгэлд «${data.role}» эрхтэйгээр урьлаа.`,
        ``,
        `Доорх линкээр бүртгүүлмэгц шууд нэвтэрнэ:`,
        url,
      ].join("\n"),
    });
    emailed = !error;
  }

  revalidatePath("/admin/org");
  return { outcome: "invited", url, emailed };
}

/** Хүлээгдэж буй урилгыг цуцлах — линк нь хүчингүй болно. */
export async function cancelInvitation(invitationId: string): Promise<ActionResult> {
  try {
    const { orgId, userId } = await requireRole("admin");
    const [removed] = await db
      .delete(orgInvitations)
      .where(
        and(
          eq(orgInvitations.id, invitationId),
          eq(orgInvitations.organizationId, orgId)
        )
      )
      .returning({ email: orgInvitations.email });
    if (removed)
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: "invitation_cancelled",
        entityType: "invitation",
        entityId: invitationId,
        summary: `Урилга цуцлав — ${removed.email}`,
      });
    revalidatePath("/admin/org");
    return {};
  } catch (caught) {
    return actionError("cancelInvitation", caught, "Урилга цуцлагдсангүй");
  }
}

/** Гишүүний эрх өөрчлөх — admin+; сүүлчийн owner-ыг бууруулахгүй. */
export async function updateMemberRole(data: {
  membershipId: string;
  role: MembershipRole;
}): Promise<ActionResult> {
  try {
    return await updateMemberRoleCore(data);
  } catch (caught) {
    return actionError("updateMemberRole", caught, "Эрх солигдсонгүй");
  }
}

async function updateMemberRoleCore(data: {
  membershipId: string;
  role: MembershipRole;
}) {
  const { orgId, userId, role: myRole } = await requireRole("admin");
  if (!ROLES.includes(data.role)) throw new Error("Эрх буруу байна");
  // owner эрх олгох/хасахыг зөвхөн owner хийнэ.
  const target = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.id, data.membershipId),
      eq(memberships.organizationId, orgId)
    ),
    columns: { id: true, role: true },
  });
  if (!target) throw new Error("Гишүүн олдсонгүй");
  if ((target.role === "owner" || data.role === "owner") && myRole !== "owner")
    throw new Error("Owner эрхийг зөвхөн owner өөрчилнө");

  if (target.role === "owner" && data.role !== "owner") {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(memberships)
      .where(
        and(eq(memberships.organizationId, orgId), eq(memberships.role, "owner"))
      );
    if (Number(n) <= 1)
      throw new Error("Сүүлчийн owner-ын эрхийг бууруулж болохгүй");
  }

  await db
    .update(memberships)
    .set({ role: data.role })
    .where(eq(memberships.id, data.membershipId));
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "role_changed",
    entityType: "membership",
    entityId: data.membershipId,
    summary: `Гишүүний роль өөрчлөв — ${target.role} → ${data.role}`,
  });
  revalidatePath("/admin/org");
  return {};
}

/**
 * Байгууллага УСТГАХ — зөвхөн owner. Бүх дата (журнал, баримт, тохиргоо)
 * cascade-аар БУЦАЛТГҮЙ устана — баталгаажуулалтад нэрийг яг бичиж өгнө.
 */
export async function deleteOrganization(confirmName: string): Promise<ActionResult> {
  try {
    return await deleteOrganizationCore(confirmName);
  } catch (caught) {
    return actionError("deleteOrganization", caught, "Байгууллага устгагдсангүй");
  }
}

async function deleteOrganizationCore(confirmName: string) {
  const { orgId, userId, role } = await getActiveOrg();
  if (role !== "owner")
    throw new Error("Байгууллагыг зөвхөн owner устгана");

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { name: true },
  });
  if (!org) throw new Error("Байгууллага олдсонгүй");
  if (confirmName.trim() !== org.name)
    throw new Error(
      `Баталгаажуулахын тулд байгууллагын нэрийг яг бичнэ үү: "${org.name}"`
    );

  // Устгалт audit_events-ийг ч устгах тул сервер лог л үлдэнэ.
  console.log(
    `[org-audit] deleteOrganization org=${orgId} "${org.name}" by user=${userId} at=${new Date().toISOString()}`
  );
  await purgeOrganization(orgId);

  // Өөр байгууллагатай бол тийш нь, үгүй бол cookie цэвэрлээд дараагийн
  // хандалтад personal org автоматаар үүснэ (getActiveOrg safety net).
  const next = await db.query.memberships.findFirst({
    where: eq(memberships.userId, userId),
    orderBy: [asc(memberships.createdAt)],
    columns: { organizationId: true },
  });
  const store = await cookies();
  if (next) {
    store.set(ORG_COOKIE, next.organizationId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  } else {
    store.delete(ORG_COOKIE);
  }
  revalidatePath("/", "layout");
  return {};
}

/**
 * Байгууллагаас ГАРАХ — өөрийн гишүүнчлэлийг хасна (owner биш гишүүнд;
 * сүүлчийн owner гарахын оронд устгах эсвэл owner эрхээ шилжүүлнэ).
 */
export async function leaveOrganization(): Promise<ActionResult> {
  try {
    return await leaveOrganizationCore();
  } catch (caught) {
    return actionError("leaveOrganization", caught, "Гарах үйлдэл амжилтгүй");
  }
}

async function leaveOrganizationCore() {
  const { orgId, userId, role } = await getActiveOrg();
  if (role === "owner") {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(memberships)
      .where(
        and(eq(memberships.organizationId, orgId), eq(memberships.role, "owner"))
      );
    if (Number(n) <= 1)
      throw new Error(
        "Сүүлчийн owner гарах боломжгүй — owner эрхээ шилжүүлэх эсвэл байгууллагаа устгана уу"
      );
  }
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "member_left",
    entityType: "membership",
    entityId: userId,
    summary: `Гишүүн байгууллагаас гарав (${role})`,
  });
  await db
    .delete(memberships)
    .where(
      and(eq(memberships.organizationId, orgId), eq(memberships.userId, userId))
    );
  (await cookies()).delete(ORG_COOKIE);
  revalidatePath("/", "layout");
  return {};
}

/** Гишүүн хасах — admin+; сүүлчийн owner хасагдахгүй. */
export async function removeMember(membershipId: string): Promise<ActionResult> {
  try {
    return await removeMemberCore(membershipId);
  } catch (caught) {
    return actionError("removeMember", caught, "Гишүүн хасагдсангүй");
  }
}

async function removeMemberCore(membershipId: string) {
  const { orgId, userId, role: myRole } = await requireRole("admin");
  const target = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.id, membershipId),
      eq(memberships.organizationId, orgId)
    ),
    columns: { id: true, role: true, userId: true },
  });
  if (!target) throw new Error("Гишүүн олдсонгүй");
  if (target.role === "owner") {
    if (myRole !== "owner") throw new Error("Owner-ыг зөвхөн owner хасна");
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(memberships)
      .where(
        and(eq(memberships.organizationId, orgId), eq(memberships.role, "owner"))
      );
    if (Number(n) <= 1) throw new Error("Сүүлчийн owner-ыг хасаж болохгүй");
  }
  await db.delete(memberships).where(eq(memberships.id, membershipId));
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "member_removed",
    entityType: "membership",
    entityId: membershipId,
    summary: `Гишүүн хасав — ${target.userId} (${target.role})`,
  });
  revalidatePath("/admin/org");
  return {};
}
