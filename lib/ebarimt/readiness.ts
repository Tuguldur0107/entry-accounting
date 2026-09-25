// eBarimt 3.0 — НЭВТРҮҮЛЭЛТИЙН БЭЛЭН БАЙДАЛ (ЦЭВЭР, DB-гүй, client-safe).
// docs/deployment/ebarimt.md §3 алхам 2–4.
//
// ШАЛТГААН: `ebarimtSettingsProblems` нь зөвхөн МЕРЧАНТЫН тохиргоог (ТТД,
// салбар, дүүрэг, posNo, URL) шалгадаг. Барааны ангилалын код, төлбөрийн
// хэлбэрийн код дутуу байвал алдаа нь БОРЛУУЛАЛТ БОЛСНЫ ДАРАА, дараалалд
// async гарч ирдэг (`[EBARIMT_UNMAPPED_ITEM]` / `[EBARIMT_TAX_PRODUCT_CODE]` /
// `[EBARIMT_UNMAPPED_PAYMENT]`) — кассчин баримтгүй үйлчлүүлэгчтэй үлдэнэ.
// Иймд switch АСААХААС ӨМНӨ эдгээрийг энд урьдчилж тоолно.
//
// Код ЗОХИОХГҮЙ (CLAUDE.md §5c) — зөвхөн дутууг НЭРЛЭНЭ.

import { effectiveCategoryClassification } from "@/lib/inventory/category-tree";
import { CLASSIFICATION_CODE_RE, EBARIMT_PAYMENT_CODES, isKnownEbarimtPaymentCode, TAX_PRODUCT_CODE_RE } from "./constants";

/**
 * Ангиллын лавлах — барааны код хоосон бол ЭНДЭЭС өвлөнө (queue.ts prepare-тай
 * ИЖИЛ дүрэм). `id`/`parentId` өгвөл ангилал хоосон үед ЭЦЭГ рүү өгсөнө
 * (олон түвшинтэй мод — lib/inventory/category-tree.ts).
 */
export interface ReadinessCategory {
  code: string;
  name: string;
  ebarimtClassificationCode: string | null;
  id?: string;
  parentId?: string | null;
}

/** Ангиллын код → өвлөгдсөн (өөр → эцэг → …) eBarimt ангилал. */
export function categoryClassificationMap(
  categories: readonly ReadinessCategory[]
): Map<string, string | null> {
  const nodes = categories.map((category) => ({
    id: category.id ?? `code:${category.code}`,
    code: category.code,
    name: category.name,
    parentId: category.parentId ?? null,
    isActive: true,
    ebarimtClassificationCode: category.ebarimtClassificationCode,
  }));
  return new Map(
    categories.map((category) => [category.code, effectiveCategoryClassification(category.code, nodes)])
  );
}

export interface ReadinessItem {
  name: string;
  /** Барааны бүлгийн код (`inventory_items.categoryCode`); хоосон бол өвлөх бүлэггүй. */
  categoryCode: string | null;
  ebarimtClassificationCode: string | null;
  ebarimtTaxProductCode: string | null;
  /** `standard` → VAT_ABLE; `exempt`/`zero` → татварын бүтээгдэхүүний код ЗААВАЛ. */
  vatMode: "standard" | "exempt" | "zero";
}

export interface ReadinessPaymentMethod {
  name: string;
  ebarimtCode: string | null;
}

export interface EbarimtReadinessInput {
  items: ReadinessItem[];
  categories: ReadinessCategory[];
  paymentMethods: ReadinessPaymentMethod[];
}

/** Нэг бүлгийн дутуу — тоо + жишээ нэрс (UI-д бүгдийг нь асгахгүй). */
export interface ReadinessGap {
  count: number;
  /** Эхний `SAMPLE_LIMIT` нэр — хаанаас эхлэхийг заана. */
  sample: string[];
}

export interface EbarimtReadiness {
  /** Ангилалын код (7 орон) олдохгүй идэвхтэй бараа. */
  items: ReadinessGap;
  /** НӨАТ-гүй / 0%-ийн бараанд татварын бүтээгдэхүүний код (3 орон) алга. */
  taxProduct: ReadinessGap;
  /** `ebarimtCode` оноогоогүй идэвхтэй төлбөрийн хэлбэр. */
  payments: ReadinessGap;
  /**
   * PosAPI 3.0 албан жагсаалтад (`EBARIMT_PAYMENT_CODES`) БАЙХГҮЙ кодтой хэлбэр —
   * `"Нэр (КОД)"`. Хориглолт биш (ТЕГ код нэмж болно), анхааруулга (docs/integrations/01 P1-4).
   */
  unknownPaymentCodes: ReadinessGap;
  /** МОНГОЛ текстээр — UI ба action-ий алдаанд шууд хэрэглэнэ. */
  problems: string[];
  /** Блоклохгүй анхааруулга (МОНГОЛ) — `ready`-д нөлөөлөхгүй. */
  warnings: string[];
  ready: boolean;
}

export const READINESS_SAMPLE_LIMIT = 5;

const EMPTY_GAP: ReadinessGap = { count: 0, sample: [] };

/** Барааны код → байхгүй бол бүлгийнх (queue.ts `prepare`-ийн өвлөлттэй ИЖИЛ). */
export function effectiveClassificationCode(
  item: Pick<ReadinessItem, "categoryCode" | "ebarimtClassificationCode">,
  categoryClassification: Map<string, string | null>
): string | null {
  const own = item.ebarimtClassificationCode?.trim();
  if (own) return own;
  if (!item.categoryCode) return null;
  return categoryClassification.get(item.categoryCode)?.trim() || null;
}

function gap(names: string[]): ReadinessGap {
  if (names.length === 0) return EMPTY_GAP;
  return { count: names.length, sample: names.slice(0, READINESS_SAMPLE_LIMIT) };
}

function sampleText(entry: ReadinessGap): string {
  const more = entry.count - entry.sample.length;
  return entry.sample.join(", ") + (more > 0 ? ` … (+${more})` : "");
}

/**
 * Борлуулалт бүр баримт болж чадах эсэхийг УРЬДЧИЛЖ шалгана.
 * Зөвхөн ИДЭВХТЭЙ бараа / хэлбэрийг дуудагч өгнө — архивласан бараа зарагдахгүй.
 */
export function ebarimtReadiness(input: EbarimtReadinessInput): EbarimtReadiness {
  const categoryClassification = categoryClassificationMap(input.categories);

  const missingClassification: string[] = [];
  const missingTaxProduct: string[] = [];
  for (const item of input.items) {
    const classification = effectiveClassificationCode(item, categoryClassification);
    if (!classification || !CLASSIFICATION_CODE_RE.test(classification)) {
      missingClassification.push(item.name);
    }
    if (item.vatMode === "exempt" || item.vatMode === "zero") {
      const taxProduct = item.ebarimtTaxProductCode?.trim() ?? "";
      if (!TAX_PRODUCT_CODE_RE.test(taxProduct)) missingTaxProduct.push(item.name);
    }
  }

  const missingPayments = input.paymentMethods
    .filter((method) => !method.ebarimtCode?.trim())
    .map((method) => method.name);
  const unknownCodes = input.paymentMethods
    .filter((method) => method.ebarimtCode?.trim() && !isKnownEbarimtPaymentCode(method.ebarimtCode))
    .map((method) => `${method.name} (${method.ebarimtCode!.trim().toUpperCase()})`);

  const items = gap(missingClassification);
  const taxProduct = gap(missingTaxProduct);
  const payments = gap(missingPayments);
  const unknownPaymentCodes = gap(unknownCodes);

  const problems: string[] = [];
  if (items.count > 0)
    problems.push(
      `${items.count} бараанд ТЕГ-ийн ангилалын код (7 орон) алга: ${sampleText(items)}`
    );
  if (taxProduct.count > 0)
    problems.push(
      `${taxProduct.count} НӨАТ-гүй/0% бараанд татварын бүтээгдэхүүний код (3 орон) алга: ${sampleText(taxProduct)}`
    );
  if (payments.count > 0)
    problems.push(
      `${payments.count} төлбөрийн хэлбэрт eBarimt код алга: ${sampleText(payments)}`
    );

  const warnings: string[] = [];
  if (unknownPaymentCodes.count > 0)
    warnings.push(
      `${unknownPaymentCodes.count} төлбөрийн хэлбэрийн eBarimt код ТЕГ-ийн албан жагсаалтад (${EBARIMT_PAYMENT_CODES.join(", ")}) байхгүй — PosAPI татгалзаж болзошгүй: ${sampleText(unknownPaymentCodes)}`
    );

  return { items, taxProduct, payments, unknownPaymentCodes, problems, warnings, ready: problems.length === 0 };
}
