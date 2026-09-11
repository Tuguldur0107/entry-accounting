"use client";

// Хуваарилалтын ЗОРИЛТУУДЫН сонголтын хүснэгт — НЭГ хэрэгжилт, хоёр хэрэглэгч:
//   • components/costing/cost-allocation-view.tsx — өртгийн модулийн чөлөөт
//     хуваарилалт (зорилт нь тухайн хугацааны батлагдсан орлогууд)
//   • components/procurement/unallocated-costs-view.tsx — хангамжийн
//     "Хуваарилагдаагүй зардал" worklist (зорилт нь тухайн PO-гийн
//     батлагдсан хүлээн авалтууд)
//
// Давхардсан markup бичихийг ХОРИГЛОНО (хэрэглэгчийн дүрэм: бэлэн зүйлсээ
// үргэлж дахин ашиглана). Хоёр дуудагчийн ялгаа нь ЗӨВХӨН баганын шошго,
// хоосон төлөвийн текст — бусад зан төлөв, харагдац ЯГ адил.
//
// Дүрэм (docs/cost README 0.3 / OD-017): "Гараар" суурьд мөр бүрийн дүнг
// хэрэглэгч бичнэ (сонгоогүй мөр идэвхгүй); бусад суурьд урьдчилсан хуваарь
// (`previewByMovement`) харагдана — 0 бол "—".

import type { AllocationTargetOption } from "@/lib/actions/cost-allocation";
import type { AllocationBase } from "@/lib/costing/allocation";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

interface Props {
  targets: AllocationTargetOption[];
  /** movementId → сонгогдсон эсэх. */
  selected: Record<string, boolean>;
  onToggle: (movementId: string, checked: boolean) => void;
  /** "" = суурь СОНГООГҮЙ (OD-017) — "manual" үед л дүн гараар бичигдэнэ. */
  base: AllocationBase | "";
  /** movementId → гараар бичсэн дүнгийн текст. */
  manualAmounts: Record<string, string>;
  onManualChange: (movementId: string, value: string) => void;
  /** movementId → урьдчилсан хуваарийн дүн (`allocate` үр дүнгээс). */
  previewByMovement: Map<string, number>;
  /** Баримтын баганын шошго (ж: "Баримт" / "Орлого"). */
  documentHeader?: string;
  /** Жингийн баганын шошго (ж: "Өртөг" / "Капитализаци"). */
  valueHeader?: string;
  /** Зорилт алга үед харуулах монгол текст. */
  emptyMessage: string;
}

export function AllocationTargetsTable({
  targets,
  selected,
  onToggle,
  base,
  manualAmounts,
  onManualChange,
  previewByMovement,
  documentHeader = "Баримт",
  valueHeader = "Өртөг",
  emptyMessage,
}: Props) {
  if (targets.length === 0) {
    return (
      <p className="rounded-md border border-[var(--ea-border)] px-3 py-6 text-center text-xs text-[var(--ea-text-4)]">
        {emptyMessage}
      </p>
    );
  }

  const isManual = base === "manual";

  return (
    <div className="max-h-64 overflow-y-auto rounded-md border border-[var(--ea-border)]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-[var(--ea-bg-2)] text-[var(--ea-text-3)]">
          <tr>
            <th className="w-8 px-2 py-1.5" />
            <th className="px-2 py-1.5 text-left">{documentHeader}</th>
            <th className="px-2 py-1.5 text-left">Бараа</th>
            <th className="px-2 py-1.5 text-right">Тоо</th>
            <th className="px-2 py-1.5 text-right">{valueHeader}</th>
            <th className="px-2 py-1.5 text-right">
              {isManual ? "Дүн бичих" : "Хуваарилах дүн"}
            </th>
          </tr>
        </thead>
        <tbody>
          {targets.map((target) => {
            const isSelected = !!selected[target.movementId];
            const share = previewByMovement.get(target.movementId);
            return (
              <tr
                key={target.movementId}
                className={cn(
                  "border-t border-[var(--ea-border)]",
                  isSelected && "bg-[var(--ea-primary)]/6"
                )}
              >
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(event) =>
                      onToggle(target.movementId, event.target.checked)
                    }
                  />
                </td>
                <td className="px-2 py-1.5 font-mono">
                  {target.documentNo}
                  <span className="ml-1.5 text-[var(--ea-text-4)]">
                    {target.date}
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  {target.itemLabel}
                  <span className="ml-1.5 text-[var(--ea-text-4)]">
                    {target.warehouseLabel}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {fmtQty(target.quantity)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {fmtMnt(target.value)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {isManual ? (
                    <input
                      value={manualAmounts[target.movementId] ?? ""}
                      onChange={(event) =>
                        onManualChange(target.movementId, event.target.value)
                      }
                      disabled={!isSelected}
                      placeholder="0"
                      className="h-6 w-24 rounded border border-[var(--ea-border)] bg-[var(--ea-surface)] px-1 text-right font-mono text-xs disabled:opacity-40"
                    />
                  ) : isSelected && (share ?? 0) > 0 ? (
                    fmtMnt(share!)
                  ) : isSelected ? (
                    "—"
                  ) : (
                    ""
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
