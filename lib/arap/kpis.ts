// АР/АП самбарын KPI — ЦЭВЭР, client-safe (tests/arap-kpis.test.ts).
//
// ENT-017: «Нийт өглөг», «Нээлттэй», «Хэтэрсэн» нь НООРОГ нэхэмжлэхийг ч
// тоолдог байсан (80 сая ₮-ийн ноорог байхад батлагдсан өглөг 21.5 сая атлаа
// 101.7 сая гэж харагдав). Ноорог нь өр биш — зөвхөн БАТЛАГДСАН
// (posted / partially_paid) баримт тоологдоно; ноорог тусдаа тоологдоно.

export interface ArapKpiDocument {
  documentType: string;
  status: string;
  dueDate: string;
  date: string;
  baseBalance: number;
}

/** Өр/авлагад тоологдох төлөв — батлагдсан, бүрэн төлөгдөөгүй. */
export function isOutstandingStatus(status: string): boolean {
  return status === "posted" || status === "partially_paid";
}

export function arapKpis(documents: ArapKpiDocument[], asOf: string) {
  let ar = 0;
  let ap = 0;
  let open = 0;
  let overdue = 0;
  let overdueCount = 0;
  let draftCount = 0;
  let draftAmount = 0;
  for (const doc of documents) {
    if (doc.status === "draft") {
      draftCount += 1;
      draftAmount += doc.baseBalance;
      continue;
    }
    if (!isOutstandingStatus(doc.status)) continue;
    if (doc.documentType === "ar_invoice") ar += doc.baseBalance;
    if (doc.documentType === "ap_bill") ap += doc.baseBalance;
    open += doc.baseBalance;
    if (doc.dueDate < asOf && doc.baseBalance > 0.005) {
      overdue += doc.baseBalance;
      overdueCount += 1;
    }
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    arBalance: round(ar),
    apBalance: round(ap),
    openBalance: round(open),
    overdueBalance: round(overdue),
    overdueCount,
    draftCount,
    draftAmount: round(draftAmount),
  };
}
