// Өглөг → eBarimt `/payables/ebarimt` — ХУДАЛДАН АВАЛТЫН eBarimt (нийлүүлэгчээс
// танд олгогдсон баримт). Эх нь ТЕГ-ийн ITC TPI — зөвхөн Монголын сүлжээнээс
// хүрнэ; прокси + ITC эрх бэлэн болтол өгөгдөл ЗОХИОХГҮЙ, юу хүлээгдэж буйг ил
// харуулна (docs/deployment/mongolia-network-runbook.md A, D; lib/itc/ scaffold).

import { EmptyState } from "@/components/ui/empty-state";
import { requireModuleAction } from "@/lib/auth";

export default async function PayablesEbarimtPage() {
  await requireModuleAction("ap", "read");

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">eBarimt — худалдан авалт</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Нийлүүлэгчдээс танай ТТД дээр олгогдсон eBarimt — өглөгийн нэхэмжлэхтэй ДДТД-аар тулгаж, НӨАТ-ын тайлангийн
          «авсан НӨАТ»-ыг шалгана.
        </p>
      </div>
      <EmptyState
        icon="reconciliation"
        title="ТЕГ-ийн холболт хүлээгдэж байна"
        description="Худалдан авалтын баримтыг ТЕГ-ийн ITC системээс татна. Энэ систем зөвхөн Монголын сүлжээнээс нээгддэг тул сервер талын прокси болон ITC-ийн нэвтрэх эрх бэлэн болмогц энд автоматаар жагсана. Одоогоор баримт харуулахгүй — өгөгдөл зохиохгүй."
        actions={[{ label: "Өглөгийн нэхэмжлэх", href: "/payables/documents", icon: "document", primary: true }]}
      />
    </section>
  );
}
