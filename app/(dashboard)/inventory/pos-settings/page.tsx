// POS тохиргоо `/inventory/pos-settings` — docs/pos §4.3. Урьд нь
// борлуулалтын `?tab=settings` байсан; тусдаа нав цэс. Дэд хэсэг нь
// `?section=general|methods|rules|ebarimt|qpay` (QPay холболтын callback
// `?section=qpay&qpay=…` гэж буцаана).

import { PosSettingsView } from "@/components/pos/pos-settings-view";
import { requireModuleAction } from "@/lib/auth";
import { loadIssueTypes } from "@/lib/costing/master-data";
import { POS_MODULE_KEY } from "@/lib/pos/constants";
import { loadCheckoutData } from "@/lib/pos/load-data";

export default async function PosSettingsPage() {
  const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
  const [checkout, issueTypes] = await Promise.all([
    loadCheckoutData(orgId, userId),
    loadIssueTypes(orgId, { activeOnly: true }),
  ]);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">POS тохиргоо</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Дансны роль, төлбөрийн хэлбэр, хөнгөлөлтийн дүрэм, eBarimt ба QPay.
        </p>
      </div>
      <PosSettingsView
        checkout={checkout}
        issueTypes={issueTypes.map((entry) => ({ id: entry.id, code: entry.code, name: entry.name }))}
      />
    </section>
  );
}
