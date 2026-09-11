// Хангамжийн модулийн ТОГТМОЛУУД — цэвэр (plain) модуль, "use server" БИШ.
//
// Бизнес объектын түлхүүр, хөдөлгөөний эх сурвалжийн төрөл, модулийн эрхийн
// түлхүүр гурвуулаа ЭНД нэг эх сурвалжтай байна — литералыг кодод дахин
// бичихийг хориглоно (docs/procurement 01-implementation-contract.md §1).

/** journal_lines / cost_entries / cost_allocations-ийн клирингийн түлхүүр. */
export const PO_BUSINESS_OBJECT = "purchase_order" as const;

/** inventory_movements.sourceType — хүлээн авалтын мөрөөс үүссэн орлого. */
export const PO_SOURCE_TYPE = "po_receipt" as const;

/** lib/constants/app-modules.ts-ийн module_configs түлхүүр (эрх шалгалт). */
export const PROCUREMENT_MODULE_KEY = "proc" as const;
