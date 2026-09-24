// Бүх модулийн тайлангийн НЭГДСЭН бүртгэл — топбарын HeaderReportSelect
// болон GL-ийн ReportsView хоёул эндээс уншина (өмнө нь хоёр газар хатуу
// жагсаалт давхардаж, гараар sync хийх шаардлагатай байсан).
//
// Мөр нэмэх дүрэм: тайлан нь ӨӨРИЙН route-той (эсвэл ?report= параметртэй)
// байх ёстой; модулийн самбар (dashboard) энд орохгүй — зөвхөн тайлан.
// Costing-ийн тайлангууд docs/cost/03-ын спецээр тогтмол тул зөвхөн
// холбоос нь энд бүртгэгдэнэ (бүтэц нь өөрчлөгдөхгүй).

export type ReportEntry = {
  /** Модуль дотроо давтагдашгүй утга (GL-д ?report=-ийн утга). */
  value: string;
  label: string;
  /** Бүтэн зам (query параметртэйгээ). */
  href: string;
};

export type ReportModule = {
  moduleId: string;
  moduleLabel: string;
  /** Тайлангийн хуудасны зам — сонгогч энэ зам дээр идэвхтэй утгаа таньдаг. */
  basePath: string;
  /**
   * Нэг хуудсанд ӨӨР тайлангууд URL параметрээр солигддог бол тэр
   * параметрийн нэр (GL `report`, Бараа `tab`, Цалин `view`). Эхний мөр нь
   * параметргүй (default) тайлан. Байхгүй бол мөр бүр өөрийн route-тай.
   */
  param?: string;
  entries: ReportEntry[];
};

export const REPORT_REGISTRY: readonly ReportModule[] = [
  {
    moduleId: "gl",
    moduleLabel: "Ерөнхий журнал",
    basePath: "/gl/reports",
    param: "report",
    entries: [
      { value: "gl-balance", label: "Гүйлгээ баланс", href: "/gl/reports?report=gl-balance" },
      { value: "balance-sheet", label: "Баланс", href: "/gl/reports?report=balance-sheet" },
      {
        value: "income-statement",
        label: "Орлогын тайлан",
        href: "/gl/reports?report=income-statement",
      },
      {
        value: "cash-flow",
        label: "Мөнгөн гүйлгээний тайлан",
        href: "/gl/reports?report=cash-flow",
      },
    ],
  },
  {
    moduleId: "cash",
    moduleLabel: "Мөнгөн хөрөнгө",
    basePath: "/cash/reports",
    entries: [
      {
        value: "cash-reports",
        label: "Мөнгөн хөдөлгөөний тайлан",
        href: "/cash/reports",
      },
    ],
  },
  {
    moduleId: "receivables",
    moduleLabel: "Авлага",
    basePath: "/receivables/reports",
    entries: [
      {
        value: "ar-aging",
        label: "Авлагын насжилт",
        href: "/receivables/reports",
      },
    ],
  },
  {
    moduleId: "payables",
    moduleLabel: "Өглөг",
    basePath: "/payables/reports",
    entries: [
      { value: "ap-aging", label: "Өглөгийн насжилт", href: "/payables/reports" },
    ],
  },
  {
    moduleId: "inventory",
    moduleLabel: "Бараа материал",
    basePath: "/inventory/reports",
    param: "tab",
    entries: [
      { value: "flow", label: "Тоо хэмжээний урсгал", href: "/inventory/reports" },
      {
        value: "sales",
        label: "Борлуулалтын тайлан (POS)",
        href: "/inventory/reports?tab=sales",
      },
    ],
  },
  {
    moduleId: "fa",
    moduleLabel: "Үндсэн хөрөнгө",
    basePath: "/fa/reports",
    entries: [
      {
        value: "fa-register",
        label: "Хөрөнгийн бүртгэл, элэгдэл",
        href: "/fa/reports",
      },
    ],
  },
  {
    moduleId: "costing",
    moduleLabel: "Өртөг",
    basePath: "/costing/reports",
    entries: [
      {
        value: "costing-control",
        label: "Өртгийн хяналт",
        href: "/costing/reports",
      },
      {
        value: "costing-valuation",
        label: "Нөөцийн үнэлгээ · NRV",
        href: "/costing/reports/valuation",
      },
      {
        value: "costing-detail",
        label: "Гүйлгээний дэлгэрэнгүй",
        href: "/costing/reports/detail",
      },
      {
        value: "costing-components",
        label: "Бүрэлдэхүүний задаргаа",
        href: "/costing/reports/components",
      },
    ],
  },
  {
    moduleId: "procurement",
    moduleLabel: "Хангамж",
    basePath: "/procurement/reports",
    entries: [
      {
        value: "procurement-performance",
        label: "Захиалгын гүйцэтгэл",
        href: "/procurement/reports",
      },
    ],
  },
  {
    moduleId: "payroll",
    moduleLabel: "Цалин",
    basePath: "/payroll/reports",
    param: "view",
    entries: [
      { value: "payment", label: "Банкны олголт", href: "/payroll/reports" },
      { value: "payslip", label: "Цалингийн хуудас", href: "/payroll/reports?view=payslip" },
    ],
  },
  {
    moduleId: "tax",
    moduleLabel: "Татвар",
    basePath: "/tax",
    entries: [
      { value: "tax-vat", label: "НӨАТ — сарын тайлан", href: "/tax/vat" },
      { value: "tax-pit", label: "ХХОАТ — цалингийн нэгтгэл", href: "/tax/pit" },
      { value: "tax-ndsh", label: "НДШ — шимтгэлийн нэгтгэл", href: "/tax/ndsh" },
      { value: "tax-cit", label: "ААНОАТ — улирлын тооцоо", href: "/tax/cit" },
      { value: "tax-wht", label: "Суутган татвар (WHT)", href: "/tax/wht" },
      { value: "tax-customs", label: "Гаалийн татвар", href: "/tax/customs" },
      { value: "tax-property", label: "Хөрөнгийн татвар", href: "/tax/property" },
    ],
  },
];

/** GL-ийн ?report= параметрын хүчинтэй утгууд (ReportsView-тэй хуваалцана). */
export const GL_REPORT_VALUES = REPORT_REGISTRY.find(
  (module) => module.moduleId === "gl"
)!.entries.map((entry) => entry.value);

/**
 * Одоогийн зам аль тайланд таарч буйг олно. Параметртэй модульд (GL
 * `?report=`, Бараа `?tab=`, Цалин `?view=`) параметрын утгаар — утга
 * байхгүй/танигдахгүй бол эхний (default) тайлан; бусдад href-ийн зам
 * хэсгээр (query-гүй) тааруулна.
 */
export function findActiveReportHref(
  pathname: string,
  getParam: (key: string) => string | null
): string | null {
  for (const reportModule of REPORT_REGISTRY) {
    if (reportModule.param) {
      if (pathname !== reportModule.basePath) continue;
      const value = getParam(reportModule.param);
      const byParam = reportModule.entries.find((entry) => entry.value === value);
      return (byParam ?? reportModule.entries[0]).href;
    }
    const byPath = reportModule.entries.find(
      (entry) => entry.href.split("?")[0] === pathname
    );
    if (byPath) return byPath.href;
  }
  return null;
}

/** `href`-ийг агуулсан модуль (сонгогч нэг хуудас доторх шилжилтийг таних). */
export function reportModuleOfHref(href: string): ReportModule | null {
  const [path] = href.split("?");
  return (
    REPORT_REGISTRY.find(
      (reportModule) =>
        (reportModule.param && reportModule.basePath === path) ||
        reportModule.entries.some((entry) => entry.href === href)
    ) ?? null
  );
}
