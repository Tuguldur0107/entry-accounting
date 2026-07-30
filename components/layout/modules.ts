import type { LucideIcon } from "lucide-react";
import {
  List,
  Sparkles,
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
  Calculator,
  Boxes,
  ClipboardCheck,
  Building,
  TrendingDown,
  CalendarClock,
  Factory,
} from "lucide-react";

// Модуль бүрийн цэс нэг стандарт ДАРААЛЛААР жагсана (визуал бүлэглэлгүй):
//   самбар → гүйлгээ (журнал/нэхэмжлэл/хуулга…) → тайлан → тохиргоо
export type ModuleItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type Module = {
  id: string;
  label: string;
  matchPrefix: string;
  defaultHref: string;
  items: ModuleItem[];
};

/** Нүүр модулийн id — matchPrefix "/" бүх замд таарах тул тусад нь шалгана. */
export const HOME_MODULE_ID = "home";

export const MODULES: Module[] = [
  {
    // Системийн ерөнхий самбар — модулийн ДОТОР биш, модулиудтай ЗЭРЭГЦЭЭ.
    id: HOME_MODULE_ID,
    label: "Системийн хяналт",
    matchPrefix: "/",
    defaultHref: "/",
    items: [{ label: "Хяналтын самбар", href: "/", icon: LayoutDashboard }],
  },
  {
    id: "gl",
    label: "Ерөнхий журнал",
    matchPrefix: "/gl",
    defaultHref: "/gl",
    items: [
      { label: "Хяналтын самбар", href: "/gl", icon: LayoutDashboard },
      { label: "Журналын жагсаалт", href: "/gl/journal", icon: List },
      { label: "Тайлан", href: "/gl/reports", icon: BarChart3 },
      // GL-ийн тохиргоо (сегмент, данс) Тохиргоо модульд байрладаг.
    ],
  },
  {
    id: "cash",
    label: "Мөнгөн хөрөнгө",
    matchPrefix: "/cash",
    defaultHref: "/cash",
    items: [
      { label: "Хяналтын самбар", href: "/cash", icon: LayoutDashboard },
      {
        label: "Орлого, зарлага",
        href: "/cash/transactions",
        icon: ArrowLeftRight,
      },
      {
        label: "Дансны хуулга",
        href: "/cash/statements",
        icon: FileSpreadsheet,
      },
      {
        label: "Тулгалт, ханш",
        href: "/cash/reconciliation",
        icon: Scale,
      },
      { label: "Тайлан", href: "/cash/reports", icon: BarChartBig },
      { label: "Касс, банкны данс", href: "/cash/accounts", icon: Landmark },
    ],
  },
  {
    id: "receivables",
    label: "Авлага",
    matchPrefix: "/receivables",
    defaultHref: "/receivables",
    items: [
      { label: "Хяналтын самбар", href: "/receivables", icon: LayoutDashboard },
      { label: "Нэхэмжлэл", href: "/receivables/documents", icon: ReceiptText },
      { label: "Тайлан", href: "/receivables/reports", icon: BarChartBig },
      // Харилцагч бол лавлах өгөгдөл — тохиргооны байрлалд (сүүлд) байна.
      {
        label: "Харилцагчид",
        href: "/receivables/counterparties",
        icon: Building2,
      },
    ],
  },
  {
    id: "payables",
    label: "Өглөг",
    matchPrefix: "/payables",
    defaultHref: "/payables",
    items: [
      { label: "Хяналтын самбар", href: "/payables", icon: LayoutDashboard },
      { label: "Нэхэмжлэх", href: "/payables/documents", icon: ReceiptText },
      { label: "Тайлан", href: "/payables/reports", icon: BarChartBig },
      {
        label: "Харилцагчид",
        href: "/payables/counterparties",
        icon: Building2,
      },
    ],
  },
  {
    id: "inventory",
    label: "Бараа материал",
    matchPrefix: "/inventory",
    defaultHref: "/inventory",
    items: [
      { label: "Хяналтын самбар", href: "/inventory", icon: LayoutDashboard },
      {
        label: "Хөдөлгөөн",
        href: "/inventory/movements",
        icon: ArrowLeftRight,
      },
      {
        label: "Тооллого",
        href: "/inventory/counting",
        icon: ClipboardCheck,
      },
      { label: "Тайлан", href: "/inventory/reports", icon: BarChartBig },
      { label: "Бараа, агуулах", href: "/inventory/items", icon: Boxes },
    ],
  },
  {
    id: "fa",
    label: "Үндсэн хөрөнгө",
    matchPrefix: "/fa",
    defaultHref: "/fa",
    items: [
      { label: "Хяналтын самбар", href: "/fa", icon: LayoutDashboard },
      { label: "Хөрөнгийн карт", href: "/fa/assets", icon: Building },
      { label: "Элэгдэл", href: "/fa/depreciation", icon: TrendingDown },
    ],
  },
  {
    id: "costing",
    label: "Өртөг",
    matchPrefix: "/costing",
    defaultHref: "/costing",
    items: [
      { label: "Хяналтын самбар", href: "/costing", icon: LayoutDashboard },
      { label: "Өртгийн бичилт", href: "/costing/entries", icon: Calculator },
      { label: "Үйлдвэрлэл", href: "/costing/production", icon: Factory },
      {
        label: "Зардлын хуваарилалт",
        href: "/costing/allocations",
        icon: ArrowLeftRight,
      },
      { label: "Өртгийн хяналт", href: "/costing/control", icon: Scale },
      {
        label: "Бүрэлдэхүүний задаргаа",
        href: "/costing/components",
        icon: Boxes,
      },
      {
        label: "Гүйлгээний дэлгэрэнгүй",
        href: "/costing/detail",
        icon: FileSpreadsheet,
      },
      { label: "Тайлан", href: "/costing/reports", icon: BarChartBig },
      { label: "Тохиргоо", href: "/costing/settings", icon: SettingsIcon },
    ],
  },
  {
    id: "ai",
    label: "AI туслах",
    matchPrefix: "/ai",
    defaultHref: "/ai",
    items: [
      { label: "Чат", href: "/ai", icon: Sparkles },
      { label: "Тохиргоо", href: "/ai/settings", icon: SettingsIcon },
    ],
  },
  {
    id: "settings",
    label: "Тохиргоо",
    matchPrefix: "/settings",
    defaultHref: "/settings/profile",
    items: [
      { label: "Хэрэглэгчийн профайл", href: "/settings/profile", icon: User },
      { label: "Компанийн мэдээлэл", href: "/settings/company", icon: Building2 },
      { label: "Ерөнхий журналын тохиргоо", href: "/settings/gl", icon: SettingsIcon },
      { label: "Нягтлан бодох период", href: "/settings/periods", icon: CalendarClock },
      { label: "UI Kit", href: "/settings/ui-kit", icon: Palette },
    ],
  },
];

export function getActiveModule(pathname: string): Module {
  const home = MODULES.find((m) => m.id === HOME_MODULE_ID)!;
  // Нүүр нь ЗӨВХӨН яг "/" үед идэвхтэй — эс тэгвээс prefix "/" нь бүх замд таарна.
  if (pathname === "/") return home;
  return (
    MODULES.find(
      (m) => m.id !== HOME_MODULE_ID && pathname.startsWith(m.matchPrefix)
    ) ?? home
  );
}
