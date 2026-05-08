"use server";

import { db } from "@/lib/db";
import { users, chartOfAccounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { signIn } from "@/lib/auth";

const DEFAULT_ACCOUNTS = [
  { number: "11210000", name: "Касс" },
  { number: "11000001", name: "Харилцах данс" },
  { number: "13110000", name: "Авлага" },
  { number: "31000001", name: "Өглөг (AP)" },
  { number: "31410000", name: "НӨАТ өглөг" },
  { number: "41100000", name: "Эздийн өмч" },
  { number: "44000001", name: "Хуримтлагдсан ашиг" },
  { number: "51100000", name: "Борлуулалтын орлого" },
  { number: "61100000", name: "Үндсэн үйл ажиллагааны зардал" },
  { number: "72100000", name: "Цалингийн зардал" },
];

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
