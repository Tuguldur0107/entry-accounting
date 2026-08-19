"use client";

// Топбарын "+ Шинэ" глобал цэс — аль ч дэлгэцээс аль ч баримт үүсгэнэ.
// (Өмнө нь зөвхөн GL дотор "+ Шинэ журнал" харагддаг байсныг орлоно.)
// Панелиуд PanelHost-оор глобал тул шууд нээгдэнэ.

import { useState } from "react";

import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
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

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="ea-primary-button h-8 rounded-md px-3 text-xs font-medium text-[var(--primary-foreground)]"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          + Шинэ
        </button>
      }
    >
      {QUICK_CREATE_ACTIONS.map((action) => (
        <DropdownItem
          key={action.key}
          onSelect={() => {
            setOpen(false);
            action.run();
          }}
        >
          <Icon name={action.icon} size="sm" className="text-[var(--ea-text-3)]" />
          {action.label}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}
