// Entitlement-ийн DB давхарга (энгийн модуль, "use server" БИШ) — action, API
// route, layout, MCP бүгд эндээс. Цэвэр дүрэм lib/billing/entitlements.ts.

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  memberships,
  organizationSubscriptions,
  organizations,
  orgInvitations,
} from "@/lib/db/schema";
import { deploymentMode } from "@/lib/deployment-mode";
import {
  parseOverrides,
  resolveEntitlements,
  type Entitlements,
  type SubscriptionRecord,
} from "@/lib/billing/entitlements";

export async function loadSubscription(orgId: string): Promise<SubscriptionRecord | null> {
  const row = await db.query.organizationSubscriptions.findFirst({
    where: eq(organizationSubscriptions.organizationId, orgId),
  });
  if (!row) return null;
  return {
    planId: row.planId,
    status: row.status,
    seats: row.seats,
    trialEndsAt: row.trialEndsAt,
    currentPeriodEnd: row.currentPeriodEnd,
    overrides: parseOverrides(row.overrides),
  };
}

/** Байгууллагын бодит entitlement — dedicated горимд DB хөндөхгүй. */
export async function getEntitlements(orgId: string, now = new Date()): Promise<Entitlements> {
  const mode = deploymentMode();
  if (mode === "dedicated")
    return resolveEntitlements({ mode, subscription: null, orgCreatedAt: now, now });
  const [org, subscription] = await Promise.all([
    db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { createdAt: true },
    }),
    loadSubscription(orgId),
  ]);
  return resolveEntitlements({
    mode,
    subscription,
    orgCreatedAt: org?.createdAt ?? now,
    now,
  });
}

/** Суудлын хэрэглээ = гишүүд + хүлээгдэж буй (хугацаа дуусаагүй) урилга. */
export async function countSeatsUsed(orgId: string): Promise<number> {
  const [[members], [invites]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(eq(memberships.organizationId, orgId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(orgInvitations)
      .where(
        and(
          eq(orgInvitations.organizationId, orgId),
          isNull(orgInvitations.acceptedAt),
          sql`${orgInvitations.expiresAt} > now()`
        )
      ),
  ]);
  return (members?.n ?? 0) + (invites?.n ?? 0);
}

/** Хэрэглэгчийн ЭЗЭМШДЭГ (owner) байгууллагын тоо — компанийн хязгаарт. */
export async function countOwnedCompanies(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")));
  return row?.n ?? 0;
}
