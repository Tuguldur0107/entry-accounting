"use server";

import { db } from "@/lib/db";
import { users, chartOfAccounts } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { createPersonalOrg, signIn } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { DEFAULT_ACCOUNTS } from "@/lib/constants/standard-accounts";

export async function registerUser(data: {
  name: string;
  email: string;
  password: string;
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

  await signIn("credentials", {
    email,
    password: data.password,
    redirectTo: "/gl/journal",
  });
}
