// Хуваарьт мэдэгдлийг гараар ажиллуулах (backfill, тест, дэмжлэг):
//   npx tsx scripts/run-notifications.ts            # Улаанбаатарын өнөөдөр
//   npx tsx scripts/run-notifications.ts 2026-09-19 # тухайн өдөр
// Өдрийн дүрмүүд + и-мэйл + нэмэлт сувгуудын хүргэлтийг бүгдийг ажиллуулна.
// Байгууллага × өдөр нэг л удаа ажиллах тул давтан дуудахад аюулгүй.

import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { runDailyNotifications } = await import("../lib/notifications/scheduler");
  const { deliverPendingEmails } = await import("../lib/notifications/email-delivery");
  const { deliverPendingChannels } = await import("../lib/notifications/channel-delivery");
  const date = process.argv[2];
  const daily = await runDailyNotifications(date);
  const email = await deliverPendingEmails();
  const channels = await deliverPendingChannels();
  console.log(JSON.stringify({ daily, email, channels }, null, 2));
  process.exit(daily.errors.length + email.errors.length + channels.errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
