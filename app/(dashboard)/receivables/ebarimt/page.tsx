// Авлага → eBarimt `/receivables/ebarimt` — борлуулалтын eBarimt баримтууд
// (АР нэхэмжлэх + POS, POS эрхтэй бол). `/tax/ebarimt`-тэй НЭГ ачаалагч, НЭГ харагдац.

import { EbarimtDocumentsView } from "@/components/ebarimt/ebarimt-documents-view";
import { requireModuleAction } from "@/lib/auth";
import { loadEbarimtPageData } from "@/lib/ebarimt/list-page";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ReceivablesEbarimtPage({ searchParams }: { searchParams: SearchParams }) {
  const { orgId } = await requireModuleAction("ar", "read");
  const data = await loadEbarimtPageData(orgId, await searchParams);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">eBarimt — борлуулалт</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Авлагын нэхэмжлэх ба POS борлуулалтын ТЕГ-д илгээсэн баримт — ДДТД, төлөв, алдаа. Давхар даралт → эх баримтын
          панель (дахин илгээх тэндээс).
        </p>
      </div>
      <EbarimtDocumentsView {...data} />
    </section>
  );
}
