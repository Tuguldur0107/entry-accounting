"use client";

// Утсан дээрх (<640px) жагсаалт — хүснэгтийн ОРОНД карт (UI гайдын карт 12,
// ENT-060). 390px-д AG Grid 5-аас 3 багана л харуулж, дүн таслагддаг байв.
// Утсан дээр хэрэглэгч гүйлгээг ШАЛГАЖ батладаг — карт бүр төлөв, нэр, дүн
// гэсэн 3 мөртэй; бүхэлдээ 44px+ дарагдах талбар (десктопын давхар даралттай
// ижил үйлдэл). Хүснэгтийн стандарт (DataGrid) десктопод хэвээр.

import { useState, useSyncExternalStore } from "react";

import { DocumentStatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";

const MOBILE_QUERY = "(max-width: 639px)";

function subscribeMobile(listener: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** Утасны өргөн эсэх — SSR/анхны render-т false (десктоп хүснэгт). */
export function useIsMobileViewport(): boolean {
  return useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false
  );
}

export interface MobileCard {
  id: string;
  status?: string | null;
  /** Баруун дээд булан — огноо г.м. */
  corner?: string;
  title: string;
  /** Гуравдугаар мөрийн зүүн тал — данс, код. */
  meta?: string;
  /** Гуравдугаар мөрийн баруун тал — дүн. */
  amount?: string;
}

const PAGE = 20;

export function MobileCardList<T>({
  rows,
  toCard,
  onOpen,
  ariaLabel,
}: {
  rows: readonly T[];
  toCard: (row: T) => MobileCard;
  onOpen: (row: T) => void;
  ariaLabel: string;
}) {
  const [limit, setLimit] = useState(PAGE);
  const visible = rows.slice(0, limit);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul aria-label={ariaLabel} className="flex flex-col gap-2">
        {visible.map((row) => {
          const card = toCard(row);
          return (
            <li key={card.id}>
              <button
                type="button"
                onClick={() => onOpen(row)}
                className="flex min-h-11 w-full flex-col gap-1 rounded-lg border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2.5 text-left active:bg-[var(--ea-bg-2)]"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  {card.status ? <DocumentStatusBadge status={card.status} /> : <span />}
                  {card.corner ? (
                    <span className="font-mono text-[11px] text-[var(--ea-text-3)]">{card.corner}</span>
                  ) : null}
                </span>
                <span className="line-clamp-2 text-sm font-medium text-[var(--ea-text-1)]">
                  {card.title}
                </span>
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-[11px] text-[var(--ea-text-3)]">
                    {card.meta}
                  </span>
                  {card.amount ? (
                    <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-[var(--ea-text-1)]">
                      {card.amount}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length > limit ? (
        <Button
          variant="outline"
          className="mt-3 h-11 w-full"
          onClick={() => setLimit((current) => current + PAGE)}
        >
          Цааш харах ({rows.length - limit})
        </Button>
      ) : null}
    </div>
  );
}
