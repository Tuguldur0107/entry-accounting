import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { STANDARD_ACCOUNTS } from "../lib/constants/standard-accounts";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

async function main() {
  const users = await db.query.users.findMany();
  const userId = users[0].id;
  const membership = await db.query.memberships.findFirst({
    where: eq(schema.memberships.userId, userId),
    columns: { organizationId: true },
  });
  if (!membership) { console.error("Гишүүнчлэл олдсонгүй — эхлээд migration ажиллуул."); process.exit(1); }
  const organizationId = membership.organizationId;
  const existing = await db.query.chartOfAccounts.findMany({
    where: eq(schema.chartOfAccounts.organizationId, organizationId),
  });
  const existingNums = new Set(existing.map((a) => a.number));
  const toAdd = STANDARD_ACCOUNTS.filter((a) => !existingNums.has(a.number));
  if (toAdd.length === 0) { console.log("Бүх стандарт данс аль хэдийн байна."); process.exit(0); }
  await db.insert(schema.chartOfAccounts).values(
    toAdd.map((a) => ({ userId, organizationId, number: a.number, name: a.name }))
  );
  console.log(`Нэмлэа: ${toAdd.length} данс. Нийт: ${existing.length + toAdd.length}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
