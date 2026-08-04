import { AsyncLocalStorage } from "node:async_hooks";

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { or, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import authConfig from "@/lib/auth.config";

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

const impersonation = new AsyncLocalStorage<string>();

/** fn доторх бүх auth() дуудлагад userId-г session болгож өгнө. */
export function runAsUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return impersonation.run(userId, fn);
}

export const auth: typeof sessionAuth = ((
  ...args: Parameters<typeof sessionAuth>
) => {
  const userId = impersonation.getStore();
  if (userId !== undefined) {
    return Promise.resolve({
      user: { id: userId },
      expires: "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sessionAuth as any)(...args);
}) as typeof sessionAuth;

export { handlers, signIn, signOut };
