import { AsyncLocalStorage } from "node:async_hooks";

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ensureCashFlowSegmentValues } from "@/lib/gl/segment-sync";
import {
  memberships,
  organizations,
  users,
  type MembershipRole,
} from "@/lib/db/schema";
import { and, asc, eq, or, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { deploymentLicenseStatus } from "@/lib/licensing/license";
import { effectiveLevel, hasModuleLevel, ROLE_RANK, type PermissionLevel } from "@/lib/permissions";
import authConfig from "@/lib/auth.config";
import { SUPPORT_COOKIE, type SupportRole } from "@/lib/platform/support";
import {
  loadActiveSupportSession,
  type SupportSessionRow,
} from "@/lib/platform/support-store";
import { checkRateLimit } from "@/lib/rate-limit";
import { assertModuleEntitlements } from "@/lib/billing/guards";

const { handlers, auth: sessionAuth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        identifier: { label: "Нэвтрэх нэр", type: "text" },
        password: { label: "Нууц үг", type: "password" },
      },
      async authorize(credentials) {
        // Deployment-ийн лиценз (offline шалгалт, dev-д үргэлж нээлттэй) —
        // Console-оор provision хийгдээгүй хуулбар нэвтрэлт хүлээж авахгүй.
        // Тайлбар текстийг login хуудас /api/health-ээс авч үзүүлнэ.
        if (!deploymentLicenseStatus().ok) return null;

        if (!credentials?.identifier || !credentials?.password) return null;

        const id = (credentials.identifier as string).toLowerCase().trim();

        // Brute-force хамгаалалт: нэг identifier дээр 5 минутад 10 оролдлого.
        // Хэтэрвэл null — NextAuth ердийн "нэвтрэлт амжилтгүй" харуулна.
        if (!checkRateLimit(`login:${id}`, 10, 5 * 60_000)) return null;

        // Case-insensitive: email эсвэл нэрээр хайна
        const user = await db.query.users.findFirst({
          where: or(
            sql`lower(${users.email}) = ${id}`,
            sql`lower(${users.name}) = ${id}`
          ),
        });

        if (!user) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );
        if (!valid) return null;

        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
});

// ── Token-аар танигдсан замын impersonation ─────────────────────────────────
// MCP endpoint зэрэг session cookie-гүй зам Personal Access Token-оор
// хэрэглэгчээ таниад runAsUser() дотор server action-уудыг ажиллуулна —
// action доторх auth() дуудлагууд тухайн хэрэглэгчийн session мэт хариулна.
// Ердийн (cookie-той) замд огт нөлөөлөхгүй: ALS store хоосон үед жинхэнэ
// NextAuth session руу шууд дамжина.

type ImpersonationStore = { userId: string; orgId?: string };

const impersonation = new AsyncLocalStorage<ImpersonationStore>();

/** fn доторх бүх auth() дуудлагад userId-г session болгож өгнө. */
export function runAsUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return impersonation.run({ userId }, fn);
}

/**
 * Фаз 01: MCP token org-т уягдсан үед — fn доторх auth() нь userId-гаар,
 * getActiveOrg() нь orgId-гаар хариулна.
 */
export function runAsOrg<T>(
  ctx: { userId: string; orgId: string },
  fn: () => Promise<T>
): Promise<T> {
  return impersonation.run(ctx, fn);
}

// ── Идэвхтэй байгууллага (Фаз 01 multi-tenancy) ─────────────────────────────
// Бизнесийн БҮХ server action scope-оо эндээс авна. Client-ээс orgId
// параметрээр ХЭЗЭЭ Ч хүлээж авахгүй (IDOR): сонголт нь ea-org cookie-д,
// гэхдээ гишүүнчлэлээр ЗААВАЛ баталгаажина.

export type ActiveOrg = {
  orgId: string;
  userId: string;
  role: MembershipRole;
};

const ORG_COOKIE = "ea-org";

const ROLE_ORDER = ROLE_RANK;

/** Хэрэглэгчид personal байгууллага үүсгэнэ (нэр = хэрэглэгчийн нэр). */
export async function createPersonalOrg(
  userId: string,
  name: string
): Promise<string> {
  const orgId = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: name.trim() || "Миний байгууллага" })
      .returning({ id: organizations.id });
    await tx.insert(memberships).values({
      organizationId: org.id,
      userId,
      role: "owner",
    });
    return org.id;
  });
  // SIM2-014: мөнгөн гүйлгээний S8 ангилал шинэ байгууллагад бэлэн байна.
  await ensureCashFlowSegmentValues(orgId, userId).catch((caught) =>
    console.error("[createPersonalOrg] S8 seed", caught)
  );
  return orgId;
}

// ── Дэмжлэгийн хандалт (Console-оос олгогдсон түр сесс) ─────────────────────
// Гишүүнчлэлгүй ч ТУХАЙН нэг байгууллагад, ХУГАЦААТАЙ, cookie-д байгаа token
// хүчинтэй үед л. Эрх нь хэрэглэгчид биш СЕССЭД уягдана (lib/platform/support.ts):
// viewer = зөвхөн унших (default), admin = бичих; owner ХЭЗЭЭ Ч олгогдохгүй тул
// байгууллага устгах / эзэмшил шилжүүлэх нь харилцагчийнхаа мэдэлд үлдэнэ.

async function supportCookie(): Promise<string | null> {
  try {
    return (await cookies()).get(SUPPORT_COOKIE)?.value ?? null;
  } catch {
    // cookies() зөвхөн request context-д — scheduler/script-аас дуудвал үгүй.
    return null;
  }
}

/** Идэвхтэй дэмжлэгийн сесс (cookie + DB шалгалт) эсвэл null — ШИДЭХГҮЙ. */
export async function currentSupportSession(
  userId?: string
): Promise<SupportSessionRow | null> {
  // Token-оор танигдсан зам (MCP/REST) дэмжлэгийн сессийг ХЭРЭГЛЭХГҮЙ —
  // API token өөрийн scope-той, support нь зөвхөн браузерын сесст.
  if (impersonation.getStore()) return null;
  const raw = await supportCookie();
  if (!raw) return null;
  const who = userId ?? (await sessionAuth())?.user?.id;
  if (!who) return null;
  return await loadActiveSupportSession(raw, who);
}

/** Топбарын баннерт — идэвхтэй сессийн товч мэдээлэл. */
export async function getSupportBanner(): Promise<{
  orgName: string;
  role: SupportRole;
  endsAt: string;
} | null> {
  const row = await currentSupportSession();
  if (!row || !row.endsAt) return null;
  return { orgName: row.orgName, role: row.role, endsAt: row.endsAt.toISOString() };
}

export async function getActiveOrg(): Promise<ActiveOrg> {
  // 1. Token-оор танигдсан зам (MCP): store-д orgId нь шууд байна.
  const store = impersonation.getStore();
  if (store?.orgId) {
    const membership = await db.query.memberships.findFirst({
      where: and(
        eq(memberships.organizationId, store.orgId),
        eq(memberships.userId, store.userId)
      ),
      columns: { role: true },
    });
    if (!membership) throw new Error("Байгууллагын гишүүнчлэл олдсонгүй");
    return {
      orgId: store.orgId,
      userId: store.userId,
      role: membership.role as MembershipRole,
    };
  }

  const session = await auth();
  const userId = store?.userId ?? session?.user?.id;
  if (!userId) throw new Error("Нэвтрэх шаардлагатай");

  // 2. Дэмжлэгийн сесс — гишүүнчлэлээс ӨМНӨ шалгана: идэвхтэй үед scope нь
  //    ТЭР байгууллага болж, оператор өөрийн байгууллага руугаа санамсаргүй
  //    бичихээс сэргийлнэ. Гарах = cookie цэвэрлэх (/api/support/exit).
  const support = await currentSupportSession(userId);
  if (support)
    return {
      orgId: support.organizationId,
      userId,
      role: support.role as MembershipRole,
    };

  const rows = await db.query.memberships.findMany({
    where: eq(memberships.userId, userId),
    columns: { organizationId: true, role: true },
    orderBy: [asc(memberships.createdAt)],
  });

  // Гишүүнчлэлгүй хэрэглэгч (backfill-ээс өмнөх онцгой байдал) —
  // personal org автоматаар үүсгэнэ.
  if (rows.length === 0) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { name: true, email: true },
    });
    // Session нь хүчинтэй ч хэрэглэгч нь DB-ээс устсан (ghost session) —
    // personal org үүсгэх гэж FK-гаар унахын оронд cookie цэвэрлэх route
    // руу чиглүүлнэ (/login руу шууд буцаавал proxy эргүүлж loop үүсгэнэ).
    if (!user) redirect("/api/auth/ghost");
    const orgId = await createPersonalOrg(
      userId,
      user.name || user.email?.split("@")[0] || "Миний байгууллага"
    );
    return { orgId, userId, role: "owner" };
  }

  // Cookie-гийн сонголт гишүүнчлэлд байвал түүнийг, үгүй бол эхнийхийг.
  let chosen = rows[0];
  try {
    const cookieOrg = (await cookies()).get(ORG_COOKIE)?.value;
    if (cookieOrg) {
      const match = rows.find((row) => row.organizationId === cookieOrg);
      if (match) chosen = match;
    }
  } catch {
    // cookies() зөвхөн request context-д — script/task-аас дуудвал эхнийх.
  }
  return {
    orgId: chosen.organizationId,
    userId,
    role: chosen.role as MembershipRole,
  };
}

/**
 * Эрхийн шалгалт: getActiveOrg + доод түвшний role шаардана.
 *   viewer → зөвхөн унших · accountant → бичилт/батлах ·
 *   admin+ → период хаах, тохиргоо, гишүүд · owner → байгууллага устгах
 */
export async function requireRole(
  minRole: MembershipRole
): Promise<ActiveOrg> {
  const active = await getActiveOrg();
  if (ROLE_ORDER[active.role] < ROLE_ORDER[minRole])
    throw new Error("Энэ үйлдэлд таны эрх хүрэлцэхгүй байна");
  return active;
}

/**
 * Модулийн нарийн эрхийн шалгалт (lib/permissions.ts): owner/admin үргэлж
 * бүрэн; accountant/viewer-ийн эрх memberships.permissions override +
 * role default-аас гарна. Тухайн модульд шаардсан түвшинд хүрэхгүй бол
 * монгол текстээр ШИДНЭ (action wrapper-ууд { error } болгож буцаадаг).
 */
export async function requireModuleAction(
  moduleKey: string,
  needed: "read" | "write" | "post"
): Promise<ActiveOrg> {
  const active = await getActiveOrg();
  // Багц (docs/billing §4) НЭГ цэгээс: нягтлан бодох систем багцад байх
  // («AI нягтлан» багцад уншилт ч хаалттай) + read-only (trial дууссан,
  // төлбөр хоцорсон…) үед бичилт/батлалт хаалттай; dedicated-д давна.
  await assertModuleEntitlements(active.orgId, needed !== "read");
  if (ROLE_ORDER[active.role] >= ROLE_ORDER.admin) return active;

  const membership = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.organizationId, active.orgId),
      eq(memberships.userId, active.userId)
    ),
    columns: { permissions: true },
  });
  if (!hasModuleLevel(active.role, membership?.permissions, moduleKey, needed)) {
    const label = MODULE_ACTION_LABELS[needed];
    throw new Error(
      `Танд энэ модульд ${label} эрх олгогдоогүй байна — Тохиргоо → Хэрэглэгчдийн эрх хэсгээс админ олгоно`
    );
  }
  return active;
}

/**
 * Модулиудын БОДИТ түвшин — ШИДЭХГҮЙ. Route guard (модулийн layout) ба
 * навигаци үүгээр "none" модулийг хаана; server action-ууд харин
 * requireModuleAction-оор ШИДЭЖ хаадаг хэвээр (давхар хамгаалалт).
 */
export async function moduleAccess(
  moduleKeys: string[]
): Promise<{ active: ActiveOrg; levels: Record<string, PermissionLevel> }> {
  const active = await getActiveOrg();
  const membership =
    ROLE_ORDER[active.role] >= ROLE_ORDER.admin
      ? null
      : await db.query.memberships.findFirst({
          where: and(
            eq(memberships.organizationId, active.orgId),
            eq(memberships.userId, active.userId)
          ),
          columns: { permissions: true },
        });
  const levels: Record<string, PermissionLevel> = {};
  for (const key of moduleKeys)
    levels[key] = effectiveLevel(active.role, membership?.permissions, key);
  return { active, levels };
}

/** Аль нэг нь хүрэлцэхэд хангалттай (ж: харилцагч — АР эсвэл АП бичих эрх). */
export async function requireAnyModuleAction(
  checks: [string, "read" | "write" | "post"][]
): Promise<ActiveOrg> {
  const active = await getActiveOrg();
  await assertModuleEntitlements(active.orgId, checks.some(([, needed]) => needed !== "read"));
  if (ROLE_ORDER[active.role] >= ROLE_ORDER.admin) return active;

  const membership = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.organizationId, active.orgId),
      eq(memberships.userId, active.userId)
    ),
    columns: { permissions: true },
  });
  const ok = checks.some(([moduleKey, needed]) =>
    hasModuleLevel(active.role, membership?.permissions, moduleKey, needed)
  );
  if (!ok) {
    const label = MODULE_ACTION_LABELS[checks[0]?.[1] ?? "write"];
    throw new Error(
      `Танд энэ үйлдэлд ${label} эрх олгогдоогүй байна — Тохиргоо → Хэрэглэгчдийн эрх хэсгээс админ олгоно`
    );
  }
  return active;
}

const MODULE_ACTION_LABELS: Record<"read" | "write" | "post", string> = {
  read: "унших",
  write: "бичих",
  post: "батлах",
};

export const auth: typeof sessionAuth = ((
  ...args: Parameters<typeof sessionAuth>
) => {
  const store = impersonation.getStore();
  if (store !== undefined) {
    return Promise.resolve({
      user: { id: store.userId },
      expires: "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sessionAuth as any)(...args);
}) as typeof sessionAuth;

export { handlers, signIn, signOut };
