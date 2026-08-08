// Түр тест хэрэглэгч — Claude-ийн UI шалгалтад. Дараа нь устгаж болно.
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../lib/db";
import { users, chartOfAccounts, memberships, organizations } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

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

const NAME = "Claude Test";
const EMAIL = "claude-test@entry.mn";
const PASSWORD = "claude-test-2026";

async function main() {
  const existing = await db.query.users.findFirst({ where: eq(users.email, EMAIL) });
  if (existing) {
    console.log(`Тест хэрэглэгч аль хэдийн байна: ${EMAIL}`);
    process.exit(0);
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const [user] = await db.insert(users).values({ name: NAME, email: EMAIL, passwordHash }).returning();
  const [org] = await db.insert(organizations).values({ name: NAME }).returning();
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  await db.insert(chartOfAccounts).values(
    DEFAULT_ACCOUNTS.map((a) => ({ userId: user.id, organizationId: org.id, ...a }))
  );
  console.log(`✓ Тест хэрэглэгч үүслээ: ${EMAIL}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
