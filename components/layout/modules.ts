import type { IconName } from "@/components/ui/icon";

// Модуль бүрийн цэс нэг стандарт ДАРААЛЛААР жагсана (визуал бүлэглэлгүй):
//   самбар → гүйлгээ (журнал/нэхэмжлэл/хуулга…) → тайлан → тохиргоо
export type ModuleItem = {
  label: string;
  href: string;
  icon: IconName;
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
    items: [
      { label: "Хяналтын самбар", href: "/", icon: "dashboard" },
      // Сар хаалт — бүх модулийг хамардаг систем-түвшний процесс тул энд.
      { label: "Сар хаалт", href: "/close", icon: "reconciliation" },
    ],
  },
  {
    id: "gl",
    label: "Ерөнхий журнал",
    matchPrefix: "/gl",
    defaultHref: "/gl",
    items: [
      { label: "Хяналтын самбар", href: "/gl", icon: "dashboard" },
      { label: "Журналын жагсаалт", href: "/gl/journal", icon: "journal" },
      { label: "Тайлан", href: "/gl/reports", icon: "report" },
      // GL-ийн тохиргоо (сегмент, данс) Тохиргоо модульд байрладаг.
    ],
  },
  {
    id: "cash",
    label: "Мөнгөн хөрөнгө",
    matchPrefix: "/cash",
    defaultHref: "/cash",
    items: [
      { label: "Хяналтын самбар", href: "/cash", icon: "dashboard" },
      {
        label: "Орлого, зарлага",
        href: "/cash/transactions",
        icon: "movement",
      },
      {
        label: "Дансны хуулга",
        href: "/cash/statements",
        icon: "spreadsheet",
      },
      {
        label: "Тулгалт, ханш",
        href: "/cash/reconciliation",
        icon: "reconciliation",
      },
      { label: "Тайлан", href: "/cash/reports", icon: "reportDetailed" },
      { label: "Касс, банкны данс", href: "/cash/accounts", icon: "bank" },
    ],
  },
  {
    id: "receivables",
    label: "Авлага",
    matchPrefix: "/receivables",
    defaultHref: "/receivables",
    items: [
      { label: "Хяналтын самбар", href: "/receivables", icon: "dashboard" },
      { label: "Нэхэмжлэл", href: "/receivables/documents", icon: "document" },
      { label: "Тайлан", href: "/receivables/reports", icon: "reportDetailed" },
      // Харилцагч бол лавлах өгөгдөл — тохиргооны байрлалд (сүүлд) байна.
      {
        label: "Харилцагчид",
        href: "/receivables/counterparties",
        icon: "company",
      },
    ],
  },
  {
    id: "payables",
    label: "Өглөг",
    matchPrefix: "/payables",
    defaultHref: "/payables",
    items: [
      { label: "Хяналтын самбар", href: "/payables", icon: "dashboard" },
      { label: "Нэхэмжлэх", href: "/payables/documents", icon: "document" },
      { label: "Тайлан", href: "/payables/reports", icon: "reportDetailed" },
      {
        label: "Харилцагчид",
        href: "/payables/counterparties",
        icon: "company",
      },
    ],
  },
  {
    id: "inventory",
    label: "Бараа материал",
    matchPrefix: "/inventory",
    defaultHref: "/inventory",
    items: [
      { label: "Хяналтын самбар", href: "/inventory", icon: "dashboard" },
      {
        label: "Хөдөлгөөн",
        href: "/inventory/movements",
        icon: "movement",
      },
      {
        label: "Тооллого",
        href: "/inventory/counting",
        icon: "counting",
      },
      { label: "Тайлан", href: "/inventory/reports", icon: "reportDetailed" },
      { label: "Бараа, агуулах", href: "/inventory/items", icon: "inventory" },
    ],
  },
  {
    id: "fa",
    label: "Үндсэн хөрөнгө",
    matchPrefix: "/fa",
    defaultHref: "/fa",
    items: [
      { label: "Хяналтын самбар", href: "/fa", icon: "dashboard" },
      { label: "Хөрөнгийн карт", href: "/fa/assets", icon: "fixedAsset" },
      { label: "Элэгдэл", href: "/fa/depreciation", icon: "depreciation" },
    ],
  },
  {
    id: "costing",
    label: "Өртөг",
    matchPrefix: "/costing",
    defaultHref: "/costing",
    items: [
      { label: "Хяналтын самбар", href: "/costing", icon: "dashboard" },
      { label: "Өртгийн бичилт", href: "/costing/entries", icon: "costing" },
      { label: "Үйлдвэрлэл", href: "/costing/production", icon: "production" },
      {
        label: "Зардлын хуваарилалт",
        href: "/costing/allocations",
        icon: "movement",
      },
      { label: "Өртгийн хяналт", href: "/costing/control", icon: "reconciliation" },
      {
        label: "Бүрэлдэхүүний задаргаа",
        href: "/costing/components",
        icon: "inventory",
      },
      {
        label: "Гүйлгээний дэлгэрэнгүй",
        href: "/costing/detail",
        icon: "spreadsheet",
      },
      { label: "Тайлан", href: "/costing/reports", icon: "reportDetailed" },
      { label: "Тохиргоо", href: "/costing/settings", icon: "settings" },
    ],
  },
  {
    id: "payroll",
    label: "Цалин",
    matchPrefix: "/payroll",
    defaultHref: "/payroll",
    items: [
      { label: "Цалин бодолт", href: "/payroll", icon: "movement" },
      { label: "Ажилтнууд", href: "/payroll/employees", icon: "user" },
    ],
  },
  {
    id: "vat",
    label: "НӨАТ",
    matchPrefix: "/vat",
    defaultHref: "/vat",
    items: [{ label: "Сарын тайлан", href: "/vat", icon: "report" }],
  },
  {
    id: "ai",
    label: "AI туслах",
    matchPrefix: "/ai",
    defaultHref: "/ai",
    items: [
      { label: "Чат", href: "/ai", icon: "ai" },
      { label: "Тохиргоо", href: "/ai/settings", icon: "settings" },
    ],
  },
  {
    // Байгууллагын удирдлага — гишүүд, эрх, аудит. Нягтлан бодох тохиргооноос
    // (Тохиргоо модуль) тусдаа: энд "хэн юу хийж болох"-ыг удирдана.
    id: "admin",
    label: "Удирдлага",
    matchPrefix: "/admin",
    defaultHref: "/admin/org",
    items: [
      { label: "Байгууллага, гишүүд", href: "/admin/org", icon: "company" },
      { label: "Аудитын мөр", href: "/admin/audit", icon: "journal" },
    ],
  },
  {
    id: "settings",
    label: "Тохиргоо",
    matchPrefix: "/settings",
    defaultHref: "/settings/profile",
    items: [
      { label: "Хэрэглэгчийн профайл", href: "/settings/profile", icon: "user" },
      { label: "Компанийн мэдээлэл", href: "/settings/company", icon: "company" },
      { label: "Ерөнхий журналын тохиргоо", href: "/settings/gl", icon: "settings" },
      { label: "Тайлант үе", href: "/settings/periods", icon: "period" },
      { label: "UI Kit", href: "/settings/ui-kit", icon: "theme" },
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
