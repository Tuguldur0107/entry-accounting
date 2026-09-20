"use server";

// Багц, төлбөр (billing/entitlement) Server Actions — docs/billing/00-proposal.md §5.
//   getBillingOverview        байгууллагын эзэн/админ — өөрийн багц
//   listPlatformSubscriptions platform admin — бүх байгууллага
//   savePlatformSubscription  platform admin — багц/статус/суудал/хугацаа/override

import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError, type ActionResult } from "@/lib/action-result";
import { logAuditEvent } from "@/lib/audit";
import { auth, getActiveOrg } from "@/lib/auth";
import { parseOverrides, type Entitlements } from "@/lib/billing/entitlements";
import { countSeatsUsed, getEntitlements } from "@/lib/billing/load";
import {
  isPlanId,
  isSubscriptionStatus,
  PLANS,
  type PlanId,
  type SubscriptionStatus,
} from "@/lib/billing/plans";
import { db } from "@/lib/db";
import { memberships, organizationSubscriptions, organizations, users } from "@/lib/db/schema";
import { deploymentMode } from "@/lib/deployment-mode";
import { isPlatformAdminEmail } from "@/lib/platform-admin";

export type BillingOverview = {
  orgName: string;
  entitlements: Entitlements;
  seatsUsed: number;
  membersCount: number;
  pricePerSeatMnt: number | null;
  note: string | null;
  isPlatformAdmin: boolean;
};

/** Идэвхтэй байгууллагын багц — гишүүн бүр харна (засах эрх platform admin-д). */
export async function getBillingOverview(): Promise<BillingOverview> {
  const { orgId } = await getActiveOrg();
  const session = await auth();
  const [org, entitlements, seatsUsed, [members], sub] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, orgId), columns: { name: true } }),
    getEntitlements(orgId),
    countSeatsUsed(orgId),
    db.select({ n: sql<number>`count(*)::int` }).from(memberships).where(eq(memberships.organizationId, orgId)),
    db.query.organizationSubscriptions.findFirst({
      where: eq(organizationSubscriptions.organizationId, orgId),
      columns: { note: true },
    }),
  ]);
  return {
    orgName: org?.name ?? "",
    entitlements,
    seatsUsed,
    membersCount: members?.n ?? 0,
    pricePerSeatMnt: PLANS[entitlements.planId].pricePerSeatMnt,
    note: sub?.note ?? null,
    isPlatformAdmin: isPlatformAdminEmail(session?.user?.email),
  };
}

async function requirePlatformAdmin(): Promise<{ userId: string; email: string }> {
  const session = await auth();
  const email = session?.user?.email ?? null;
  const userId = session?.user?.id;
  if (!userId || !isPlatformAdminEmail(email))
    throw new Error("Зөвхөн platform admin (ENTRY_PLATFORM_ADMIN_EMAILS, saas горим)");
  return { userId, email: email! };
}

export type PlatformSubscriptionRow = {
  organizationId: string;
  orgName: string;
  registryNo: string | null;
  createdAt: string;
  memberCount: number;
  ownerEmail: string | null;
  planId: PlanId;
  status: SubscriptionStatus;
  seats: number | null;
  seatsUsed: number;
  writable: boolean;
  daysLeft: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  overridesJson: string;
  note: string | null;
  hasRow: boolean;
};

export async function listPlatformSubscriptions(): Promise<ActionResult<{ rows: PlatformSubscriptionRow[] }>> {
  try {
    await requirePlatformAdmin();
    const orgs = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        registryNo: organizations.registryNo,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .orderBy(asc(organizations.createdAt));
    const rows: PlatformSubscriptionRow[] = [];
    for (const org of orgs) {
      const [ent, seatsUsed, [members], owner, sub] = await Promise.all([
        getEntitlements(org.id),
        countSeatsUsed(org.id),
        db.select({ n: sql<number>`count(*)::int` }).from(memberships).where(eq(memberships.organizationId, org.id)),
        db
          .select({ email: users.email })
          .from(memberships)
          .innerJoin(users, eq(memberships.userId, users.id))
          .where(and(eq(memberships.organizationId, org.id), eq(memberships.role, "owner")))
          .orderBy(asc(memberships.createdAt))
          .limit(1),
        db.query.organizationSubscriptions.findFirst({
          where: eq(organizationSubscriptions.organizationId, org.id),
        }),
      ]);
      rows.push({
        organizationId: org.id,
        orgName: org.name,
        registryNo: org.registryNo,
        createdAt: org.createdAt.toISOString().slice(0, 10),
        memberCount: members?.n ?? 0,
        ownerEmail: owner[0]?.email ?? null,
        planId: ent.planId,
        status: ent.status,
        seats: sub?.seats ?? null,
        seatsUsed,
        writable: ent.writable,
        daysLeft: ent.daysLeft,
        trialEndsAt: (sub?.trialEndsAt ?? ent.trialEndsAt)?.toISOString().slice(0, 10) ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd?.toISOString().slice(0, 10) ?? null,
        overridesJson: sub?.overrides ? JSON.stringify(sub.overrides) : "",
        note: sub?.note ?? null,
        hasRow: !!sub,
      });
    }
    return { rows };
  } catch (caught) {
    return actionError("listPlatformSubscriptions", caught, "Жагсаалт ачаалагдсангүй");
  }
}

export async function savePlatformSubscription(input: {
  organizationId: string;
  planId: string;
  status: string;
  seats: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  overridesJson: string;
  note: string;
}): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    if (deploymentMode() !== "saas") return { error: "Зөвхөн saas горимд" };
    if (!isPlanId(input.planId) || input.planId === "dedicated") return { error: "Багц буруу байна" };
    if (!isSubscriptionStatus(input.status)) return { error: "Статус буруу байна" };
    if (input.seats !== null && (!Number.isInteger(input.seats) || input.seats < 1))
      return { error: "Суудал 1-ээс доошгүй бүхэл тоо байна" };
    const parseDate = (value: string | null) => {
      if (!value) return null;
      const date = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) throw new Error(`Огноо буруу: ${value}`);
      return date;
    };
    let overrides: unknown = null;
    if (input.overridesJson.trim()) {
      try {
        overrides = JSON.parse(input.overridesJson);
      } catch {
        return { error: "Override JSON задлагдсангүй" };
      }
      overrides = parseOverrides(overrides);
    }
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, input.organizationId),
      columns: { id: true, name: true },
    });
    if (!org) return { error: "Байгууллага олдсонгүй" };

    const values = {
      planId: input.planId,
      status: input.status,
      seats: input.seats,
      trialEndsAt: parseDate(input.trialEndsAt),
      currentPeriodEnd: parseDate(input.currentPeriodEnd),
      overrides,
      note: input.note.trim() || null,
      updatedBy: admin.userId,
      updatedAt: new Date(),
    };
    await db
      .insert(organizationSubscriptions)
      .values({ organizationId: org.id, ...values })
      .onConflictDoUpdate({ target: organizationSubscriptions.organizationId, set: values });

    // Аудит — тухайн байгууллагын мөрд (эзэн нь харна) + сервер лог.
    await logAuditEvent({
      userId: admin.userId,
      organizationId: org.id,
      action: "update",
      entityType: "subscription",
      entityId: org.id,
      summary: `Багц шинэчлэв — ${input.planId} / ${input.status}${input.seats ? ` / ${input.seats} суудал` : ""} (platform admin ${admin.email})`,
    });
    console.log(
      `[billing] org=${org.id} "${org.name}" plan=${input.planId} status=${input.status} seats=${input.seats ?? "-"} by=${admin.email}`
    );
    revalidatePath("/admin/platform");
    revalidatePath("/settings/billing");
    return {};
  } catch (caught) {
    return actionError("savePlatformSubscription", caught, "Багц хадгалагдсангүй");
  }
}
