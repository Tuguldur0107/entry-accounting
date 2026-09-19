// Борлуулалт `/inventory/sales` — docs/pos/00-proposal.md §4.3, §4.5.
// 4 таб (Борлуулалт / Ээлж / Бэлгийн карт·кредит / Тохиргоо) — URL `?tab=`.
// Огнооны муж: URL `from`/`to` → байхгүй бол topbar-ын периодын сонголт
// (CLAUDE.md §4 — ил параметр cookie-г дарна).

import { SalesWorkspace, type SalesTab } from "@/components/pos/sales-workspace";
import { getGiftCardsAndCredits } from "@/lib/actions/pos";
import { requireModuleAction } from "@/lib/auth";
import { loadIssueTypes } from "@/lib/costing/master-data";
import { getPeriodSelection } from "@/lib/periods/selection";
import { POS_MODULE_KEY } from "@/lib/pos/constants";
import { loadCheckoutData, loadSaleViews, loadShiftViews } from "@/lib/pos/load-data";

type SearchParams = Promise<{ tab?: string; from?: string; to?: string; status?: string }>;

const TABS: SalesTab[] = ["sales", "shifts", "cards", "settings"];
const isDate = (value: string | undefined): value is string =>
  /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");

export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
  const params = await searchParams;
  const period = await getPeriodSelection();
  const from = isDate(params.from) ? params.from : period.from;
  const to = isDate(params.to) ? params.to : period.to;
  const tab = TABS.includes(params.tab as SalesTab) ? (params.tab as SalesTab) : "sales";

  const [checkout, sales, shifts, cards, issueTypes] = await Promise.all([
    loadCheckoutData(orgId, userId),
    loadSaleViews(orgId, { from, to }),
    loadShiftViews(orgId),
    getGiftCardsAndCredits(),
    loadIssueTypes(orgId, { activeOnly: true }),
  ]);

  return (
    <SalesWorkspace
      initialTab={tab}
      from={from}
      to={to}
      initialStatus={params.status}
      sales={sales}
      shifts={shifts}
      giftCards={cards.error ? [] : (cards.giftCards ?? [])}
      storeCredits={cards.error ? [] : (cards.storeCredits ?? [])}
      checkout={checkout}
      issueTypes={issueTypes.map((entry) => ({ id: entry.id, code: entry.code, name: entry.name }))}
    />
  );
}
