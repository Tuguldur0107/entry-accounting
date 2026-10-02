// Өглөг → eBarimt `/payables/ebarimt` — ХУДАЛДАН АВАЛТЫН eBarimt (нийлүүлэгчээс
// танай регистр дээр олгогдсон баримт) ↔ өглөгийн нэхэмжлэх, авсан НӨАТ.
// Эх нь ТЕГ-ийн TPI `getSaleListERP` (docs/dev/ebarimt-tax-reconcile.md §7) — өдөр бүр
// автоматаар татагдана; холболтгүй бол өгөгдөл ЗОХИОХГҮЙ, тохируулах замыг заана.
// Огноо: URL `from`/`to` → байхгүй бол топбарын период (CLAUDE.md §4).
// `?view=customs` — хуулийн этгээдийн гаалийн мэдүүлэг (§10, `tpiDeclaration`).

import { EbarimtCustomsView } from "@/components/ebarimt/ebarimt-customs-view";
import { EbarimtPayablesTabs } from "@/components/ebarimt/ebarimt-payables-tabs";
import { EbarimtPurchaseCheckView } from "@/components/ebarimt/ebarimt-purchase-check-view";
import { moduleAccess, requireModuleAction } from "@/lib/auth";
import { loadEbarimtCustomsDeclarations } from "@/lib/ebarimt/customs-sync";
import { loadEbarimtPurchaseChecks } from "@/lib/ebarimt/purchase-sync";
import { loadTpiConnectionRow, toTpiConnectionView } from "@/lib/ebarimt/tax-sync";
import { getPeriodSelection } from "@/lib/periods/selection";
import { PERMISSION_RANK } from "@/lib/permissions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export default async function PayablesEbarimtPage({ searchParams }: { searchParams: SearchParams }) {
  const { orgId } = await requireModuleAction("ap", "read");
  const [params, period] = await Promise.all([searchParams, getPeriodSelection()]);
  const from = isDate(params.from) ? params.from : period.from;
  const to = isDate(params.to) ? params.to : period.to;
  const view = params.view === "customs" ? "customs" : "purchases";
  const [row, access] = await Promise.all([loadTpiConnectionRow(orgId), moduleAccess(["ap"])]);
  const connection = row ? toTpiConnectionView(row) : null;
  const canWrite = PERMISSION_RANK[access.levels.ap ?? "none"] >= PERMISSION_RANK.write;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">eBarimt — худалдан авалт</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          {view === "customs"
            ? "Хуулийн этгээдийн импортын гаалийн мэдүүлэг (өдөр бүр татсан, топбарын периодоор) — гаалийн татвар, ОАТ, хураамж, импортын НӨАТ. Зөвхөн харах — дансанд бичигдэхгүй."
            : "Нийлүүлэгчдээс танай регистр дээр олгогдсон БҮХ eBarimt (ТЕГ-ээс өдөр бүр татсан, топбарын периодоор) — өглөгийн нэхэмжлэхтэй ДДТД-аар тулгаж, НӨАТ-ын тайлангийн «авсан НӨАТ»-ыг шалгана. Борлуулагчийн нэр ТЕГ-ээс далдлагдаж ирдэг."}
        </p>
      </div>
      {connection && <EbarimtPayablesTabs view={view} />}
      {view === "customs" ? (
        <CustomsView orgId={orgId} connection={connection} canWrite={canWrite} from={from} to={to} />
      ) : (
        <PurchasesView orgId={orgId} connection={connection} canWrite={canWrite} from={from} to={to} />
      )}
    </section>
  );
}

type ViewProps = {
  orgId: string;
  connection: ReturnType<typeof toTpiConnectionView> | null;
  canWrite: boolean;
  from: string;
  to: string;
};

async function PurchasesView({ orgId, connection, canWrite, from, to }: ViewProps) {
  const checks = await loadEbarimtPurchaseChecks(orgId, { from, to });
  return (
    <EbarimtPurchaseCheckView
      connection={connection}
      rows={checks.rows}
      summary={checks.summary}
      syncFrom={checks.syncFrom}
      syncedThrough={checks.syncedThrough}
      canWrite={canWrite}
      from={from}
      to={to}
    />
  );
}

async function CustomsView({ orgId, connection, canWrite, from, to }: ViewProps) {
  const data = await loadEbarimtCustomsDeclarations(orgId, { from, to });
  return <EbarimtCustomsView connection={connection} rows={data.rows} summary={data.summary} canWrite={canWrite} from={from} to={to} />;
}
