import { AsyncLocalStorage } from "node:async_hooks";

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  memberships,
  organizations,
  users,
  type MembershipRole,
} from "@/lib/db/schema";
import { and, asc, eq, or, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import authConfig from "@/lib/auth.config";
import { checkRateLimit } from "@/lib/rate-limit";

const { handlers, auth: sessionAuth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        identifier: { label: "Нэвтрэх нэр", type: "text" },
        password: { label: "Нууц үг", type: "password" },
      },
      async authorize(credentials) {
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

const ROLE_ORDER: Record<MembershipRole, number> = {
  viewer: 0,
  accountant: 1,
  admin: 2,
  owner: 3,
};

/** Хэрэглэгчид personal байгууллага үүсгэнэ (нэр = хэрэглэгчийн нэр). */
export async function createPersonalOrg(
  userId: string,
  name: string
): Promise<string> {
  return await db.transaction(async (tx) => {
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
    const orgId = await createPersonalOrg(
      userId,
      user?.name || user?.email?.split("@")[0] || "Миний байгууллага"
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
