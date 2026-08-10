"use server";

import { db } from "@/lib/db";
import {
  users,
  chartOfAccounts,
  memberships,
  orgInvitations,
} from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { createPersonalOrg, signIn } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { DEFAULT_ACCOUNTS } from "@/lib/constants/standard-accounts";

export async function registerUser(data: {
  name: string;
  email: string;
  password: string;
  /** Урилгын token (/register?invite=...) — байвал урьсан байгууллагад шууд элсэнэ. */
  invite?: string;
}) {
  // Server-side шалгалт — client формыг тойрч шууд дуудахад ч хүчинтэй.
  const name = data.name?.trim() ?? "";
  const email = data.email?.trim().toLowerCase() ?? "";
  if (!name) return { error: "Нэрээ оруулна уу" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { error: "Имэйл хаяг буруу байна" };
  if (typeof data.password !== "string" || data.password.length < 8)
    return { error: "Нууц үг 8-аас доошгүй тэмдэгттэй байна" };

  // Нэг имэйл дээр цагт 5 бүртгэлийн оролдлого — бот/спамаас хамгаална.
  if (!checkRateLimit(`register:${email}`, 5, 60 * 60_000))
    return { error: "Хэт олон оролдлого — түр хүлээнэ үү" };

  // Login case-insensitive хайдаг тул давхардлыг ч мөн case-insensitive шалгана.
  const existing = await db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${email}`,
  });
  if (existing) return { error: "Энэ имэйл бүртгэлтэй байна" };

  const passwordHash = await bcrypt.hash(data.password, 12);

  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash })
    .returning();

  // Фаз 01: шинэ хэрэглэгч бүр personal байгууллагатай төрнө — org гэдэг
  // ойлголтыг анзааралгүйгээр ажиллаж чадна (спекийн хатуу дүрэм).
  const orgId = await createPersonalOrg(user.id, name);

  // Seed default chart of accounts
  await db.insert(chartOfAccounts).values(
    DEFAULT_ACCOUNTS.map((a) => ({ userId: user.id, organizationId: orgId, ...a }))
  );

  // Урилгын линкээр ирсэн бол урьсан байгууллагад элсүүлж, түүнийг нь
  // идэвхтэй байгууллага болгоно. Token буруу/ашиглагдсан бол чимээгүй
  // алгасна — бүртгэл өөрөө хэвийн үргэлжилнэ.
  if (data.invite && /^[0-9a-f-]{36}$/.test(data.invite)) {
    const invitation = await db.query.orgInvitations.findFirst({
      where: and(
        eq(orgInvitations.token, data.invite),
        sql`${orgInvitations.acceptedAt} is null`
      ),
    });
    if (invitation) {
      await db
        .insert(memberships)
        .values({
          organizationId: invitation.organizationId,
          userId: user.id,
          role: invitation.role,
        })
        .onConflictDoNothing();
      await db
        .update(orgInvitations)
        .set({ acceptedAt: new Date() })
        .where(eq(orgInvitations.id, invitation.id));
      try {
        (await cookies()).set("ea-org", invitation.organizationId, {
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        });
      } catch {
        // cookie тавигдахгүй бол switcher-ээс сонгоно — элсэлт хүчинтэй хэвээр.
      }
    }
  }

  // Credentials provider талбарын нэр нь `identifier` (login формтой ижил).
  await signIn("credentials", {
    identifier: email,
    password: data.password,
    redirectTo: "/gl/journal",
  });
}
