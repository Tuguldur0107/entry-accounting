import { redirect } from "next/navigation";

import { BillingOverviewView } from "@/components/settings/billing-overview-view";
import { BillingSelfPay } from "@/components/settings/billing-self-pay";
import { getBillingOverview } from "@/lib/actions/billing";
import { getActiveOrg } from "@/lib/auth";
import { hasFeature } from "@/lib/billing/entitlements";
import { loadSubscription } from "@/lib/billing/load";
import { billingQpayConfig, listBillingPayments, loadSelfPayOptions } from "@/lib/billing/payment-store";
import { ROLE_RANK } from "@/lib/permissions";

export const metadata = { title: "Багц, төлбөр — Entry Accounting" };
export const dynamic = "force-dynamic";

// Байгууллагын багц (docs/billing/00-proposal.md §5) — гишүүн бүр харна. Багцаа
// QPay-ээр ӨӨРӨӨ төлөх (§6a) нь эзэн/админд; багц солих, тусгай нөхцөл Entry
// Console /api/platform/subscriptions-ээр.
export default async function BillingPage() {
  const overview = await getBillingOverview();
  // «AI нягтлан» (skills) — төлбөр, холболт нүүрний НЭГ хуудсанд (давхардахгүй).
  if (!hasFeature(overview.entitlements, "accounting")) redirect("/");
  if (overview.entitlements.mode !== "saas") return <BillingOverviewView overview={overview} />;

  const { orgId, role } = await getActiveOrg();
  const [options, payments, subscription] = await Promise.all([
    loadSelfPayOptions(orgId),
    listBillingPayments(orgId),
    loadSubscription(orgId),
  ]);
  const paidThrough = subscription?.currentPeriodEnd?.toISOString() ?? null;
  return (
    <BillingOverviewView
      overview={overview}
      selfPay={
        <BillingSelfPay
          options={options}
          ready={billingQpayConfig().config !== null}
          canPay={ROLE_RANK[role] >= ROLE_RANK.admin}
          paidThrough={paidThrough}
          payments={payments}
        />
      }
    />
  );
}
