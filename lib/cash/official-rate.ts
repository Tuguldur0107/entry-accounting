// Системийн СУУРЬ ханшийн SERVER талын цорын ганц үүд.
//
// `lib/cash/exchange-rates.ts` нь `"use client"` component-д ч импортлогддог
// (rateForBasis) тул тэнд `@/lib/db`-г татаж БОЛОХГҮЙ — postgres драйвер
// browser bundle-д орж build унана. Иймд хадгалалтын давхарга
// `lib/cash/rate-store.ts`-д амьдарч, импортлогдох мөчдөө өөрийгөө
// бүртгүүлдэг.
//
// Тэр бүртгэл хийгдээгүй орчинд `getOfficialRateForDate` нь ЧИМЭЭГҮЙ шууд
// Монголбанк руу очно (алдаа гарахгүй — зүгээр л хадгалсан түүхээ
// ашиглахгүй). Тиймээс SERVER талын дуудагч бүр `exchange-rates.ts`-ээс
// биш ЭНЭ файлаас импортолно: доорх нэг мөр нь агуулахыг үргэлж холбоно.
import "@/lib/cash/rate-store";

export {
  getOfficialRateForDate,
  type OfficialRateLookup,
} from "@/lib/cash/exchange-rates";
