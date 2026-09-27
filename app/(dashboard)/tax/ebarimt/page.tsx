// eBarimt баримтууд `/tax/ebarimt` — ТЕГ-д илгээсэн (эсвэл илгээх гэж буй) бүх
// баримт НЭГ дор: POS борлуулалт/буцаалт + АР нэхэмжлэх (docs/pos/05 Шат 2).
// Авлагын модульд ижил жагсаалт `/receivables/ebarimt`; өглөгийнх (худалдан
// авалтын баримт, ITC TPI) `/payables/ebarimt` — Монголын сүлжээний прокси
// бэлэн болмогц (docs/deployment/mongolia-network-runbook.md).

import { EbarimtDocumentsView } from "@/components/ebarimt/ebarimt-documents-view";
import { requireModuleAction } from "@/lib/auth";
import { loadEbarimtPageData } from "@/lib/ebarimt/list-page";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function EbarimtDocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { orgId } = await requireModuleAction("tax", "read");
  const data = await loadEbarimtPageData(orgId, await searchParams);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">eBarimt баримтууд</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          ТЕГ-д илгээсэн борлуулалтын баримт, нэхэмжлэх — POS ба авлагын модулиас. Давхар даралт → эх баримтын панель
          (дахин илгээх тэндээс).
        </p>
      </div>
      <EbarimtDocumentsView {...data} />
    </section>
  );
}
