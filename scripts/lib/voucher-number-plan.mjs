// Дугаар нөхөж олгох ЦЭВЭР логик (DB хөндөхгүй, тесттэй).
//
// `scripts/backfill-voucher-numbers.mjs` нь зөвхөн DB-ийн уншилт/бичилтийг
// хийж, шийдвэрээ ЭНДЭЭС авна. Plain JS — production install-д tsx байхгүй
// байж болзошгүй тул script нь TypeScript импортлохгүй.

/** lib/gl/voucher-no.ts-ийн JOURNAL_MODULE_CODES-тай ЯГ ИЖИЛ байх ЁСТОЙ. */
export const MODULE_CODES = {
  gl: "GL",
  cash: "CM",
  fx: "FX",
  ar: "AR",
  ap: "AP",
  inv: "INV",
  cost: "COST",
  fa: "FA",
  proc: "PROC",
  payroll: "PAY",
  vat: "VAT",
};

const SEQ_DIGITS = 6;

// Next.js-ийн lint дүрэм `module` нэртэй хувьсагч зөвшөөрдөггүй.
export function scopeOf(moduleKey, date) {
  const code = MODULE_CODES[moduleKey];
  if (!code) throw new Error(`Танихгүй модуль: "${moduleKey}"`);
  const year = String(date ?? "").slice(2, 4);
  if (!/^\d{2}$/.test(year))
    throw new Error(`Журналын дугаарын огноо буруу: "${date}"`);
  return `${code}-${year}`;
}

export function formatNo(scope, seq) {
  return `${scope}-${String(seq).padStart(SEQ_DIGITS, "0")}`;
}

/** externalRef-ийн угтвараар модуль — холбоосгүй үлдсэн бичилтэд. */
export function moduleFromExternalRef(ref) {
  if (!ref) return null;
  if (ref.startsWith("vat-settlement:")) return "vat";
  if (ref.startsWith("payroll:")) return "payroll";
  if (ref.startsWith("po-close:") || ref.startsWith("gr-capitalize:"))
    return "proc";
  return null;
}

/**
 * БУЦААЛТ эх журналынхаа модулийг ӨВЛӨНӨ. Эх нь өөрөө тодорхойлогдоогүй
 * байж болох тул өөрчлөлт зогстол давтана (гинжин буцаалт: буцаалтын
 * буцаалт). Мөчлөг үүссэн ч 10 давталтаар таслагдана.
 */
export function inheritReversalModules(vouchers, moduleById) {
  const resolved = new Map(moduleById);
  const parentOf = new Map(
    vouchers
      .filter((voucher) => voucher.reversalOfVoucherId)
      .map((voucher) => [voucher.id, voucher.reversalOfVoucherId])
  );
  for (let pass = 0; pass < 10; pass += 1) {
    let changed = false;
    for (const [child, parent] of parentOf) {
      if (resolved.has(child)) continue;
      const inherited = resolved.get(parent);
      if (inherited) {
        resolved.set(child, inherited);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return resolved;
}

/**
 * Дугааргүй бичилтүүдэд дугаар төлөвлөнө.
 *
 * @param vouchers  дугааргүй бичилтүүд — ОГНООНЫ дарааллаар ирсэн байх ЁСТОЙ
 *                  ({ id, organizationId, date, externalRef, reversalOfVoucherId })
 * @param moduleById  дэд дэвтрийн холбоосоор олдсон модуль (id → түлхүүр)
 * @param usedDocumentNos  аль хэдийн олгогдсон дугаарууд
 *                  ({ organizationId, documentNo }) — тэдгээрийн ДАРААГААС
 *                  үргэлжилнэ, байгааг нь хэзээ ч дахин олгохгүй
 * @returns { updates: [{id, documentNo}], counters: [{organizationId, scope, value}],
 *            byModule: Map<module, count> }
 */
export function planVoucherNumbers({
  vouchers,
  moduleById = new Map(),
  usedDocumentNos = [],
}) {
  const withRef = new Map(moduleById);
  for (const voucher of vouchers) {
    if (withRef.has(voucher.id)) continue;
    const fromRef = moduleFromExternalRef(voucher.externalRef);
    if (fromRef) withRef.set(voucher.id, fromRef);
  }
  const resolved = inheritReversalModules(vouchers, withRef);

  // Scope бүрд аль хэдийн олгогдсон ХАМГИЙН ИХ дугаараас үргэлжилнэ.
  const cursor = new Map();
  for (const row of usedDocumentNos) {
    const match = /^([A-Z]+-\d{2})-(\d+)$/.exec(row.documentNo ?? "");
    if (!match) continue;
    const key = `${row.organizationId}|${match[1]}`;
    cursor.set(key, Math.max(cursor.get(key) ?? 0, Number(match[2])));
  }

  const updates = [];
  const byModule = new Map();
  for (const voucher of vouchers) {
    const moduleKey = resolved.get(voucher.id) ?? "gl";
    byModule.set(moduleKey, (byModule.get(moduleKey) ?? 0) + 1);
    const scope = scopeOf(moduleKey, voucher.date);
    const key = `${voucher.organizationId}|${scope}`;
    const seq = (cursor.get(key) ?? 0) + 1;
    cursor.set(key, seq);
    updates.push({ id: voucher.id, documentNo: formatNo(scope, seq) });
  }

  const counters = [...cursor.entries()].map(([key, value]) => {
    const separator = key.lastIndexOf("|");
    return {
      organizationId: key.slice(0, separator),
      scope: key.slice(separator + 1),
      value,
    };
  });

  return { updates, counters, byModule };
}
