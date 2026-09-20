"use server";

// Багц, төлбөр (billing/entitlement) Server Action — docs/billing/00-proposal.md §5.
//   getBillingOverview — байгууллагын гишүүн өөрийн багцаа харна.
// Багц ЗАСАХ нь апп дотор байхгүй — Entry Console /api/platform/subscriptions-ээр
// (lib/billing/platform.ts).

import { eq, sql } from "drizzle-orm";

import { getActiveOrg } from "@/lib/auth";
import type { Entitlements } from "@/lib/billing/entitlements";
import { countSeatsUsed, getEntitlements } from "@/lib/billing/load";
import { PLANS } from "@/lib/billing/plans";
import { db } from "@/lib/db";
import { memberships, organizationSubscriptions, organizations } from "@/lib/db/schema";

export type BillingOverview = {
  orgName: string;
  entitlements: Entitlements;
  seatsUsed: number;
  membersCount: number;
  pricePerSeatMnt: number | null;
  note: string | null;
};

/** Идэвхтэй байгууллагын багц — гишүүн бүр харна (засах эрх platform admin-д). */
export async function getBillingOverview(): Promise<BillingOverview> {
  const { orgId } = await getActiveOrg();
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
  };
}
