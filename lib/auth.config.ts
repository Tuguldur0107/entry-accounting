import type { NextAuthConfig } from "next-auth";

// Edge-safe config: no providers, no DB, no bcrypt.
// Middleware imports this directly so it can run on the Edge runtime
// without pulling in postgres-js or bcryptjs at module load.
// lib/auth.ts extends this with the Credentials provider.
export default {
  // Энэ апп нь reverse proxy-ийн ард ажилладаг (Railway, Nginx, харилцагчийн
  // өөрийн сервер). NextAuth v5 нь Vercel-ээс бусад орчинд host-оо
  // АНХНААСАА итгэдэггүй тул нэвтрэх/бүртгүүлэх нь «UntrustedHost» алдаагаар
  // унадаг — хэрэглэгчид «There was a problem with the server configuration»
  // гэж харагдана. `AUTH_TRUST_HOST` орчны хувьсагчаас хамааруулбал
  // нэвтрүүлэлт бүрд мартагдах эрсдэлтэй тул кодод шууд тавьсан.
  trustHost: true,
  providers: [],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
} satisfies NextAuthConfig;
