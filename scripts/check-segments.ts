import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../lib/db/schema";
import { eq } from "drizzle-orm";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

async function main() {
  const users = await db.query.users.findMany();
  const userId = users[0].id;

  const segs = await db.query.segmentConfigs.findMany({
    where: eq(schema.segmentConfigs.userId, userId),
  });
  const vals = await db.query.segmentValues.findMany({
    where: eq(schema.segmentValues.userId, userId),
  });

  console.log("SEGMENT CONFIGS:", JSON.stringify(segs, null, 2));
  console.log("SEGMENT VALUES:", JSON.stringify(vals, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
