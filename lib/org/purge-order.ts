// Байгууллага устгах ДАРААЛАЛ — ЦЭВЭР (tests/org-purge.test.ts).
//
// Яагаад: 46 FK `ON DELETE RESTRICT` (баримт → харилцагч, PO мөр → бараа,
// цалингийн мөр → ажилтан …) тул `delete from organizations` нь cascade-ийн
// ДУНДААС гацдаг байв — цалин, POS, PO, АР/АП төлбөртэй байгууллага
// устгагдахгүй. RESTRICT нь өгөгдлийн хамгаалалт (ашиглагдсан мастер датаг
// гараар устгахаас) тул схемийг сулруулахгүй: байгууллага устгахдаа гүйлгээний
// хүснэгтүүдийг ЭНЭ дарааллаар (хүүхэд → эцэг) `organization_id`-аар устгаад,
// үлдсэнийг нь байгууллагын cascade-д үлдээнэ.
//
// Дараалал ИЛ жагсаалт (каталогоос динамикаар бодохгүй) — устгах хүрээ
// үргэлж уншигдахуйц. Шинэ RESTRICT FK нэмэгдэхэд `findPurgeViolations`-ийг
// DB-ийн каталогоор ажиллуулдаг integration тест УНАЖ, энд бүртгэхийг шаардана.

/**
 * `organization_id`-аар ЭНЭ дарааллаар устгагдах хүснэгтүүд. Мөр бүр өмнөх
 * мөрүүдийн хүүхдийг устгасны ДАРАА л эцэг болно. Жагсаалтад байхгүй мөр
 * (журнал, мастер дата, тохиргоо …) нь сүүлд `organizations`-ийн cascade-аар.
 */
export const ORG_PURGE_ORDER = [
  // POS: борлуулалт (мөр, төлбөр, хөнгөлөлт cascade) → АР, касс, бараа, ээлжийг заана
  "pos_sales",
  "pos_store_credits",
  "pos_shifts",
  // Өртөг: хуваарилалт (мөр cascade) → АР/АП мөр, PO, хөдөлгөөн; бичилт → бараа
  "cost_allocations",
  "cost_entries",
  // Тооцоо, касс (найдваргүй авлагын хасалт → нэхэмжлэх, журнал; сэргэлт cascade)
  "arap_write_offs",
  "ar_ap_settlements",
  "cash_fx_revaluations",
  "cash_documents",
  "bank_statements",
  // Хангамж: хүлээн авалт → PO мөр; нэхэмжлэх → PO; PO → харилцагч, бараа
  "goods_receipts",
  "ar_ap_documents",
  "purchase_orders",
  // Бараа, цалин, ҮХ
  "inventory_movements",
  "payroll_runs",
  "fa_depreciation_entries",
] as const;

export type OrgPurgeTable = (typeof ORG_PURGE_ORDER)[number];

/** DB каталогийн нэг FK (pg_constraint-оос). */
export interface ForeignKeyInfo {
  child: string;
  parent: string;
  /** pg `confdeltype`: c cascade · n set null · d set default · r restrict · a no action */
  onDelete: "c" | "n" | "d" | "r" | "a";
  /** FK-ийн бүх багана NOT NULL эсэх (мөр бүр эцэгтэй юу). */
  notNull: boolean;
}

export interface PurgeViolation {
  child: string;
  parent: string;
  reason: string;
}

const ROOT = "organizations";

/**
 * Дарааллыг FK-ийн графаар шалгана. Алхам: жагсаалтын i-р хүснэгт = i,
 * байгууллагын устгалт = N. Хүснэгт бүрд:
 *  - start — энэ байгууллагын мөр АНХ устаж эхлэх алхам (жагсаалт эсвэл
 *    cascade-ийн эцгийн start);
 *  - done  — БҮХ мөр нь устсан алхам (жагсаалт, эсвэл NOT NULL cascade эцгийн
 *    done — мөр бүр тэр эцэгтэй тул хамт устана).
 * RESTRICT/NO ACTION FK бүрд done(хүүхэд) < start(эцэг) байх ёстой — эс бөгөөс
 * cascade дундаас гацна. NO ACTION өөрийгөө заасан FK (ангиллын мод) нэг
 * statement-ийн төгсгөлд шалгагддаг тул зөрчил биш.
 */
export function findPurgeViolations(
  order: readonly string[],
  fks: readonly ForeignKeyInfo[]
): PurgeViolation[] {
  const n = order.length;
  const tables = new Set<string>([ROOT, ...order]);
  for (const fk of fks) {
    tables.add(fk.child);
    tables.add(fk.parent);
  }
  const start = new Map<string, number>();
  const done = new Map<string, number>();
  for (const t of tables) {
    start.set(t, Infinity);
    done.set(t, Infinity);
  }
  start.set(ROOT, n);
  done.set(ROOT, n);
  order.forEach((t, i) => {
    start.set(t, Math.min(start.get(t)!, i));
    done.set(t, Math.min(done.get(t)!, i));
  });

  const cascades = fks.filter((fk) => fk.onDelete === "c" && fk.child !== fk.parent);
  // Fixed point — утга зөвхөн буурна, хүснэгтийн тоогоор хязгаарлагдана.
  for (let changed = true; changed; ) {
    changed = false;
    for (const fk of cascades) {
      const s = Math.min(start.get(fk.child)!, start.get(fk.parent)!);
      if (s < start.get(fk.child)!) {
        start.set(fk.child, s);
        changed = true;
      }
      if (fk.notNull) {
        const d = Math.min(done.get(fk.child)!, done.get(fk.parent)!);
        if (d < done.get(fk.child)!) {
          done.set(fk.child, d);
          changed = true;
        }
      }
    }
  }

  const violations: PurgeViolation[] = [];
  for (const fk of fks) {
    if (fk.onDelete !== "r" && fk.onDelete !== "a") continue;
    if (fk.child === fk.parent && fk.onDelete === "a") continue;
    const parentStart = start.get(fk.parent)!;
    if (parentStart === Infinity) continue; // эцэг устгагдахгүй (users г.м.)
    const childDone = done.get(fk.child)!;
    if (childDone < parentStart) continue;
    violations.push({
      child: fk.child,
      parent: fk.parent,
      reason:
        childDone === Infinity
          ? `"${fk.child}" мөрүүд устгагдахгүй хэвээр "${fk.parent}" устгагдана — ORG_PURGE_ORDER-т нэмнэ`
          : `"${fk.child}" (алхам ${childDone}) нь "${fk.parent}" (алхам ${parentStart})-ээс ӨМНӨ устах ёстой`,
    });
  }
  return violations;
}
