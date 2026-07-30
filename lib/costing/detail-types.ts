// Гүйлгээний дэлгэрэнгүй тайлангийн CLIENT-д аюулгүй төрөл, шошгууд.
// (Ачаалагч нь lib/costing/transaction-detail.ts — тэр нь DB-тэй тул
// client component-оос импортлож БОЛОХГҮЙ.)

/** §11-ийн төлөвүүд, платформын нэр томьёогоор. */
export type GlBoundStatus =
  | "not-valued" // үнэлэгдээгүй — өртгийн бичилт үүсээгүй
  | "pending" // GL-д бичигдээгүй ноорог
  | "posted"
  | "reversed";

export const GL_BOUND_LABELS: Record<GlBoundStatus, string> = {
  "not-valued": "Үнэлэгдээгүй",
  pending: "GL-д бичигдээгүй",
  posted: "Бичигдсэн",
  reversed: "Буцаагдсан",
};

export interface TransactionDetailRow {
  id: string;
  // Хугацаа
  date: string;
  postingDate: string | null;
  // Эх баримт
  sourceType: string;
  sourceDocumentNo: string;
  sourceId: string | null;
  // Гүйлгээ
  movementId: string;
  movementType: string;
  direction: "in" | "out" | "neutral";
  // Бараа / байршил
  itemCode: string;
  itemName: string;
  warehouseLabel: string;
  unit: string;
  // Тоо хэмжээ
  qtyIn: number | null;
  qtyOut: number | null;
  // Өртөг
  unitCost: number | null;
  amount: number | null;
  costMethod: string;
  // Ангилал
  costComponent: string | null;
  issueType: string | null;
  // Данс (GL-д холбогдсон үед)
  debitAccountCode: string | null;
  debitAccountName: string | null;
  creditAccountCode: string | null;
  creditAccountName: string | null;
  // GL
  glStatus: GlBoundStatus;
  journalNo: string | null;
  voucherId: string | null;
  costEntryId: string | null;
  // Гүйлгээ тутмын үлдэгдэл (§3.4, corrected baseline — ЗААВАЛ).
  // null = тодорхойгүй: период тооцоологдоогүй / үнэлэгдээгүй мөр таарсан /
  // хөдөлгөөн батлагдаагүй. Таамаг өртөг зохиохгүй.
  runningQty: number | null;
  runningAmount: number | null;
  // Аудит
  createdAt: string;
}


export interface ReconciliationRow {
  accountNumber: string;
  accountName: string;
  subledgerAmount: number;
  glAmount: number;
  difference: number;
  /** GL мөрүүдийн хэд нь дэд дэвтрийн лавлагаагүй вэ (гараар бичсэн). */
  unlinkedGlLines: number;
  unlinkedGlAmount: number;
}
