// КЛИРИНГИЙН ОБЪЕКТ ТОДОРХОЙЛОЛТ — ЦЭВЭР логик (DB-гүй, тесттэй).
//
// GL-ийн клирингийн мөрийг ямар бизнес объектод хамааруулахыг шийднэ.
// Ачаалагч (clearing-reconciliation.ts) нь хайлтын хүснэгтүүдийг бүтээж
// энд дамжуулна — ингэснээр дүрмийг DB-гүйгээр тестлэнэ.
//
// Дараалал (docs/cost §6):
//   0. journal_lines.business_object_type/id — бичих мөчид тавигдсан түлхүүр
//   1. cost_entry → хуваарилалт / хөдөлгөөн / (хөдөлгөөнгүй бол) бичилт өөрөө
//   2. воучер нь АР/АП баримтынх
//   3. воучер нь мөнгөн гүйлгээнийх
//   4. өөр юу ч биш → "Тодорхойгүй (гар журнал)"
// БУЦААЛТ: нотолгоогүй мөр нь ЭХ журналынхаа (reversalOfVoucherId) ижил
// данс дээрх мөрийн объектыг өвлөнө — эс бөгөөс тэгширсэн хос "нээлттэй"
// мэт харагдана.

import { PO_BUSINESS_OBJECT } from "@/lib/procurement/constants";

/** Бизнес объектын төрлийн монгол шошго (journal_lines-ийн түлхүүрээс). */
export const BUSINESS_OBJECT_LABELS: Record<string, string> = {
  [PO_BUSINESS_OBJECT]: "Захиалга (PO)",
};

export type ClearingRawLine = {
  voucherId: string;
  voucherDate: string;
  voucherDescription: string;
  account: string;
  /** дебет − кредит */
  delta: number;
  costEntryId: string | null;
  businessObjectType: string | null;
  businessObjectId: string | null;
};

export interface ClearingResolution {
  objectType: string;
  objectId: string;
  objectLabel: string;
  componentLabel: string | null;
  known: boolean;
}

/** Ачаалагчийн бүтээсэн хайлтын хүснэгтүүд (бүгд plain Map). */
export interface ClearingLookups {
  entryById: Map<
    string,
    {
      id: string;
      movementId: string | null;
      itemId: string | null;
      costComponentId: string | null;
    }
  >;
  allocationByEntry: Map<
    string,
    { documentNo: string; costComponentId: string | null } | undefined
  >;
  movementById: Map<
    string,
    { documentNo: string; sourceType: string | null; sourceId: string | null }
  >;
  apByArapLine: Map<
    string,
    {
      documentNo: string;
      documentType: string;
      purchaseOrderId: string | null;
    }
  >;
  apByVoucher: Map<
    string,
    {
      documentNo: string;
      documentType: string;
      purchaseOrderId: string | null;
    }
  >;
  cashByVoucher: Map<string, { documentNo: string }>;
  componentById: Map<string, { code: string; name: string }>;
  orderById: Map<string, { documentNo: string }>;
  itemById: Map<string, { code: string; name: string }>;
}

/** Мөрийг объектод оноох — буцаалтын өвлөлтгүй, НЭГ мөрийн дүрэм. */
export function resolveClearingObject(
  line: ClearingRawLine,
  lookups: ClearingLookups
): ClearingResolution {

    let objectType = "Тодорхойгүй (гар журнал)";
    let objectId = line.voucherId;
    let objectLabel = line.voucherDescription || line.voucherId.slice(0, 8);
    let componentLabel: string | null = null;
    let known = false;

    const entry = line.costEntryId ? lookups.entryById.get(line.costEntryId) : null;

    // 0. БИЧИХ МӨЧИД тавигдсан бизнес объектын түлхүүр — ТЭРГҮҮН (FR-PROC-004).
    // Хангамжийн Dr (өглөгийн түр данс, АР/АП журналаас) ба Cr (бараа мат.
    // түр данс, өртгийн журналаас) ингэж НЭГ объектод буудаг.
    if (line.businessObjectType && line.businessObjectId) {
      const order =
        line.businessObjectType === PO_BUSINESS_OBJECT
          ? lookups.orderById.get(line.businessObjectId)
          : undefined;
      objectType =
        BUSINESS_OBJECT_LABELS[line.businessObjectType] ??
        line.businessObjectType;
      objectId = order?.documentNo ?? line.businessObjectId;
      objectLabel = order?.documentNo ?? line.businessObjectId.slice(0, 8);
      const component = entry?.costComponentId
        ? lookups.componentById.get(entry.costComponentId)
        : null;
      componentLabel = component
        ? `${component.code} · ${component.name}`
        : null;
      known = true;
    } else if (entry) {
      const allocation = lookups.allocationByEntry.get(entry.id);
      if (allocation) {
        objectType = "Зардлын хуваарилалт";
        objectId = allocation.documentNo;
        objectLabel = allocation.documentNo;
        const component = allocation.costComponentId
          ? lookups.componentById.get(allocation.costComponentId)
          : entry.costComponentId
            ? lookups.componentById.get(entry.costComponentId)
            : null;
        componentLabel = component
          ? `${component.code} · ${component.name}`
          : null;
        known = true;
      } else if (entry.movementId) {
        const movement = lookups.movementById.get(entry.movementId);
        // PO-гүй жижиг худалдан авалт: хөдөлгөөн нь АП-ийн МӨРӨӨС үүссэн бол
        // тэр баримтын объектод буулгана — АП-ийн Dr клиринг ба энэ Cr
        // клиринг ижил бакетад орж тэгширнэ (эс бөгөөс хоёулаа мөнхөд
        // "нээлттэй" харагдана).
        const apFromLine =
          movement?.sourceType === "arap_line" && movement.sourceId
            ? lookups.apByArapLine.get(movement.sourceId)
            : undefined;
        if (apFromLine) {
          const order = apFromLine.purchaseOrderId
            ? lookups.orderById.get(apFromLine.purchaseOrderId)
            : undefined;
          if (apFromLine.purchaseOrderId) {
            objectType = BUSINESS_OBJECT_LABELS[PO_BUSINESS_OBJECT];
            objectId = order?.documentNo ?? apFromLine.purchaseOrderId;
            objectLabel = order?.documentNo ?? apFromLine.documentNo;
          } else {
            objectType =
              apFromLine.documentType === "ap_bill"
                ? "Өглөгийн нэхэмжлэх"
                : "Авлагын нэхэмжлэл";
            objectId = apFromLine.documentNo;
            objectLabel = apFromLine.documentNo;
          }
        } else {
          objectType = "Барааны хөдөлгөөн";
          objectId = movement?.documentNo ?? entry.movementId;
          objectLabel = movement?.documentNo ?? entry.movementId.slice(0, 8);
        }
        const component = entry.costComponentId
          ? lookups.componentById.get(entry.costComponentId)
          : null;
        componentLabel = component
          ? `${component.code} · ${component.name}`
          : null;
        known = true;
      } else if (entry.itemId) {
        // Хөдөлгөөн устсан (буцаагдсан бичилтийн movementId=null) — бичилт
        // өөрөө объект болно, барааны нэрээр нэрлэнэ. "Тодорхойгүй (гар
        // журнал)" руу унагавал жинхэнэ гар бичилттэй хольж хутгана.
        const item = lookups.itemById.get(entry.itemId);
        objectType = "Өртгийн бичилт";
        objectId = entry.id;
        objectLabel = item ? `${item.code} · ${item.name}` : entry.id.slice(0, 8);
        const component = entry.costComponentId
          ? lookups.componentById.get(entry.costComponentId)
          : null;
        componentLabel = component
          ? `${component.code} · ${component.name}`
          : null;
        known = true;
      }
    } else {
      const apDoc = lookups.apByVoucher.get(line.voucherId);
      const cashDoc = lookups.cashByVoucher.get(line.voucherId);
      if (apDoc) {
        // PO-той нэхэмжлэх — түлхүүргүй (хуучин) мөр ч ЗАХИАЛГЫН объектод
        // буух ёстой, эс бөгөөс PO хэзээ ч тэгширэхгүй.
        const order = apDoc.purchaseOrderId
          ? lookups.orderById.get(apDoc.purchaseOrderId)
          : undefined;
        if (apDoc.purchaseOrderId) {
          objectType = BUSINESS_OBJECT_LABELS[PO_BUSINESS_OBJECT];
          objectId = order?.documentNo ?? apDoc.purchaseOrderId;
          objectLabel = order?.documentNo ?? apDoc.documentNo;
        } else {
          objectType =
            apDoc.documentType === "ap_bill"
              ? "Өглөгийн нэхэмжлэх"
              : "Авлагын нэхэмжлэл";
          objectId = apDoc.documentNo;
          objectLabel = apDoc.documentNo;
        }
        known = true;
      } else if (cashDoc) {
        objectType = "Мөнгөн гүйлгээ";
        objectId = cashDoc.documentNo;
        objectLabel = cashDoc.documentNo;
        known = true;
      }
    }

    return { objectType, objectId, objectLabel, componentLabel, known };
  }

/**
 * Буцаалтын өвлөлттэй хувилбар — мөр өөрөө нотолгоогүй бол ЭХ журналынхаа
 * ижил данс дээрх мөрийн объектыг авна.
 *
 * Гинжийг ҮНДЭС хүртэл алхана: буцаалтын буцаалт (V1 → V2 → V3 …) нь завсрын
 * воучерын id-гаар биш, гинжний эхний воучерын объектоор бакетлагдана — эс
 * бөгөөс дөрвөн мөр хоёр тусдаа "объектгүй" хос болж, нийт дүн 0 байхад
 * худал улаан сэрэмжлүүлэг өгнө (unpostVoucher батлагдсан буцаалтыг дахин
 * буцаахыг хоридоггүй тул энэ гинж бодитоор үүсэх боломжтой).
 * Мэдэгдэх объект гинжний аль ч шатанд олдвол шууд түүнийг авна.
 */
export function resolveClearingObjectWithReversal(
  line: ClearingRawLine,
  lookups: ClearingLookups,
  context: {
    /** буцаалтын воучер → эх воучер */
    reversalOf: Map<string, string>;
    /** `${voucherId}::${account}` → тэр воучерын мөрүүд */
    linesByVoucherAccount: Map<string, ClearingRawLine[]>;
  }
): ClearingResolution {
  let resolution = resolveClearingObject(line, lookups);
  if (resolution.known) return resolution;

  // Гэмтсэн/мөчлөгтэй өгөгдөлд ч гацахгүй — үзсэн воучерыг тэмдэглэнэ.
  const visited = new Set<string>([line.voucherId]);
  let currentId: string = line.voucherId;
  for (;;) {
    const originalId = context.reversalOf.get(currentId);
    if (!originalId || visited.has(originalId)) return resolution;
    visited.add(originalId);
    const originals =
      context.linesByVoucherAccount.get(`${originalId}::${line.account}`) ?? [];
    for (const original of originals) {
      const inherited = resolveClearingObject(original, lookups);
      // Мэдэгдэх объект олдвол шууд; үгүй бол гинжний ЭНЭ шатны утгыг
      // түр авч, дээшээ үргэлжилнэ (үндэс нь эцсийн түлхүүр болно).
      if (inherited.known) return inherited;
      resolution = inherited;
    }
    currentId = originalId;
  }
}
