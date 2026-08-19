"use client";

// Топбарын "+ Шинэ" глобал цэс — аль ч дэлгэцээс аль ч баримт үүсгэнэ.
// (Өмнө нь зөвхөн GL дотор "+ Шинэ журнал" харагддаг байсныг орлоно.)
// Панелиуд PanelHost-оор глобал тул шууд нээгдэнэ.

import { useEffect, useRef, useState } from "react";

import { Icon, type IconName } from "@/components/ui/icon";
import {
  openArapDocPanel,
  openCashNewPanel,
  openFaAssetFormPanel,
  openNewVoucherPanel,
} from "@/lib/store/panel-store";

export const QUICK_CREATE_ACTIONS: {
  key: string;
  label: string;
  icon: IconName;
  run: () => void;
}[] = [
  { key: "journal", label: "Шинэ журнал", icon: "journal", run: () => openNewVoucherPanel() },
  {
    key: "ar",
    label: "Шинэ нэхэмжлэл (Авлага)",
    icon: "document",
    run: () => openArapDocPanel({ mode: "receivable" }),
  },
  {
    key: "ap",
    label: "Шинэ нэхэмжлэх (Өглөг)",
    icon: "document",
    run: () => openArapDocPanel({ mode: "payable" }),
  },
  { key: "cash", label: "Шинэ мөнгөн гүйлгээ", icon: "movement", run: () => openCashNewPanel() },
  {
    key: "fa",
    label: "Шинэ үндсэн хөрөнгө",
    icon: "fixedAsset",
    run: () => openFaAssetFormPanel(),
  },
];

export function QuickCreate() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Гадна дарахад хаагдана.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="ea-primary-button h-8 rounded-md px-3 text-xs font-medium text-[var(--primary-foreground)]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        + Шинэ
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-md border p-1.5"
          style={{
            borderColor: "var(--ea-border)",
            background: "var(--ea-surface)",
            boxShadow: "var(--ea-shadow-3)",
          }}
        >
          {QUICK_CREATE_ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                action.run();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--ea-text-1)] hover:bg-[var(--ea-hover-subtle)]"
            >
              <Icon name={action.icon} size="sm" className="text-[var(--ea-text-3)]" />
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
