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
  getActiveOrg,
  requireRole,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  memberships,
  organizations,
  orgInvitations,
  users,
  type MembershipRole,
} from "@/lib/db/schema";

const ORG_COOKIE = "ea-org";
const ROLES: MembershipRole[] = ["owner", "admin", "accountant", "viewer"];

export type OrgSummary = { id: string; name: string; role: MembershipRole };

export type OrgMemberView = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
};

export type OrgInvitationView = {
  id: string;
  email: string;
  role: MembershipRole;
  createdAt: string;
  url: string;
};

export type OrgSettingsData = {
  org: { id: string; name: string; registryNo: string | null };
  myRole: MembershipRole;
  members: OrgMemberView[];
  invitations: OrgInvitationView[];
  myOrgs: OrgSummary[];
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

  const [org, memberRows, myMemberships, invitationRows] = await Promise.all([
    db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { id: true, name: true, registryNo: true },
    }),
    db
      .select({
        membershipId: memberships.id,
        userId: memberships.userId,
        role: memberships.role,
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
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(memberships.createdAt)),
    db.query.orgInvitations.findMany({
      where: and(
        eq(orgInvitations.organizationId, orgId),
        sql`${orgInvitations.acceptedAt} is null`
      ),
      orderBy: [asc(orgInvitations.createdAt)],
    }),
  ]);
  if (!org) throw new Error("Байгууллага олдсонгүй");

  return {
    org,
    myRole: role,
    members: memberRows.map((row) => ({
      membershipId: row.membershipId,
      userId: row.userId,
      name: row.name,
      email: row.email,
      role: row.role as MembershipRole,
    })),
    invitations: invitationRows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role as MembershipRole,
      createdAt: row.createdAt.toISOString().slice(0, 10),
      url: inviteUrl(row.token),
    })),
    myOrgs: myMemberships.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role as MembershipRole,
    })),
  };
}

/** Topbar сонголтод — хөнгөн жагсаалт (гишүүдийн join-гүй). */
export async function getMyOrgs(): Promise<{
  activeOrgId: string;
  orgs: OrgSummary[];
}> {
  const { orgId, userId } = await getActiveOrg();
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
export async function switchOrganization(orgId: string) {
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
}

/** Шинэ байгууллага үүсгээд шууд түүн рүү шилжинэ. */
export async function createOrganization(data: {
  name: string;
  registryNo?: string;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Нэвтрэх шаардлагатай");
  const name = data.name.trim();
  if (!name) throw new Error("Байгууллагын нэр оруулна уу");

  const orgId = await createPersonalOrg(userId, name);
  if (data.registryNo?.trim())
    await db
      .update(organizations)
      .set({ registryNo: data.registryNo.trim() })
      .where(eq(organizations.id, orgId));

  (await cookies()).set(ORG_COOKIE, orgId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
  return { id: orgId };
}

/** Нэр/ТТД засах — admin+. */
export async function updateOrganization(data: {
  name: string;
  registryNo?: string;
}) {
  const { orgId } = await requireRole("admin");
  const name = data.name.trim();
  if (!name) throw new Error("Байгууллагын нэр оруулна уу");
  await db
    .update(organizations)
    .set({ name, registryNo: data.registryNo?.trim() || null })
    .where(eq(organizations.id, orgId));
  revalidatePath("/admin/org");
  revalidatePath("/", "layout");
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
}): Promise<InviteResult> {
  const { orgId, userId: invitedBy } = await requireRole("admin");
  const email = data.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("И-мэйл хаяг буруу байна");
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

    await db.insert(memberships).values({
      organizationId: orgId,
      userId: user.id,
      role: data.role,
    });
    revalidatePath("/admin/org");
    return { outcome: "added" };
  }

  // Бүртгэлгүй — урилга. Давхар илгээвэл хуучныг шинэчилнэ (нэг pending/и-мэйл).
  const [invitation] = await db
    .insert(orgInvitations)
    .values({ organizationId: orgId, email, role: data.role, invitedBy })
    .onConflictDoUpdate({
      target: [orgInvitations.organizationId, orgInvitations.email],
      targetWhere: sql`accepted_at is null`,
      set: { role: data.role, invitedBy },
    })
    .returning({ token: orgInvitations.token });

  const url = inviteUrl(invitation.token);
  let emailed = false;
  if (process.env.RESEND_API_KEY) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { name: true },
    });
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM ?? "Entry Accounting <onboarding@resend.dev>",
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
export async function cancelInvitation(invitationId: string) {
  const { orgId } = await requireRole("admin");
  await db
    .delete(orgInvitations)
    .where(
      and(
        eq(orgInvitations.id, invitationId),
        eq(orgInvitations.organizationId, orgId)
      )
    );
  revalidatePath("/admin/org");
}

/** Гишүүний эрх өөрчлөх — admin+; сүүлчийн owner-ыг бууруулахгүй. */
export async function updateMemberRole(data: {
  membershipId: string;
  role: MembershipRole;
}) {
  const { orgId, role: myRole } = await requireRole("admin");
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
  revalidatePath("/admin/org");
}

/**
 * Байгууллага УСТГАХ — зөвхөн owner. Бүх дата (журнал, баримт, тохиргоо)
 * cascade-аар БУЦАЛТГҮЙ устана — баталгаажуулалтад нэрийг яг бичиж өгнө.
 */
export async function deleteOrganization(confirmName: string) {
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

  // Cascade нь audit_events-ийг ч устгах тул сервер лог л үлдэнэ.
  console.log(
    `[org-audit] deleteOrganization org=${orgId} "${org.name}" by user=${userId} at=${new Date().toISOString()}`
  );
  await db.delete(organizations).where(eq(organizations.id, orgId));

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
}

/**
 * Байгууллагаас ГАРАХ — өөрийн гишүүнчлэлийг хасна (owner биш гишүүнд;
 * сүүлчийн owner гарахын оронд устгах эсвэл owner эрхээ шилжүүлнэ).
 */
export async function leaveOrganization() {
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
  await db
    .delete(memberships)
    .where(
      and(eq(memberships.organizationId, orgId), eq(memberships.userId, userId))
    );
  (await cookies()).delete(ORG_COOKIE);
  revalidatePath("/", "layout");
}

/** Гишүүн хасах — admin+; сүүлчийн owner хасагдахгүй. */
export async function removeMember(membershipId: string) {
  const { orgId, role: myRole } = await requireRole("admin");
  const target = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.id, membershipId),
      eq(memberships.organizationId, orgId)
    ),
    columns: { id: true, role: true },
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
  revalidatePath("/admin/org");
}
