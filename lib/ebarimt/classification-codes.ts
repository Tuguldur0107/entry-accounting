// eBarimt ангиллын кодын АЛБАН жагсаалт — SERVER талд л ачаална (client bundle-д
// оруулахгүй: хэдэн мянган мөр). Хайлт нь `lib/actions/ebarimt-classification.ts`.
//
// ӨГӨГДӨЛ: `classification-codes.json` — ҮСХ-ын АЛБАН «Бүтээгдэхүүн, үйлчилгээний
// нэгдсэн ангилал» (2011) PDF-ээс (мерчантын багц `Angilal/buteegdehuun
// uilchilgeenii negdsen angilal.pdf`, х.4–91) 3499 код:
//   python3 scripts/extract-buna-pdf.py <pdf> buna.csv
//   node scripts/build-ebarimt-classifications.mjs buna.csv
// Багцын `gs1_gs1.xlsx`-ийг ХЭРЭГЛЭХГҮЙ — тэргүүлэх 0 алдагдсан, нэр тасарсан.
// Жагсаалтад байхгүй 7 оронтой кодыг гараар бичихийг зөвшөөрнө (код ЗОХИОХГҮЙ).

import raw from "./classification-codes.json";
import { normalizeClassificationEntries, type ClassificationEntry } from "./classification-search";

export const EBARIMT_CLASSIFICATIONS: readonly ClassificationEntry[] = normalizeClassificationEntries(
  raw as { code?: unknown; name?: unknown }[]
);
