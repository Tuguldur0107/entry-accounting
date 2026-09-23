// Ээлж `/inventory/shifts` — docs/pos §4.3. Урьд нь борлуулалтын `?tab=shifts`
// байсан; тусдаа нав цэс болсноор ЗӨВХӨН ээлжийн өгөгдөл ачаалагдана.

import { ShiftsView } from "@/components/pos/shifts-view";
import { requireModuleAction } from "@/lib/auth";
import { POS_MODULE_KEY } from "@/lib/pos/constants";
import { loadCheckoutData, loadShiftViews } from "@/lib/pos/load-data";

export default async function PosShiftsPage() {
  const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
  const [checkout, shifts] = await Promise.all([
    loadCheckoutData(orgId, userId),
    loadShiftViews(orgId),
  ]);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">Ээлж</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Кассын ээлж нээх, хаах ба Z-тайлан. Давхар даралт → дэлгэрэнгүй панель.
        </p>
      </div>
      <ShiftsView
        shifts={shifts}
        cashAccounts={checkout.cashAccounts}
        warehouses={checkout.warehouses}
        defaultWarehouseId={checkout.settings.defaultWarehouseId}
      />
    </section>
  );
}
