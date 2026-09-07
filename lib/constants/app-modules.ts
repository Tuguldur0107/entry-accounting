// Системийн модулийн тохиргооны бүртгэл (Тохиргоо → Модулийн тохиргоо).
//
// Хоёр өөр ойлголтыг НЭГ түлхүүрээр холбоно:
//   - module_configs.moduleKey — асаах/унтраах тохиргооны мөр
//   - navId — навигацийн модуль (components/layout/modules.ts) — унтраахад
//     switcher, палитр, "+ Шинэ" цэснээс нуугдана
//   - accountModuleKey — дансны модулийн багана (standard-accounts ModuleKey)
//
// Дансны per-account модулийн жагсаалт (ALL_MODULES) үүнээс ТУСДАА хэвээр:
// Татвар, Цалин, AI нь дансны багана биш тул accountModuleKey-гүй.

import type { ModuleKey } from "@/lib/constants/standard-accounts";

export type AppModuleGroup = "core" | "accounting" | "extra";

export interface AppModuleDef {
  /** module_configs.moduleKey */
  key: string;
  nameMn: string;
  name: string;
  description: string;
  group: AppModuleGroup;
  /** Навигацийн модулийн id — байхгүй бол nav-д нөлөөгүй. */
  navId?: string;
  /** Дансны модулийн багана — байхгүй бол дансны тохиргоонд гарахгүй. */
  accountModuleKey?: ModuleKey;
  /** Унтраах боломжгүй цөм модуль (GL). */
  locked?: boolean;
}

export const APP_MODULE_GROUP_LABELS: Record<
  AppModuleGroup,
  { title: string; description: string }
> = {
  core: {
    title: "Цөм",
    description: "Системийн суурь — унтраах боломжгүй.",
  },
  accounting: {
    title: "Үндсэн нягтлан бодох бүртгэлийн багц",
    description:
      "Өдөр тутмын бүртгэлийн модулиуд — багцаараа эсвэл нэг нэгээр нь асааж унтраана.",
  },
  extra: {
    title: "Нэмэлт",
    description: "Группын бүртгэл, AI туслах зэрэг нэмэлт чадварууд.",
  },
};

export const APP_MODULE_DEFS: AppModuleDef[] = [
  {
    key: "gl",
    nameMn: "Ерөнхий журнал",
    name: "General Ledger",
    description: "Журнал бичилт, дансны тохиргоо, GL тайлан",
    group: "core",
    navId: "gl",
    accountModuleKey: "gl",
    locked: true,
  },
  {
    key: "cash",
    nameMn: "Мөнгөн хөрөнгө",
    name: "Cash Management",
    description: "Касс, банк, хуулга, тулгалт, ханшийн тэгшитгэл",
    group: "accounting",
    navId: "cash",
    accountModuleKey: "cash",
  },
  {
    key: "ar",
    nameMn: "Авлага",
    name: "Accounts Receivable",
    description: "Нэхэмжлэл, харилцагчийн авлага, орлого бүртгэл",
    group: "accounting",
    navId: "receivables",
    accountModuleKey: "ar",
  },
  {
    key: "ap",
    nameMn: "Өглөг",
    name: "Accounts Payable",
    description: "Нийлүүлэгчийн нэхэмжлэх, өглөг, төлбөр",
    group: "accounting",
    navId: "payables",
    accountModuleKey: "ap",
  },
  {
    key: "inv",
    nameMn: "Бараа материал",
    name: "Inventory",
    description: "Бараа, агуулах, тоо хэмжээний хөдөлгөөн, тооллого",
    group: "accounting",
    navId: "inventory",
    accountModuleKey: "inv",
  },
  {
    key: "cost",
    nameMn: "Өртгийн бүртгэл",
    name: "Cost Accounting",
    description: "Жигнэсэн дундаж өртөг, үйлдвэрлэл, зардлын хуваарилалт",
    group: "accounting",
    navId: "costing",
    accountModuleKey: "cost",
  },
  {
    key: "fa",
    nameMn: "Үндсэн хөрөнгө",
    name: "Fixed Assets",
    description: "Хөрөнгийн бүртгэл, элэгдэл, данснаас хасалт",
    group: "accounting",
    navId: "fa",
    accountModuleKey: "fa",
  },
  {
    key: "tax",
    nameMn: "Татвар",
    name: "Tax",
    description: "НӨАТ, ХХОАТ, НДШ, ААНОАТ, суутган — тайлан, өр, төлөлт",
    group: "accounting",
    navId: "tax",
  },
  {
    key: "payroll",
    nameMn: "Цалин",
    name: "Payroll",
    description: "Цалин бодолт, НДШ/ХХОАТ суутгал, ажилтнууд",
    group: "accounting",
    navId: "payroll",
  },
  {
    key: "agis",
    nameMn: "Групп компанийн бүртгэл",
    name: "Inter-Company (AGIS)",
    description: "IC журнал, элиминейшн, нэгтгэсэн тайлан (S6 сегмент)",
    group: "extra",
    accountModuleKey: "agis",
  },
  {
    key: "ai",
    nameMn: "AI туслах",
    name: "AI Assistant",
    description: "Чат, tool-үүд, топбарын AI товч",
    group: "extra",
    navId: "ai",
  },
];
