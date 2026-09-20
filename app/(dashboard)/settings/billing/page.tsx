import { BillingOverviewView } from "@/components/settings/billing-overview-view";
import { getBillingOverview } from "@/lib/actions/billing";

export const metadata = { title: "Багц, төлбөр — Entry Accounting" };
export const dynamic = "force-dynamic";

// Байгууллагын багц (docs/billing/00-proposal.md §5) — гишүүн бүр харна,
// засварыг platform admin /admin/platform дээр хийнэ (төлбөрийн гарц фаз 2).
export default async function BillingPage() {
  const overview = await getBillingOverview();
  return <BillingOverviewView overview={overview} />;
}
