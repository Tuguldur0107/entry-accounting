// QPay АСААХААС ӨМНӨХ бэлэн байдал (ЦЭВЭР, DB-гүй, client-safe) — eBarimt-ийн
// readiness.ts-тэй ижил зарчим: дутууг НЭРЛЭНЭ, зохиохгүй.

import { QPAY_PROVIDER } from "./constants";

export interface QpayReadinessInput {
  apiUrl: string;
  apiKeySet: boolean;
  webhookSecretSet: boolean;
  /** NEXT_PUBLIC_APP_URL — webhook хүрэх нийтийн URL (dedicated on-prem-д байхгүй байж болно). */
  publicUrl: string | null;
  paymentMethods: { name: string; kind: string; provider: string | null; cashAccountId: string | null; isActive: boolean }[];
  /**
   * true (default) = асаах мөчид `ensureQpayPaymentMethod` хэлбэр + түр дансыг
   * АВТОМАТААР бүрдүүлнэ — дутуу нь хориг биш, тайлбар (warning). false = хатуу
   * шалгалт (seed-ийн ДАРАА, saveQpaySettings дотор).
   */
  seedOnEnable?: boolean;
}

export interface QpayReadiness {
  problems: string[];
  /** Нийтийн URL алга — хориг БИШ, анхааруулга (polling нөөц зам ажиллана). */
  warnings: string[];
  ready: boolean;
}

export function qpayReadiness(input: QpayReadinessInput): QpayReadiness {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!/^https?:\/\/\S+$/.test(input.apiUrl.trim())) problems.push("Dashboard URL http(s)://… хэлбэртэй байна");
  if (!input.apiKeySet) problems.push("API key оруулаагүй (dashboard → Merchants → API хөгжүүлэлт)");
  if (!input.webhookSecretSet) problems.push("Webhook secret оруулаагүй (API key-тэй нэг дэлгэцэнд)");
  const seed = input.seedOnEnable ?? true;
  const qpayMethods = input.paymentMethods.filter((m) => m.provider === QPAY_PROVIDER && m.isActive);
  if (qpayMethods.length === 0) {
    if (seed) warnings.push("QPay төлбөрийн хэлбэр («QPay», ewallet) ба «QPay түр данс» асаахад автоматаар үүснэ");
    else problems.push("QPay төлбөрийн хэлбэр алга — «Төлбөрийн хэлбэр» табд ewallet + провайдер QPay нэмнэ");
  }
  for (const method of qpayMethods) {
    if (method.kind !== "ewallet") problems.push(`«${method.name}»: QPay провайдер зөвхөн ewallet төрөлд`);
    if (!method.cashAccountId) {
      if (seed) warnings.push(`«${method.name}»: түр данс оноогоогүй — асаахад «QPay түр данс» автоматаар оноогдоно`);
      else problems.push(`«${method.name}»: QPay түр данс (касс/банк) оноогоогүй`);
    }
  }
  if (!input.publicUrl)
    warnings.push(
      "Нийтийн URL (NEXT_PUBLIC_APP_URL) тохируулаагүй — webhook хүрэхгүй, төлбөр зөвхөн [Шалгах] товчоор баталгаажина"
    );
  return { problems, warnings, ready: problems.length === 0 };
}
