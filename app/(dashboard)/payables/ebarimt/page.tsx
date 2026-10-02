// Өглөг → eBarimt `/payables/ebarimt` — ХУДАЛДАН АВАЛТЫН eBarimt (нийлүүлэгчээс
// танай регистр дээр олгогдсон баримт) ↔ өглөгийн нэхэмжлэх, авсан НӨАТ.
// Эх нь ТЕГ-ийн TPI `getSaleListERP` (docs/dev/ebarimt-tax-reconcile.md §7) — өдөр бүр
// автоматаар татагдана; холболтгүй бол өгөгдөл ЗОХИОХГҮЙ, тохируулах замыг заана.
// Огноо: URL `from`/`to` → байхгүй бол топбарын период (CLAUDE.md §4).

import { EbarimtPurchaseCheckView } from "@/components/ebarimt/ebarimt-purchase-check-view";
import { moduleAccess, requireModuleAction } from "@/lib/auth";
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
  const [row, checks, access] = await Promise.all([
    loadTpiConnectionRow(orgId),
    loadEbarimtPurchaseChecks(orgId, { from, to }),
    moduleAccess(["ap"]),
  ]);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">eBarimt — худалдан авалт</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Нийлүүлэгчдээс танай регистр дээр олгогдсон БҮХ eBarimt (ТЕГ-ээс өдөр бүр татсан, топбарын периодоор) — өглөгийн нэхэмжлэхтэй ДДТД-аар
          тулгаж, НӨАТ-ын тайлангийн «авсан НӨАТ»-ыг шалгана. Борлуулагчийн нэр ТЕГ-ээс далдлагдаж ирдэг.
        </p>
      </div>
      <EbarimtPurchaseCheckView
        connection={row ? toTpiConnectionView(row) : null}
        rows={checks.rows}
        summary={checks.summary}
        syncFrom={checks.syncFrom}
        syncedThrough={checks.syncedThrough}
        canWrite={PERMISSION_RANK[access.levels.ap ?? "none"] >= PERMISSION_RANK.write}
        from={from}
        to={to}
      />
    </section>
  );
}
