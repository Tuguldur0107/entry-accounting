// Хангамжийн төлөв/дүнгийн ХАРАГДАХ хэлбэр — ЦОРЫН ГАНЦ эх сурвалж.
// Жагсаалт, самбар, панель, палитрын хайлт бүгд эндээс уншина (давхардуулж
// дахин зарлахыг хориглоно). Plain модуль тул server болон client хоёул
// импортолж чадна.

import type { StatusTone } from "@/components/ui/status-badge";
import { fmtMnt } from "@/lib/reports/balances";
import type {
  GoodsReceiptStatus,
  PurchaseOrderStatus,
} from "@/lib/procurement/types";

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Ноорог",
  open: "Нээлттэй",
  closed: "Хаагдсан",
  cancelled: "Цуцлагдсан",
};

// "Нээлттэй" нь анхаарал шаардсан төлөв: хүлээн авалттай нээлттэй захиалга
// сарын хаалтыг ХОРИГЛОДОГ (docs/procurement §3.3 ⑧) тул warning өнгөтэй.
export const PO_STATUS_TONES: Record<PurchaseOrderStatus, StatusTone> = {
  draft: "muted",
  open: "warning",
  closed: "success",
  cancelled: "danger",
};

export const GR_STATUS_LABELS: Record<GoodsReceiptStatus, string> = {
  draft: "Ноорог",
  confirmed: "Батлагдсан",
  reversed: "Буцаагдсан",
};

export const GR_STATUS_TONES: Record<GoodsReceiptStatus, StatusTone> = {
  draft: "muted",
  confirmed: "success",
  reversed: "danger",
};

/**
 * Захиалгын дүн нь PO ВАЛЮТААР харагдана (MNT бол мөнгөн формат, бусад
 * валютад кодтойгоо) — MNT-ээр бөөрөнхийлж үзүүлбэл валютын дүн мэт
 * ойлгогдох тул хэзээ ч хөрвүүлэхгүй.
 */
export function fmtCurrencyAmount(amount: number, currency: string) {
  if (currency === "MNT") return fmtMnt(amount);
  return `${amount.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })} ${currency}`;
}
