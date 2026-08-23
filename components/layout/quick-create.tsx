"use client";

// Топбарын "+ Шинэ" глобал цэс — аль ч дэлгэцээс аль ч баримт үүсгэнэ.
// (Өмнө нь зөвхөн GL дотор "+ Шинэ журнал" харагддаг байсныг орлоно.)
// Панелиуд PanelHost-оор глобал тул шууд нээгдэнэ. F2 товч цэсийг нээнэ
// (хүснэгт, оролтын талбар дотор F2 өөрийн үүрэгтэй тул тэнд ажиллахгүй).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useDisabledModuleIds } from "@/components/layout/nav-visibility";

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
  /** Навигацийн модулийн id — модуль унтарсан үед цэснээс нуугдана. */
  moduleId?: string;
  /** Панель нээх үйлдэл — href байхгүй үед ажиллана. */
  run?: () => void;
  /** Панельгүй урсгал: хуудас руу үсэрч тэндхийн үүсгэх цонхыг нээнэ. */
  href?: string;
}[] = [
  {
    key: "journal",
    label: "Шинэ журнал",
    icon: "journal",
    moduleId: "gl",
    run: () => openNewVoucherPanel(),
  },
  {
    key: "ar",
    label: "Шинэ нэхэмжлэл (Авлага)",
    icon: "document",
    moduleId: "receivables",
    run: () => openArapDocPanel({ mode: "receivable" }),
  },
  {
    key: "ap",
    label: "Шинэ нэхэмжлэх (Өглөг)",
    icon: "document",
    moduleId: "payables",
    run: () => openArapDocPanel({ mode: "payable" }),
  },
  {
    key: "cash",
    label: "Шинэ мөнгөн гүйлгээ",
    icon: "movement",
    moduleId: "cash",
    run: () => openCashNewPanel(),
  },
  {
    key: "inventory",
    label: "Шинэ барааны хөдөлгөөн",
    icon: "inventory",
    moduleId: "inventory",
    // Хөдөлгөөний форм нь жагсаалтын хуудасны цонх (панель биш) тул
    // ?new=1 параметртэй үсэрч тэр цонхоо нээлгэнэ — форм давхардахгүй.
    href: "/inventory/movements?new=1",
  },
  {
    key: "fa",
    label: "Шинэ үндсэн хөрөнгө",
    icon: "fixedAsset",
    moduleId: "fa",
    run: () => openFaAssetFormPanel(),
  },
];

export function QuickCreate() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const disabledModuleIds = useDisabledModuleIds();

  // Унтраасан модулийн үйлдэл цэснээс нуугдана — тоон товчлол шүүгдсэн
  // жагсаалтын дугаартай таардаг.
  const visibleActions = useMemo(
    () =>
      QUICK_CREATE_ACTIONS.filter(
        (action) =>
          !action.moduleId || !disabledModuleIds.includes(action.moduleId)
      ),
    [disabledModuleIds]
  );

  const runAction = useCallback(
    (action: (typeof QUICK_CREATE_ACTIONS)[number]) => {
      if (action.href) router.push(action.href);
      else action.run?.();
    },
    [router]
  );

  // F2 — цэсийг нээх/хаах глобал товчлол. Оролтын талбар, AG Grid (F2 =
  // нүд засах) болон modal дотор фокустай үед үл ойшооно.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F2" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest?.(
          "input, textarea, select, [contenteditable='true'], .ag-root-wrapper, [role='dialog']"
        )
      )
        return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Цэс нээлттэй үед 1–9 тоо дарахад тухайн мөрийг шууд ажиллуулна,
  // Esc хаана — F2 → тоо гэсэн хоёрхон даралтаар баримт үүсгэнэ.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      // Modifier-той (Cmd+1 таб солих г.м.) болон input дотор бичиж буй
      // даралтыг булаахгүй.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      const index = Number(event.key);
      if (
        !Number.isInteger(index) ||
        index < 1 ||
        index > visibleActions.length
      )
        return;
      event.preventDefault();
      setOpen(false);
      runAction(visibleActions[index - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, runAction, visibleActions]);

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
          title="Шинэ баримт үүсгэх (F2)"
        >
          + Шинэ (F2)
        </button>
      }
    >
      {visibleActions.map((action, index) => (
        <DropdownItem
          key={action.key}
          onSelect={() => {
            setOpen(false);
            runAction(action);
          }}
        >
          <span className="w-3 text-center font-mono text-[10px] text-[var(--ea-text-3)]">
            {index + 1}
          </span>
          <Icon name={action.icon} size="sm" className="text-[var(--ea-text-3)]" />
          {action.label}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}
