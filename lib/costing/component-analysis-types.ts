// Өртгийн бүрэлдэхүүний задаргаа — CLIENT-д аюулгүй төрлүүд.
// (Ачаалагч нь lib/costing/component-analysis.ts — DB-тэй тул client
// component-оос импортлож болохгүй.)

export interface ComponentAnalysisRow {
  id: string;
  periodCode: string;
  itemCode: string;
  itemName: string;
  warehouseLabel: string;
  componentCode: string;
  componentName: string;
  sourceDocumentType: string;
  sourceDocumentNo: string;
  /** Хуваарилалтын баримтын дугаар — задаргааны гинжийн лавлагаа. */
  allocationDocumentNo: string | null;
  amount: number;
  /** Бүрэлдэхүүний дүн ÷ орлогын тоо хэмжээ (утга байвал). */
  unitCostImpact: number | null;
  debitAccountCode: string | null;
  debitAccountName: string | null;
  creditAccountCode: string | null;
  creditAccountName: string | null;
  glStatus: "pending" | "posted";
  journalNo: string | null;
  voucherId: string | null;
}
