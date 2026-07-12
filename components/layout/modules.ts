import type { LucideIcon } from "lucide-react";
import {
  List,
  BarChart3,
  User,
  Building2,
  Settings as SettingsIcon,
  LayoutDashboard,
  ArrowLeftRight,
  Landmark,
  FileSpreadsheet,
  Palette,
  Scale,
  BarChartBig,
  ReceiptText,
} from "lucide-react";

// Every module's sidebar follows the same 4-section standard:
//   dashboard → transactions → reports → settings
// The transactions section's items differ per module (journals, invoices,
// statements…), and its header label can be overridden via sectionLabels.
export type ModuleSection =
  | "dashboard"
  | "transactions"
  | "reports"
  | "settings";

export const SECTION_ORDER: ModuleSection[] = [
  "dashboard",
  "transactions",
  "reports",
  "settings",
];

const DEFAULT_SECTION_LABELS: Record<ModuleSection, string | null> = {
  dashboard: null, // single top item — no header
  transactions: "Гүйлгээ",
  reports: "Тайлан",
  settings: "Тохиргоо",
};

export type ModuleItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  section: ModuleSection;
};

export type Module = {
  id: string;
  label: string;
  matchPrefix: string;
  defaultHref: string;
  /** Per-module override of a section's header text (e.g. GL → "Журнал"). */
  sectionLabels?: Partial<Record<ModuleSection, string | null>>;
  items: ModuleItem[];
};

export function sectionLabel(module: Module, section: ModuleSection) {
  const override = module.sectionLabels?.[section];
  return override !== undefined ? override : DEFAULT_SECTION_LABELS[section];
}

export const MODULES: Module[] = [
  {
    id: "gl",
    label: "Ерөнхий журнал",
    matchPrefix: "/gl",
    defaultHref: "/gl/journal",
    sectionLabels: { transactions: "Журнал" },
    items: [
      // Dashboard page doesn't exist for GL yet — section stays empty.
      {
        label: "Журналын жагсаалт",
        href: "/gl/journal",
        icon: List,
        section: "transactions",
      },
      { label: "Тайлан", href: "/gl/reports", icon: BarChart3, section: "reports" },
      // GL configuration (segments, accounts) lives in the settings module.
      {
        label: "Журналын тохиргоо",
        href: "/settings/gl",
        icon: SettingsIcon,
        section: "settings",
      },
    ],
  },
  {
    id: "cash",
    label: "Мөнгөн хөрөнгө",
    matchPrefix: "/cash",
    defaultHref: "/cash",
    items: [
      {
        label: "Хяналтын самбар",
        href: "/cash",
        icon: LayoutDashboard,
        section: "dashboard",
      },
      {
        label: "Орлого, зарлага",
        href: "/cash/transactions",
        icon: ArrowLeftRight,
        section: "transactions",
      },
      {
        label: "Дансны хуулга",
        href: "/cash/statements",
        icon: FileSpreadsheet,
        section: "transactions",
      },
      {
        label: "Тулгалт, ханш",
        href: "/cash/reconciliation",
        icon: Scale,
        section: "transactions",
      },
      { label: "Тайлан", href: "/cash/reports", icon: BarChartBig, section: "reports" },
      {
        label: "Касс, банкны данс",
        href: "/cash/accounts",
        icon: Landmark,
        section: "settings",
      },
    ],
  },
  {
    id: "receivables",
    label: "Авлага",
    matchPrefix: "/receivables",
    defaultHref: "/receivables",
    items: [
      {
        label: "Хяналтын самбар",
        href: "/receivables",
        icon: LayoutDashboard,
        section: "dashboard",
      },
      {
        label: "Нэхэмжлэл",
        href: "/receivables/documents",
        icon: ReceiptText,
        section: "transactions",
      },
      {
        label: "Харилцагчид",
        href: "/receivables/counterparties",
        icon: Building2,
        section: "transactions",
      },
      {
        label: "Тайлан",
        href: "/receivables/reports",
        icon: BarChartBig,
        section: "reports",
      },
      {
        label: "Тохируулгын тойм",
        href: "/receivables/settings",
        icon: SettingsIcon,
        section: "settings",
      },
    ],
  },
  {
    id: "payables",
    label: "Өглөг",
    matchPrefix: "/payables",
    defaultHref: "/payables",
    items: [
      {
        label: "Хяналтын самбар",
        href: "/payables",
        icon: LayoutDashboard,
        section: "dashboard",
      },
      {
        label: "Нэхэмжлэх",
        href: "/payables/documents",
        icon: ReceiptText,
        section: "transactions",
      },
      {
        label: "Харилцагчид",
        href: "/payables/counterparties",
        icon: Building2,
        section: "transactions",
      },
      {
        label: "Тайлан",
        href: "/payables/reports",
        icon: BarChartBig,
        section: "reports",
      },
      {
        label: "Тохируулгын тойм",
        href: "/payables/settings",
        icon: SettingsIcon,
        section: "settings",
      },
    ],
  },
  {
    id: "settings",
    label: "Тохиргоо",
    matchPrefix: "/settings",
    defaultHref: "/settings/profile",
    // A single-section module — suppress the redundant header.
    sectionLabels: { settings: null },
    items: [
      {
        label: "Хэрэглэгчийн профайл",
        href: "/settings/profile",
        icon: User,
        section: "settings",
      },
      {
        label: "Компанийн мэдээлэл",
        href: "/settings/company",
        icon: Building2,
        section: "settings",
      },
      {
        label: "Ерөнхий журналын тохиргоо",
        href: "/settings/gl",
        icon: SettingsIcon,
        section: "settings",
      },
      { label: "UI Kit", href: "/settings/ui-kit", icon: Palette, section: "settings" },
    ],
  },
];

export function getActiveModule(pathname: string): Module {
  return (
    MODULES.find((m) => pathname.startsWith(m.matchPrefix)) ?? MODULES[0]
  );
}
