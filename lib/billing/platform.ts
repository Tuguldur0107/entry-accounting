// Платформын (Entry Console) subscription удирдлагын ЦӨМ — "use server" БИШ.
// Дуудагч: app/api/platform/subscriptions (Console, Bearer ENTRY_PLATFORM_API_KEY).
// Апп дотор platform admin UI БАЙХГҮЙ — SaaS харилцагчдын багцыг Console л
// удирдана (docs/billing/00-proposal.md §5); байгууллагын эзэн /settings/billing
// дээр зөвхөн харна.

import { and, asc, eq, sql } from "drizzle-orm";

import { logAuditEvent } from "@/lib/audit";
import { parseOverrides } from "@/lib/billing/entitlements";
import { countSeatsUsed, getEntitlements } from "@/lib/billing/load";
import {
  isPlanId,
  isSubscriptionStatus,
  type PlanId,
  type SubscriptionStatus,
} from "@/lib/billing/plans";
import { db } from "@/lib/db";
import { memberships, organizationSubscriptions, organizations, users } from "@/lib/db/schema";

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
  readOnlyReason: string | null;
  daysLeft: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  overrides: unknown;
  note: string | null;
  hasRow: boolean;
  updatedAt: string | null;
};

export async function listPlatformSubscriptions(): Promise<PlatformSubscriptionRow[]> {
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
      readOnlyReason: ent.readOnlyReason,
      daysLeft: ent.daysLeft,
      trialEndsAt: (sub?.trialEndsAt ?? ent.trialEndsAt)?.toISOString().slice(0, 10) ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd?.toISOString().slice(0, 10) ?? null,
      overrides: sub?.overrides ?? null,
      note: sub?.note ?? null,
      hasRow: !!sub,
      updatedAt: sub?.updatedAt?.toISOString() ?? null,
    });
  }
  return rows;
}

export type SavePlatformSubscriptionInput = {
  organizationId: string;
  planId: string;
  status: string;
  seats?: number | null;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  overrides?: unknown;
  note?: string | null;
};

/**
 * Багц бичих — validation монгол алдаагаар ШИДНЭ (дуудагч { error } болгоно).
 * actor: Console-оос ирвэл userId null (аудитын FK users-т уягдсан тул зөвхөн
 * сервер лог + updatedBy null), апп доторх хэрэглэгч бол аудитын мөр.
 */
export async function savePlatformSubscription(
  input: SavePlatformSubscriptionInput,
  actor: { userId: string | null; label: string }
): Promise<{ organizationId: string; orgName: string }> {
  if (!isPlanId(input.planId) || input.planId === "dedicated") throw new Error("Багц буруу байна");
  if (!isSubscriptionStatus(input.status)) throw new Error("Статус буруу байна");
  const seats = input.seats ?? null;
  if (seats !== null && (!Number.isInteger(seats) || seats < 1))
    throw new Error("Суудал 1-ээс доошгүй бүхэл тоо байна");
  const parseDate = (value: string | null | undefined) => {
    if (!value) return null;
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
    if (Number.isNaN(date.getTime())) throw new Error(`Огноо буруу: ${value}`);
    return date;
  };
  const overrides = input.overrides === undefined || input.overrides === null ? null : parseOverrides(input.overrides);
  if (input.overrides && !overrides) throw new Error("overrides буруу — { features?: {…}, limits?: {…} } объект байна");

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, input.organizationId),
    columns: { id: true, name: true },
  });
  if (!org) throw new Error("Байгууллага олдсонгүй");

  const values = {
    planId: input.planId,
    status: input.status,
    seats,
    trialEndsAt: parseDate(input.trialEndsAt),
    currentPeriodEnd: parseDate(input.currentPeriodEnd),
    overrides,
    note: input.note?.trim() || null,
    updatedBy: actor.userId,
    updatedAt: new Date(),
  };
  await db
    .insert(organizationSubscriptions)
    .values({ organizationId: org.id, ...values })
    .onConflictDoUpdate({ target: organizationSubscriptions.organizationId, set: values });

  const summary = `Багц шинэчлэв — ${input.planId} / ${input.status}${seats ? ` / ${seats} суудал` : ""} (${actor.label})`;
  if (actor.userId)
    await logAuditEvent({
      userId: actor.userId,
      organizationId: org.id,
      action: "update",
      entityType: "subscription",
      entityId: org.id,
      summary,
    });
  console.log(`[billing] org=${org.id} "${org.name}" ${summary}`);
  return { organizationId: org.id, orgName: org.name };
}
