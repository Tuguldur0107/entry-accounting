// Авлага → eBarimt `/receivables/ebarimt` — борлуулалтын eBarimt баримтууд
// (АР нэхэмжлэх + POS, POS эрхтэй бол). `/tax/ebarimt`-тэй НЭГ ачаалагч, НЭГ харагдац.
// `?view=tax` — ТЕГ-ийн TPI-ээс татсан нэхэмжлэхийн үлдэгдлийн тулгалт
// (docs/dev/ebarimt-tax-reconcile.md).

import { EbarimtDocumentsView } from "@/components/ebarimt/ebarimt-documents-view";
import { EbarimtTaxCheckView } from "@/components/ebarimt/ebarimt-tax-check-view";
import { EbarimtViewTabs } from "@/components/ebarimt/ebarimt-view-tabs";
import { moduleAccess, requireModuleAction } from "@/lib/auth";
import { loadEbarimtPageData } from "@/lib/ebarimt/list-page";
import { loadEbarimtTaxChecks, loadTpiConnectionRow } from "@/lib/ebarimt/tax-sync";
import { PERMISSION_RANK } from "@/lib/permissions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ReceivablesEbarimtPage({ searchParams }: { searchParams: SearchParams }) {
  const { orgId } = await requireModuleAction("ar", "read");
  const params = await searchParams;
  const view = params.view === "tax" ? "tax" : "documents";
  const connection = await loadTpiConnectionRow(orgId);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">eBarimt — борлуулалт</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          {view === "tax"
            ? "ТЕГ-ийн порталын нэхэмжлэхийн «Үлдэгдэл» (TPI-ээс өдөр бүр татсан) ↔ Entry-ийн авлагын үлдэгдэл. Давхар даралт → авлагын панель."
            : "Авлагын нэхэмжлэх ба POS борлуулалтын ТЕГ-д илгээсэн баримт — ДДТД, төлөв, алдаа. Давхар даралт → эх баримтын панель (дахин илгээх тэндээс)."}
        </p>
      </div>
      {connection && <EbarimtViewTabs view={view} problems={connection.lastCheckSummary?.problems ?? 0} />}
      {view === "tax" ? <TaxView orgId={orgId} /> : <EbarimtDocumentsView {...await loadEbarimtPageData(orgId, params)} />}
    </section>
  );
}

async function TaxView({ orgId }: { orgId: string }) {
  const [data, access] = await Promise.all([loadEbarimtTaxChecks(orgId), moduleAccess(["ar"])]);
  return (
    <EbarimtTaxCheckView
      connection={data.connection}
      rows={data.rows}
      summary={data.summary}
      canSync={PERMISSION_RANK[access.levels.ar ?? "none"] >= PERMISSION_RANK.write}
    />
  );
}
