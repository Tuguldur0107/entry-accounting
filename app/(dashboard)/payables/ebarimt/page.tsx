// Өглөг → eBarimt `/payables/ebarimt` — ХУДАЛДАН АВАЛТЫН eBarimt (нийлүүлэгчээс
// танай регистр дээр олгогдсон баримт) ↔ өглөгийн нэхэмжлэх, авсан НӨАТ.
// Эх нь ТЕГ-ийн TPI `getSaleListERP` (docs/dev/ebarimt-tax-reconcile.md §7) — өдөр бүр
// автоматаар татагдана; холболтгүй бол өгөгдөл ЗОХИОХГҮЙ, тохируулах замыг заана.

import { EbarimtPurchaseCheckView } from "@/components/ebarimt/ebarimt-purchase-check-view";
import { moduleAccess, requireModuleAction } from "@/lib/auth";
import { loadEbarimtPurchaseChecks } from "@/lib/ebarimt/purchase-sync";
import { loadTpiConnectionRow, toTpiConnectionView } from "@/lib/ebarimt/tax-sync";
import { PERMISSION_RANK } from "@/lib/permissions";

export default async function PayablesEbarimtPage() {
  const { orgId } = await requireModuleAction("ap", "read");
  const [row, checks, access] = await Promise.all([
    loadTpiConnectionRow(orgId),
    loadEbarimtPurchaseChecks(orgId),
    moduleAccess(["ap"]),
  ]);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">eBarimt — худалдан авалт</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Нийлүүлэгчдээс танай регистр дээр олгогдсон eBarimt (ТЕГ-ээс өдөр бүр татсан) — өглөгийн нэхэмжлэхтэй ДДТД-аар
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
      />
    </section>
  );
}
