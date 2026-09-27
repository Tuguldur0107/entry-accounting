import { RecurringView } from "@/components/arap/recurring-view";
import { getRecurringInvoices } from "@/lib/actions/ar-recurring";

// Давтамжтай нэхэмжлэх (docs/dev/arap.md §5h) — загварууд, дараагийн огноо, төлөв.
export default async function ReceivablesRecurringPage() {
  const result = await getRecurringInvoices();
  if (result.error !== undefined) return <RecurringView rows={null} error={result.error} />;
  return <RecurringView rows={result.rows} error={null} />;
}
