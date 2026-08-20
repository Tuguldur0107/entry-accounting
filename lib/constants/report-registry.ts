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
  /** true бол basePath дээр ?report= параметрээр олон тайлан солигдоно. */
  usesReportParam?: boolean;
  entries: ReportEntry[];
};

export const REPORT_REGISTRY: readonly ReportModule[] = [
  {
    moduleId: "gl",
    moduleLabel: "Ерөнхий журнал",
    basePath: "/gl/reports",
    usesReportParam: true,
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
    entries: [
      {
        value: "inventory-quantity",
        label: "Тоо хэмжээний тайлан",
        href: "/inventory/reports",
      },
    ],
  },
  {
    moduleId: "costing",
    moduleLabel: "Өртөг",
    basePath: "/costing/reports",
    entries: [
      {
        value: "costing-valuation",
        label: "Нөөцийн үнэлгээ, GL тулгалт",
        href: "/costing/reports",
      },
      { value: "costing-control", label: "Өртгийн хяналт", href: "/costing/control" },
      {
        value: "costing-detail",
        label: "Гүйлгээний дэлгэрэнгүй",
        href: "/costing/detail",
      },
      {
        value: "costing-components",
        label: "Бүрэлдэхүүний задаргаа",
        href: "/costing/components",
      },
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
    ],
  },
];

/** GL-ийн ?report= параметрын хүчинтэй утгууд (ReportsView-тэй хуваалцана). */
export const GL_REPORT_VALUES = REPORT_REGISTRY.find(
  (module) => module.moduleId === "gl"
)!.entries.map((entry) => entry.value);

/**
 * Одоогийн зам аль тайланд таарч буйг олно. GL шиг ?report=-тэй хуудсанд
 * параметрын утгаар, бусдад нь href-ийн зам хэсгээр (query-гүй) тааруулна.
 */
export function findActiveReportHref(
  pathname: string,
  reportParam: string | null
): string | null {
  for (const reportModule of REPORT_REGISTRY) {
    if (reportModule.usesReportParam) {
      if (pathname !== reportModule.basePath) continue;
      const byParam = reportModule.entries.find(
        (entry) => entry.value === reportParam
      );
      return (byParam ?? reportModule.entries[0]).href;
    }
    const byPath = reportModule.entries.find(
      (entry) => entry.href.split("?")[0] === pathname
    );
    if (byPath) return byPath.href;
  }
  return null;
}
