// Дэмжлэгийн хандалтын DB давхарга ("use server" БИШ — platform API route,
// /support/enter route, getActiveOrg гурвуул шууд дуудна). ЦЭВЭР дүрэм нь
// lib/platform/support.ts-д; энд зөвхөн бичилт/уншилт.

import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  memberships,
  organizations,
  platformSupportSessions,
  users,
} from "@/lib/db/schema";
import {
  isSupportSessionUsable,
  supportLinkExpiry,
  supportSessionExpiry,
  supportSessionState,
  type SupportRole,
  type SupportSessionState,
} from "@/lib/platform/support";

/** 32 байт = 64 hex (lib/account/tokens.ts-тэй ИЖИЛ хэв маяг). */
function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function isWellFormedSupportToken(raw: unknown): raw is string {
  return typeof raw === "string" && /^[0-9a-f]{64}$/.test(raw);
}

export type IssueSupportSessionInput = {
  organizationId: string;
  /** Линкийг ашиглах Entry данс — И-МЭЙЛЭЭР (Console нь userId мэдэхгүй). */
  email: string;
  role: SupportRole;
  reason: string | null;
  issuedBy: string;
};

export type IssuedSupportSession = {
  id: string;
  token: string;
  organizationId: string;
  orgName: string;
  userId: string;
  email: string;
  role: SupportRole;
  expiresAt: Date;
};

/**
 * Console-оос линк олгох. Хэрэглэгч нь БАЙГАА Entry данс байх ёстой —
 * данс ЗОХИОХГҮЙ (шинэ хэрэглэгч үүсгэх зам нь урилга, бүртгэл хоёр л).
 */
export async function issueSupportSession(
  input: IssueSupportSessionInput
): Promise<IssuedSupportSession> {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("И-мэйл шаардлагатай");

  const [org, user] = await Promise.all([
    db.query.organizations.findFirst({
      where: eq(organizations.id, input.organizationId),
      columns: { id: true, name: true },
    }),
    db.query.users.findFirst({
      where: sql`lower(${users.email}) = ${email}`,
      columns: { id: true, email: true },
    }),
  ]);
  if (!org) throw new Error("Байгууллага олдсонгүй");
  if (!user)
    throw new Error(
      `${email} хаягтай Entry хэрэглэгч олдсонгүй — эхлээд өөрийн дансаар бүртгүүлнэ`
    );

  const token = generateToken();
  const expiresAt = supportLinkExpiry();
  const [row] = await db
    .insert(platformSupportSessions)
    .values({
      organizationId: org.id,
      userId: user.id,
      tokenHash: hash(token),
      role: input.role,
      reason: input.reason,
      issuedBy: input.issuedBy,
      expiresAt,
    })
    .returning({ id: platformSupportSessions.id });

  return {
    id: row.id,
    token,
    organizationId: org.id,
    orgName: org.name,
    userId: user.id,
    email: user.email ?? email,
    role: input.role,
    expiresAt,
  };
}

export type SupportSessionRow = {
  id: string;
  organizationId: string;
  orgName: string;
  userId: string;
  email: string | null;
  role: SupportRole;
  reason: string | null;
  issuedBy: string | null;
  expiresAt: Date;
  startedAt: Date | null;
  endsAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
};

async function findByToken(raw: string): Promise<SupportSessionRow | null> {
  if (!isWellFormedSupportToken(raw)) return null;
  const [row] = await db
    .select({
      id: platformSupportSessions.id,
      organizationId: platformSupportSessions.organizationId,
      orgName: organizations.name,
      userId: platformSupportSessions.userId,
      email: users.email,
      role: platformSupportSessions.role,
      reason: platformSupportSessions.reason,
      issuedBy: platformSupportSessions.issuedBy,
      expiresAt: platformSupportSessions.expiresAt,
      startedAt: platformSupportSessions.startedAt,
      endsAt: platformSupportSessions.endsAt,
      endedAt: platformSupportSessions.endedAt,
      createdAt: platformSupportSessions.createdAt,
    })
    .from(platformSupportSessions)
    .innerJoin(organizations, eq(platformSupportSessions.organizationId, organizations.id))
    .leftJoin(users, eq(platformSupportSessions.userId, users.id))
    .where(eq(platformSupportSessions.tokenHash, hash(raw)))
    .limit(1);
  return row ? ({ ...row, role: row.role as SupportRole } as SupportSessionRow) : null;
}

/**
 * Линкээр ОРОХ: хугацаа, эзэн, төлвийг шалгаад сессийг идэвхжүүлнэ.
 * Аль хэдийн идэвхтэй сесс дээр дахин дарвал ИЖИЛ сесс буцна (cookie
 * алдагдсан үед дахин орох боломж) — хугацаа СУНГАГДАХГҮЙ.
 */
export async function startSupportSession(
  raw: string,
  userId: string,
  now: Date = new Date()
): Promise<SupportSessionRow> {
  const row = await findByToken(raw);
  if (!row) throw new Error("Дэмжлэгийн линк танигдсангүй");
  if (row.userId !== userId)
    throw new Error("Энэ линк өөр хэрэглэгчид олгогдсон байна");

  const state = supportSessionState(row, now);
  if (state === "active") return row;
  if (state !== "pending")
    throw new Error(
      state === "ended"
        ? "Энэ дэмжлэгийн сесс дууссан байна"
        : "Дэмжлэгийн линкийн хугацаа дууссан байна"
    );

  const endsAt = supportSessionExpiry(now);
  await db
    .update(platformSupportSessions)
    .set({ startedAt: now, endsAt })
    .where(eq(platformSupportSessions.id, row.id));
  return { ...row, startedAt: now, endsAt };
}

/** Cookie-ийн шалгалт — идэвхтэй биш бол null (ШИДЭХГҮЙ). */
export async function loadActiveSupportSession(
  raw: string | undefined | null,
  userId: string,
  now: Date = new Date()
): Promise<SupportSessionRow | null> {
  if (!raw) return null;
  const row = await findByToken(raw);
  if (!row || row.userId !== userId) return null;
  return isSupportSessionUsable(row, now) ? row : null;
}

/** Гарах — идэвхтэй эсэхээс үл хамааран хаана (идемпотент). */
export async function endSupportSession(
  selector: { token?: string | null; id?: string },
  now: Date = new Date()
): Promise<SupportSessionRow | null> {
  const row = selector.token
    ? await findByToken(selector.token)
    : selector.id
      ? await findById(selector.id)
      : null;
  if (!row) return null;
  if (!row.endedAt)
    await db
      .update(platformSupportSessions)
      .set({ endedAt: now })
      .where(eq(platformSupportSessions.id, row.id));
  return { ...row, endedAt: row.endedAt ?? now };
}

async function findById(id: string): Promise<SupportSessionRow | null> {
  const [row] = await db
    .select({
      id: platformSupportSessions.id,
      organizationId: platformSupportSessions.organizationId,
      orgName: organizations.name,
      userId: platformSupportSessions.userId,
      email: users.email,
      role: platformSupportSessions.role,
      reason: platformSupportSessions.reason,
      issuedBy: platformSupportSessions.issuedBy,
      expiresAt: platformSupportSessions.expiresAt,
      startedAt: platformSupportSessions.startedAt,
      endsAt: platformSupportSessions.endsAt,
      endedAt: platformSupportSessions.endedAt,
      createdAt: platformSupportSessions.createdAt,
    })
    .from(platformSupportSessions)
    .innerJoin(organizations, eq(platformSupportSessions.organizationId, organizations.id))
    .leftJoin(users, eq(platformSupportSessions.userId, users.id))
    .where(eq(platformSupportSessions.id, id))
    .limit(1);
  return row ? ({ ...row, role: row.role as SupportRole } as SupportSessionRow) : null;
}

export type SupportSessionView = Omit<
  SupportSessionRow,
  "expiresAt" | "startedAt" | "endsAt" | "endedAt" | "createdAt"
> & {
  state: SupportSessionState;
  expiresAt: string;
  startedAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  createdAt: string;
};

function toView(row: SupportSessionRow, now: Date): SupportSessionView {
  return {
    ...row,
    state: supportSessionState(row, now),
    expiresAt: row.expiresAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Console-ийн жагсаалт — байгууллагаар шүүж болно. */
export async function listSupportSessions(options?: {
  organizationId?: string;
  limit?: number;
}): Promise<SupportSessionView[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: platformSupportSessions.id,
      organizationId: platformSupportSessions.organizationId,
      orgName: organizations.name,
      userId: platformSupportSessions.userId,
      email: users.email,
      role: platformSupportSessions.role,
      reason: platformSupportSessions.reason,
      issuedBy: platformSupportSessions.issuedBy,
      expiresAt: platformSupportSessions.expiresAt,
      startedAt: platformSupportSessions.startedAt,
      endsAt: platformSupportSessions.endsAt,
      endedAt: platformSupportSessions.endedAt,
      createdAt: platformSupportSessions.createdAt,
    })
    .from(platformSupportSessions)
    .innerJoin(organizations, eq(platformSupportSessions.organizationId, organizations.id))
    .leftJoin(users, eq(platformSupportSessions.userId, users.id))
    .where(
      options?.organizationId
        ? eq(platformSupportSessions.organizationId, options.organizationId)
        : undefined
    )
    .orderBy(desc(platformSupportSessions.createdAt))
    .limit(Math.min(Math.max(options?.limit ?? 20, 1), 100));
  return rows.map((row) => toView({ ...row, role: row.role as SupportRole } as SupportSessionRow, now));
}

/**
 * Операторын одоогийн идэвхтэй сессүүд — cookie байхгүй ч баннер/гарах
 * товчинд хэрэгтэй биш; Console-ийн "идэвхтэй" тоололд ашиглагдана.
 */
export async function countActiveSupportSessions(organizationId?: string): Promise<number> {
  const now = new Date();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(platformSupportSessions)
    .where(
      and(
        isNull(platformSupportSessions.endedAt),
        sql`${platformSupportSessions.endsAt} > ${now}`,
        organizationId ? eq(platformSupportSessions.organizationId, organizationId) : undefined
      )
    );
  return row?.n ?? 0;
}

/** Байгууллагын гишүүнчлэл (Console-ийн дэлгэрэнгүйд). */
export async function loadOrgMembers(organizationId: string) {
  return await db
    .select({
      userId: memberships.userId,
      role: memberships.role,
      name: users.name,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .leftJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(memberships.createdAt);
}
