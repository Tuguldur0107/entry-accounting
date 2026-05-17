"use server";

import { db } from "@/lib/db";
import { users, chartOfAccounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { signIn } from "@/lib/auth";
import { DEFAULT_ACCOUNTS } from "@/lib/constants/standard-accounts";

export async function registerUser(data: {
  name: string;
  email: string;
  password: string;
}) {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, data.email),
  });
  if (existing) return { error: "Энэ имэйл бүртгэлтэй байна" };

  const passwordHash = await bcrypt.hash(data.password, 12);

  const [user] = await db
    .insert(users)
    .values({ name: data.name, email: data.email, passwordHash })
    .returning();

  // Seed default chart of accounts
  await db.insert(chartOfAccounts).values(
    DEFAULT_ACCOUNTS.map((a) => ({ userId: user.id, ...a }))
  );

  await signIn("credentials", {
    email: data.email,
    password: data.password,
    redirectTo: "/gl/journal",
  });
}
