// Бараа материалын тайлангийн таб / дэд табын ЦЭВЭР тодорхойлолт.
//
// ⚠️ Энэ модуль `"use client"` БАЙХГҮЙ — SERVER component (тайлангийн
// page.tsx) URL-ийн параметрийг шалгахдаа `isSalesView`-г ДУУДДАГ. Урьд нь
// эдгээр нь `components/pos/sales-report-view.tsx` («use client») дотор
// байсан тул `/inventory/reports?tab=sales` нээхэд production дээр
//   «Attempted to call isSalesView() from the server but isSalesView is on
//    the client»
// гэж унаж, Борлуулалтын таб ОГТ нээгддэггүй байв (2026-09-24).
//
// Хэв маяг нь CLAUDE.md-ийн client/server хилийн дүрэмтэй ижил: цэвэр
// логик/тогтмолыг тусдаа модульд гаргаж, аль ч тал импортлоно.
// `tests/client-server-boundary.test.ts` энэ ангиллыг статикаар барина.

/**
 * Тайлангийн хуудасны `?tab=` — ӨӨР хоёр тайлан, топбарын сонгогчоор л
 * солигдоно (lib/constants/report-registry.ts, хуудас доторх таб БАЙХГҮЙ).
 */
export type InventoryReportTab = "flow" | "sales";

/** Борлуулалтын тайлангийн дэд таб (docs/pos §5). */
export const SALES_VIEWS = [
  "lines",
  "items",
  "days",
  "warehouses",
  "cashiers",
  "methods",
  "customers",
  "rules",
] as const;

export type SalesView = (typeof SALES_VIEWS)[number];

export const SALES_VIEW_TABS: { value: SalesView; label: string }[] = [
  { value: "lines", label: "Гүйлгээ" },
  { value: "items", label: "Бараагаар" },
  { value: "days", label: "Өдрөөр" },
  { value: "warehouses", label: "Салбараар" },
  { value: "cashiers", label: "Кассчинаар" },
  { value: "methods", label: "Төлбөрийн хэлбэрээр" },
  { value: "customers", label: "Харилцагчаар" },
  { value: "rules", label: "Хөнгөлөлтийн үр ашиг" },
];

/** URL-ийн `?view=` утга хүчинтэй дэд таб мөн эсэх (server ба client хоёулаа). */
export function isSalesView(value: string | undefined | null): value is SalesView {
  return SALES_VIEWS.includes(value as SalesView);
}

/** URL-ийн `?tab=` утга — танихгүй бол «flow». */
export function toInventoryReportTab(
  value: string | undefined | null
): InventoryReportTab {
  return value === "sales" ? "sales" : "flow";
}
