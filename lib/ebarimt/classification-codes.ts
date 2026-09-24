// eBarimt ангиллын кодын АЛБАН жагсаалт — SERVER талд л ачаална (client bundle-д
// оруулахгүй: хэдэн мянган мөр). Хайлт нь `lib/actions/ebarimt-classification.ts`.
//
// ӨГӨГДӨЛ: `classification-codes.json` — ТЕГ/ҮСХ-ын албан файлаас
// `node scripts/build-ebarimt-classifications.mjs <файл.xlsx|csv>` үүсгэнэ.
// Хоосон бол сонгогч зөвхөн байгууллагын хэрэглэж буй кодыг санал болгож,
// 7 оронтой кодыг гараар бичихийг зөвшөөрнө (код ЗОХИОХГҮЙ).

import raw from "./classification-codes.json";
import { normalizeClassificationEntries, type ClassificationEntry } from "./classification-search";

export const EBARIMT_CLASSIFICATIONS: readonly ClassificationEntry[] = normalizeClassificationEntries(
  raw as { code?: unknown; name?: unknown }[]
);
