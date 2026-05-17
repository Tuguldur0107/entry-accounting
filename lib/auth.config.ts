import type { NextAuthConfig } from "next-auth";

// Edge-safe config: no providers, no DB, no bcrypt.
// Middleware imports this directly so it can run on the Edge runtime
// without pulling in postgres-js or bcryptjs at module load.
// lib/auth.ts extends this with the Credentials provider.
export default {
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
