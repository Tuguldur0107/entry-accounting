import { RemindersView } from "@/components/arap/reminders-view";
import { getArReminderOverview } from "@/lib/actions/ar-reminders";

// Төлбөрийн автомат сануулга (docs/dev/arap.md §5g) — тохиргоо + илгээсэн түүх.
export default async function ReceivablesRemindersPage() {
  const overview = await getArReminderOverview();
  if (overview.error !== undefined) return <RemindersView overview={null} error={overview.error} />;
  return <RemindersView overview={overview} error={null} />;
}
