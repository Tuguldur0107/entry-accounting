// Хуваарьт мэдэгдлийг гараар ажиллуулах (backfill, тест, дэмжлэг):
//   npx tsx scripts/run-notifications.ts            # Улаанбаатарын өнөөдөр
//   npx tsx scripts/run-notifications.ts 2026-09-19 # тухайн өдөр
// Байгууллага × өдөр нэг л удаа ажиллах тул давтан дуудахад аюулгүй.

import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { runDailyNotifications } = await import("../lib/notifications/scheduler");
  const date = process.argv[2];
  const result = await runDailyNotifications(date);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
