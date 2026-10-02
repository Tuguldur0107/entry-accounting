// Авлага → eBarimt `/receivables/ebarimt` — борлуулалтын eBarimt баримтууд
// (АР нэхэмжлэх + POS, POS эрхтэй бол). `/tax/ebarimt`-тэй НЭГ ачаалагч, НЭГ харагдац.
// `?view=tax` — ТЕГ-ийн TPI-ээс татсан нэхэмжлэхийн үлдэгдлийн тулгалт;
// `?view=sales` — ТЕГ-ийн БҮХ борлуулалтын баримт, Entry-тэй ДДТД-аар тулгасан
// (docs/dev/ebarimt-tax-reconcile.md §8). Огноо: URL `from`/`to` → топбарын период.

import { EbarimtDocumentsView } from "@/components/ebarimt/ebarimt-documents-view";
import { EbarimtTaxCheckView } from "@/components/ebarimt/ebarimt-tax-check-view";
import { EbarimtTaxSalesView } from "@/components/ebarimt/ebarimt-tax-sales-view";
import { EbarimtViewTabs } from "@/components/ebarimt/ebarimt-view-tabs";
import { moduleAccess, requireModuleAction } from "@/lib/auth";
import { loadEbarimtPageData } from "@/lib/ebarimt/list-page";
import { loadEbarimtTaxChecks, loadEbarimtTaxSales, loadTpiConnectionRow, toTpiConnectionView } from "@/lib/ebarimt/tax-sync";
import { getPeriodSelection } from "@/lib/periods/selection";
import { PERMISSION_RANK } from "@/lib/permissions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ReceivablesEbarimtPage({ searchParams }: { searchParams: SearchParams }) {
  const { orgId } = await requireModuleAction("ar", "read");
  const params = await searchParams;
  const view = params.view === "tax" ? "tax" : params.view === "sales" ? "sales" : "documents";
  const connection = await loadTpiConnectionRow(orgId);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">eBarimt — борлуулалт</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          {view === "tax"
            ? "ТЕГ-ийн порталын нэхэмжлэхийн «Үлдэгдэл» (TPI-ээс өдөр бүр татсан) ↔ Entry-ийн авлагын үлдэгдэл. Давхар даралт → авлагын панель."
            : view === "sales"
              ? "Танай ТТД дээр ТЕГ-д бүртгэлтэй БҮХ борлуулалтын баримт (TPI-ээс өдөр бүр татсан) — Entry-ээс илгээгдсэн эсэхээр тулгасан. Давхар даралт → Entry-ийн эх баримт."
              : "Авлагын нэхэмжлэх ба POS борлуулалтын ТЕГ-д илгээсэн баримт — ДДТД, төлөв, алдаа. Давхар даралт → эх баримтын панель (дахин илгээх тэндээс)."}
        </p>
      </div>
      {connection && <EbarimtViewTabs view={view} problems={connection.lastCheckSummary?.problems ?? 0} />}
      {view === "tax" ? (
        <TaxView orgId={orgId} />
      ) : view === "sales" ? (
        <SalesView orgId={orgId} params={params} connection={connection} />
      ) : (
        <EbarimtDocumentsView {...await loadEbarimtPageData(orgId, params)} />
      )}
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

const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

async function SalesView({
  orgId,
  params,
  connection,
}: {
  orgId: string;
  params: Record<string, string | string[] | undefined>;
  connection: Awaited<ReturnType<typeof loadTpiConnectionRow>>;
}) {
  const period = await getPeriodSelection();
  const from = isDate(params.from) ? params.from : period.from;
  const to = isDate(params.to) ? params.to : period.to;
  const data = await loadEbarimtTaxSales(orgId, { from, to });
  return (
    <EbarimtTaxSalesView
      connection={connection ? toTpiConnectionView(connection) : null}
      rows={data.rows}
      summary={data.summary}
      truncated={data.truncated}
      from={from}
      to={to}
    />
  );
}
