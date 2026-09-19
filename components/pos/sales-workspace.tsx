"use client";

// Борлуулалтын ажлын талбар — docs/pos §4.3: `PageTabs` 4 таб, URL `?tab=`.
// Таб бүрийн агуулга тусдаа файлд; өгөгдөл server хуудаснаас prop-оор ирж,
// мутацийн дараа `router.refresh()`-ээр шинэчлэгдэнэ.

import { useCallback, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { GiftCardsView, type GiftCardRow, type StoreCreditRow } from "@/components/pos/gift-cards-view";
import { PosSettingsView, type IssueTypeOption } from "@/components/pos/pos-settings-view";
import { SalesListView } from "@/components/pos/sales-list-view";
import { ShiftsView } from "@/components/pos/shifts-view";
import { PageTabs, type TabOption } from "@/components/ui/tabs";
import type { CheckoutData } from "@/lib/pos/load-data";
import type { PosSaleView, PosShiftView } from "@/lib/pos/types";

export type SalesTab = "sales" | "shifts" | "cards" | "settings";

const TABS: readonly TabOption<SalesTab>[] = [
  { value: "sales", label: "Борлуулалт" },
  { value: "shifts", label: "Ээлж" },
  { value: "cards", label: "Бэлгийн карт · кредит" },
  { value: "settings", label: "Тохиргоо" },
];

export function SalesWorkspace({
  initialTab,
  from,
  to,
  initialStatus,
  sales,
  shifts,
  giftCards,
  storeCredits,
  checkout,
  issueTypes,
}: {
  initialTab: SalesTab;
  from: string;
  to: string;
  initialStatus?: string;
  sales: PosSaleView[];
  shifts: PosShiftView[];
  giftCards: GiftCardRow[];
  storeCredits: StoreCreditRow[];
  checkout: CheckoutData;
  issueTypes: IssueTypeOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<SalesTab>(initialTab);

  const changeTab = useCallback(
    (next: SalesTab) => {
      setTab(next);
      const params = new URLSearchParams();
      params.set("tab", next);
      params.set("from", from);
      params.set("to", to);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, from, to]
  );

  const changeRange = useCallback(
    (nextFrom: string, nextTo: string) => {
      const params = new URLSearchParams();
      params.set("tab", tab);
      params.set("from", nextFrom);
      params.set("to", nextTo);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, tab]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">Борлуулалт</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          POS борлуулалт, буцаалт, ээлж, бэлгийн карт ба тохиргоо. Давхар даралт → дэлгэрэнгүй панель.
        </p>
      </div>
      <PageTabs tabs={TABS} value={tab} onChange={changeTab} size="md" />

      {tab === "sales" && (
        <SalesListView
          key={`${from}|${to}`}
          sales={sales}
          from={from}
          to={to}
          initialStatus={initialStatus}
          onRangeChange={changeRange}
        />
      )}
      {tab === "shifts" && (
        <ShiftsView
          shifts={shifts}
          cashAccounts={checkout.cashAccounts}
          warehouses={checkout.warehouses}
          defaultWarehouseId={checkout.settings.defaultWarehouseId}
        />
      )}
      {tab === "cards" && (
        <GiftCardsView
          giftCards={giftCards}
          storeCredits={storeCredits}
          methods={checkout.methods}
          customers={checkout.customers}
        />
      )}
      {tab === "settings" && <PosSettingsView checkout={checkout} issueTypes={issueTypes} />}
    </section>
  );
}
