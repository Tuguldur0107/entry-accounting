// Борлуулалт `/inventory/sales` — docs/pos/00-proposal.md §4.3, §4.5.
// Ээлж · Бэлгийн карт·кредит · Тохиргоо нь ТУСДАА нав цэс болсон
// (`/inventory/shifts`, `/inventory/gift-cards`, `/inventory/pos-settings`) —
// хуудас бүр ЗӨВХӨН өөрийн өгөгдлөө ачаална. Хуучин `?tab=` линк redirect.
// Огнооны муж: URL `from`/`to` → байхгүй бол topbar-ын периодын сонголт
// (CLAUDE.md §4 — ил параметр cookie-г дарна).

import { redirect } from "next/navigation";

import { SalesPageView } from "@/components/pos/sales-page-view";
import { requireModuleAction } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { POS_MODULE_KEY } from "@/lib/pos/constants";
import { loadSaleViews } from "@/lib/pos/load-data";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Хуучин `?tab=` → шинэ зам (бусад параметр дагаж явна). */
const LEGACY_TAB_PATHS: Record<string, string> = {
  shifts: "/inventory/shifts",
  cards: "/inventory/gift-cards",
  settings: "/inventory/pos-settings",
};

const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  const { orgId } = await requireModuleAction(POS_MODULE_KEY, "read");
  const params = await searchParams;

  const tab = typeof params.tab === "string" ? params.tab : undefined;
  const legacy = tab ? LEGACY_TAB_PATHS[tab] : undefined;
  if (legacy) {
    const forwarded = new URLSearchParams();
    for (const [key, value] of Object.entries(params))
      if (key !== "tab" && typeof value === "string") forwarded.set(key, value);
    const query = forwarded.toString();
    redirect(query ? `${legacy}?${query}` : legacy);
  }

  const period = await getPeriodSelection();
  const from = isDate(params.from) ? params.from : period.from;
  const to = isDate(params.to) ? params.to : period.to;
  const sales = await loadSaleViews(orgId, { from, to });

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">Борлуулалт</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          POS борлуулалт ба буцаалт. Давхар даралт → дэлгэрэнгүй панель.
        </p>
      </div>
      <SalesPageView
        from={from}
        to={to}
        initialStatus={typeof params.status === "string" ? params.status : undefined}
        sales={sales}
      />
    </section>
  );
}
