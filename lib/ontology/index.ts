// Ontology registry — ЦЭВЭР, client-safe (docs/ontology-audit.md §6, docs/dev/ontology.md).
// P2 (ажиглах): 10 гол объект. Шинэ объект нэмэхдээ ONTOLOGY_OBJECTS-д бүртгэж,
// tests/ontology-registry.test.ts-ийн drift шалгалтыг давуулна.

import { arapDocument } from "./objects/arap-document";
import { cashDocument } from "./objects/cash-document";
import { costEntry } from "./objects/cost-entry";
import { faDepreciationEntry } from "./objects/fa-depreciation-entry";
import { fixedAsset } from "./objects/fixed-asset";
import { goodsReceipt } from "./objects/goods-receipt";
import { inventoryMovement } from "./objects/inventory-movement";
import { journalVoucher } from "./objects/journal-voucher";
import { purchaseOrder } from "./objects/purchase-order";
import { qpayIntent } from "./objects/qpay-intent";
import type { ObjectDef, TransitionDef } from "./types";

export type * from "./types";
export { objectProblems } from "./define";

export const ONTOLOGY_OBJECTS: readonly ObjectDef[] = Object.freeze([
  journalVoucher,
  arapDocument,
  cashDocument,
  purchaseOrder,
  qpayIntent,
  inventoryMovement,
  goodsReceipt,
  costEntry,
  fixedAsset,
  faDepreciationEntry,
] as ObjectDef[]);

export function ontologyObject(key: string): ObjectDef | null {
  return ONTOLOGY_OBJECTS.find((object) => object.key === key) ?? null;
}

/** Энэ төлөвөөс хийж болох шилжилтүүд (үүсгэлтгүй). */
export function transitionsFrom(object: ObjectDef, state: string): readonly TransitionDef[] {
  return object.transitions.filter((transition) => transition.from.includes(state));
}

/** Ontology-д дурдагдсан MCP tool бүр (canonical + alias). */
export function ontologyToolNames(): string[] {
  const names = new Set<string>();
  for (const object of ONTOLOGY_OBJECTS)
    for (const transition of object.transitions) {
      if (!transition.tool) continue;
      names.add(transition.tool.name);
      for (const alias of transition.tool.aliases ?? []) names.add(alias);
    }
  return [...names].sort();
}
