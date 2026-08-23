"use client";

// Хяналтын самбарын "Хурдан үйлдэл" мөр. Үүсгэх үйлдлүүд нь топбарын
// "+ Шинэ" цэсний QUICK_CREATE_ACTIONS-ээс ирдэг — тусдаа жагсаалт
// давхардуулахгүй, самбараас ч, цэснээс ч ИЖИЛ панель нээгдэнэ.
// Навигацийн линкүүд (хуулга импорт, тайлан) нь үүсгэх үйлдэл биш тул
// зөвхөн энд тодорхойлогдоно.

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  QUICK_CREATE_ACTIONS,
  runQuickCreateAction,
} from "@/components/layout/quick-create";
import { useDisabledModuleIds } from "@/components/layout/nav-visibility";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** Самбарт харуулах үүсгэх үйлдлийн key-үүд (эхнийх нь primary товч). */
const CREATE_KEYS = ["journal", "ar"];

const NAV_LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: "/cash/statements", label: "Хуулга импорт", icon: "spreadsheet" },
  { href: "/gl/reports", label: "Тайлан", icon: "report" },
];

export function DashboardQuickActions() {
  const router = useRouter();
  const disabledModuleIds = useDisabledModuleIds();

  const createActions = CREATE_KEYS.map((key) =>
    QUICK_CREATE_ACTIONS.find((action) => action.key === key)
  ).filter(
    (action): action is (typeof QUICK_CREATE_ACTIONS)[number] =>
      !!action &&
      (!action.moduleId || !disabledModuleIds.includes(action.moduleId))
  );

  const buttonClass = (primary: boolean) =>
    cn(
      "flex h-9 items-center gap-2 rounded-md px-3.5 text-xs font-medium transition-colors",
      primary
        ? "bg-[var(--ea-primary)] text-[var(--primary-foreground)]"
        : "ea-interactive border border-[var(--ea-border-strong)] text-[var(--ea-text-2)]"
    );

  return (
    <div className="flex flex-wrap gap-2">
      {createActions.map((action, index) => (
        <button
          key={action.key}
          type="button"
          onClick={() => runQuickCreateAction(action, router)}
          className={buttonClass(index === 0)}
        >
          <Icon name={action.icon} size="sm" />
          {action.label}
        </button>
      ))}
      {NAV_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={buttonClass(false)}
          style={{ textDecoration: "none" }}
        >
          <Icon name={link.icon} size="sm" />
          {link.label}
        </Link>
      ))}
    </div>
  );
}
