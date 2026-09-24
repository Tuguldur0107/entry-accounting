// Кредит нэхэмжлэл / дебит нэхэмжлэх (ENT-029) — ЦЭВЭР төлөвлөгч
// (tests/arap-credit-note.test.ts). DB-гүй: эх нэхэмжлэхийн мөрүүд ба өмнө
// буцаагдсан дүнг дуудагч өгнө.
//
// Батлагдсан шийдвэр (docs/product/2026-09-audit-followup-proposal.md §3):
//   D-CN-1  АР-ын ОРЛОГЫН (5-бүлэг) мөрийн буцаалт → 51900001 «Борлуулалтын
//           хөнгөлөлт (contra)» — сегментүүд нь эх мөрийнхөөр; бусад мөр эх
//           данс руугаа буцна. АП-ийн мөр эх дансаараа (клиринг/зардал).
//   D-CN-2  Эх нэхэмжлэх ЗААВАЛ — мөр бүр эх мөртэйгээ, буцаах тоо/дүн эх
//           мөрийн ҮЛДЭГДЛЭЭС хэтрэхгүй.
//   D-CN-3  Батлахад эх нэхэмжлэхийн нээлттэй үлдэгдэлд автоматаар тооцогдоно;
//           илүүдэл нь харилцагчийн кредит болж үлдэнэ (кассаар буцаан олгох
//           эсвэл дараагийн нэхэмжлэхтэй суутгана).
//   D-CN-4  eBarimt-ийн засвар (inactiveId) — дараагийн фаз.
//
// НӨАТ-ын мөрийг хэрэглэгч сонгохгүй — буцаасан цэвэр дүнгийн эх нэхэмжлэхэд
// эзлэх хувиар автоматаар бодогдоно; бүх мөр бүрэн буцвал НӨАТ-ын үлдэгдэл
// бүхэлдээ (бөөрөнхийллийн зөрүү үлдэхгүй).

/** D-CN-1: борлуулалтын буцаалт/хөнгөлөлтийн contra данс. */
export const SALES_RETURN_CONTRA_ACCOUNT = "51900001";

export type CreditSourceLine = {
  id: string;
  accountNumber: string;
  description: string;
  amount: number;
  quantity: number | null;
  itemId: string | null;
  warehouseId: string | null;
  unitPrice: number | null;
};

/** Эх мөр бүрд өмнөх (буцаагдаагүй) кредит баримтуудаар буцаагдсан дүн. */
export type CreditedSoFar = Map<string, { amount: number; quantity: number }>;

export type CreditRequestLine = {
  sourceLineId: string;
  /**
   * Буцаах тоо (бараатай мөр). Өгөөгүй бол үлдэгдэл бүтнээрээ. `0` + `amount`
   * = бараа буцаахгүй ҮНИЙН хөнгөлөлт (хөдөлгөөн үүсэхгүй).
   */
  quantity?: number;
  /** Буцаах дүн (баримтын валютаар). Бараагүй мөрөнд; өгөөгүй бол үлдэгдэл. */
  amount?: number;
};

export type PlannedCreditLine = {
  sourceLineId: string;
  accountNumber: string;
  description: string;
  amount: number;
  itemId: string | null;
  quantity: number | null;
  warehouseId: string | null;
  unitPrice: number | null;
  isVat: boolean;
};

const EPS_MONEY = 0.005;
const EPS_QTY = 1e-9;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

/** 10 хэсэгтэй кодын үндсэн дансыг (S3) солино; бусад сегмент хэвээр. */
export function replaceMainAccount(code: string, main: string): string {
  const parts = code.split(".");
  if (parts.length === 10) {
    parts[2] = main;
    return parts.join(".");
  }
  return main;
}

/** Эх мөрийн үндсэн данс (S3). */
export function mainAccountOfCode(code: string): string {
  const parts = code.split(".");
  if (parts.length === 10) return parts[2] ?? code;
  return code;
}

/**
 * Кредит мөрийн данс: АР-ын орлогын (5-бүлэг) мөр → contra (D-CN-1),
 * бусад нь эх данс руугаа.
 */
export function creditLineAccount(
  sourceType: string,
  sourceAccount: string,
  contraMain: string = SALES_RETURN_CONTRA_ACCOUNT
): string {
  if (sourceType === "ar_invoice" && mainAccountOfCode(sourceAccount).startsWith("5"))
    return replaceMainAccount(sourceAccount, contraMain);
  return sourceAccount;
}

export function planCreditNote(input: {
  sourceType: string;
  sourceStatus: string;
  sourceLines: CreditSourceLine[];
  credited: CreditedSoFar;
  /** Хоосон/өгөөгүй бол бүх мөрийн үлдэгдэл (бүтэн буцаалт). */
  request?: CreditRequestLine[];
  /** НӨАТ-ын мөр мөн эсэх (АР — гаралтын, АП — оролтын НӨАТ данс). */
  isVatLine: (accountNumber: string) => boolean;
  contraMain?: string;
}): { lines: PlannedCreditLine[]; total: number } {
  const { sourceType, sourceLines, credited } = input;
  if (sourceType !== "ar_invoice" && sourceType !== "ap_bill")
    throw new Error(
      "[CREDIT_SOURCE_TYPE] Кредит/дебит баримт зөвхөн авлагын нэхэмжлэл эсвэл өглөгийн нэхэмжлэхээс үүснэ"
    );
  if (!["posted", "partially_paid", "paid"].includes(input.sourceStatus))
    throw new Error(
      "[CREDIT_SOURCE_STATUS] Эх нэхэмжлэх батлагдсан байх ёстой (ноорог/буцаагдсанаас кредит үүсэхгүй)"
    );

  const remainingOf = (line: CreditSourceLine) => {
    const done = credited.get(line.id) ?? { amount: 0, quantity: 0 };
    return {
      amount: round2(line.amount - done.amount),
      quantity: line.quantity != null ? round4(line.quantity - done.quantity) : null,
    };
  };

  const vatLines = sourceLines.filter(
    (line) => line.amount > 0 && input.isVatLine(line.accountNumber)
  );
  const netLines = sourceLines.filter(
    (line) => line.amount > 0 && !input.isVatLine(line.accountNumber)
  );
  const byId = new Map(sourceLines.map((line) => [line.id, line]));

  const requests: CreditRequestLine[] =
    input.request && input.request.length > 0
      ? input.request
      : netLines
          .filter((line) => remainingOf(line).amount > EPS_MONEY)
          .map((line) => ({ sourceLineId: line.id }));

  const seen = new Set<string>();
  const planned: PlannedCreditLine[] = [];
  for (const req of requests) {
    const source = byId.get(req.sourceLineId);
    if (!source)
      throw new Error("[CREDIT_LINE_NOT_FOUND] Эх нэхэмжлэхэд ийм мөр алга");
    if (seen.has(source.id))
      throw new Error(
        `[CREDIT_LINE_DUPLICATE] «${source.description}» мөр давхар сонгогдсон`
      );
    seen.add(source.id);
    if (input.isVatLine(source.accountNumber))
      throw new Error(
        "[CREDIT_VAT_AUTO] НӨАТ-ын мөрийг сонгохгүй — буцаасан дүнгийн хувиар автоматаар бодогдоно"
      );
    if (!(source.amount > 0))
      throw new Error(
        `[CREDIT_LINE_NOT_CREDITABLE] «${source.description}» мөр буцаагдахгүй (дүн эерэг биш)`
      );
    const rem = remainingOf(source);
    if (rem.amount <= EPS_MONEY)
      throw new Error(
        `[CREDIT_LINE_EXHAUSTED] «${source.description}» мөр бүрэн буцаагдсан байна`
      );

    let amount: number;
    let quantity: number | null = null;
    let itemId: string | null = null;
    let warehouseId: string | null = null;
    if (source.itemId && source.quantity != null && source.quantity > 0) {
      const wantQty = req.quantity ?? rem.quantity ?? 0;
      if (!Number.isFinite(wantQty) || wantQty < 0)
        throw new Error("[CREDIT_QTY] Буцаах тоо сөрөг байж болохгүй");
      if (wantQty === 0) {
        // Үнийн хөнгөлөлт — бараа буцахгүй.
        if (req.amount == null || !(req.amount > 0))
          throw new Error(
            `[CREDIT_AMOUNT] «${source.description}»: тоо 0 бол хөнгөлөх дүнг өгнө үү`
          );
        amount = round2(req.amount);
      } else {
        if (wantQty > (rem.quantity ?? 0) + EPS_QTY)
          throw new Error(
            `[CREDIT_QTY_EXCEEDS] «${source.description}»: буцаах тоо ${wantQty} нь үлдэгдлээс (${rem.quantity}) их`
          );
        quantity = round4(wantQty);
        itemId = source.itemId;
        warehouseId = source.warehouseId;
        amount =
          req.amount != null
            ? round2(req.amount)
            : Math.abs(quantity - (rem.quantity ?? 0)) <= EPS_QTY
              ? rem.amount
              : round2((source.amount / source.quantity) * quantity);
      }
    } else {
      if (req.quantity != null && req.quantity !== 0)
        throw new Error(
          `[CREDIT_QTY] «${source.description}» бараагүй мөр — тоо биш дүн өгнө`
        );
      amount = req.amount != null ? round2(req.amount) : rem.amount;
    }
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error(
        `[CREDIT_AMOUNT] «${source.description}»: буцаах дүн 0-ээс их байна`
      );
    // Тооцоолсон дүн (тоо × эх үнэ) өмнөх үнийн хөнгөлөлтийн дараа үлдэгдлээс
    // давж болно — тэр үед үлдэгдлээр хязгаарлана; ИЛ өгсөн дүн бол татгалзана.
    if (req.amount == null) amount = Math.min(amount, rem.amount);
    if (amount > rem.amount + EPS_MONEY)
      throw new Error(
        `[CREDIT_AMOUNT_EXCEEDS] «${source.description}»: буцаах дүн ${amount} нь үлдэгдлээс (${rem.amount}) их`
      );
    amount = Math.min(amount, rem.amount);

    planned.push({
      sourceLineId: source.id,
      accountNumber: creditLineAccount(sourceType, source.accountNumber, input.contraMain),
      description: source.description,
      amount,
      itemId,
      quantity,
      warehouseId,
      unitPrice: source.unitPrice,
      isVat: false,
    });
  }

  // НӨАТ — эх нэхэмжлэхийн цэвэр дүнд эзлэх хувиар.
  const sourceNet = netLines.reduce((sum, line) => sum + line.amount, 0);
  const plannedNet = planned.reduce((sum, line) => sum + line.amount, 0);
  const plannedBySource = new Map(planned.map((line) => [line.sourceLineId, line.amount]));
  const allNetExhausted = netLines.every(
    (line) => remainingOf(line).amount - (plannedBySource.get(line.id) ?? 0) <= EPS_MONEY
  );
  for (const vat of vatLines) {
    const remVat = remainingOf(vat).amount;
    if (remVat <= EPS_MONEY || sourceNet <= 0) continue;
    const proportional = allNetExhausted
      ? remVat
      : round2(vat.amount * (plannedNet / sourceNet));
    const amount = Math.min(proportional, remVat);
    if (amount <= EPS_MONEY) continue;
    planned.push({
      sourceLineId: vat.id,
      accountNumber: vat.accountNumber,
      description: vat.description,
      amount,
      itemId: null,
      quantity: null,
      warehouseId: null,
      unitPrice: null,
      isVat: true,
    });
  }

  if (planned.length === 0)
    throw new Error("[CREDIT_NOTHING_LEFT] Эх нэхэмжлэхэд буцаах үлдэгдэл алга");
  const total = round2(planned.reduce((sum, line) => sum + line.amount, 0));
  return { lines: planned, total };
}

/**
 * Батлахад эх нэхэмжлэхэд тооцох дүн (D-CN-3) — эх нэхэмжлэхийн нээлттэй
 * үлдэгдлээс хэтрэхгүй; илүүдэл нь кредит баримтын нээлттэй үлдэгдэл болно.
 */
export function creditApplicationAmount(
  creditTotal: number,
  source: { totalAmount: number; paidAmount: number; status: string }
): number {
  if (!["posted", "partially_paid"].includes(source.status)) return 0;
  const open = round2(source.totalAmount - source.paidAmount);
  if (open <= EPS_MONEY) return 0;
  return round2(Math.min(creditTotal, open));
}

/**
 * Өмнөх кредит баримтуудын мөрүүдээс эх мөр бүрийн буцаагдсан дүн/тоо.
 * Буцаагдсан (reversed) кредит баримт тооцогдохгүй — дуудагч шүүнэ.
 */
export function sumCreditedByLine(
  lines: { sourceLineId: string | null; amount: number; quantity: number | null }[]
): CreditedSoFar {
  const map: CreditedSoFar = new Map();
  for (const line of lines) {
    if (!line.sourceLineId) continue;
    const prev = map.get(line.sourceLineId) ?? { amount: 0, quantity: 0 };
    map.set(line.sourceLineId, {
      amount: round2(prev.amount + line.amount),
      quantity: round4(prev.quantity + (line.quantity ?? 0)),
    });
  }
  return map;
}

/**
 * Батлах мөчийн давхар шалгалт: кредит баримтын мөрүүд (бусад БАТЛАГДСАН
 * кредитийн дараа) эх мөрийн үлдэгдлээс хэтрэхгүй. Ноорог хэвтэх зуур өөр
 * кредит батлагдсан байж болно. Зөрчлийн мессежийг буцаана (null = зөв).
 */
export function creditOverrunError(
  sourceLines: CreditSourceLine[],
  creditedByOthers: CreditedSoFar,
  creditLines: { sourceLineId: string | null; amount: number; quantity: number | null }[]
): string | null {
  const byId = new Map(sourceLines.map((line) => [line.id, line]));
  const mine = sumCreditedByLine(creditLines);
  for (const line of creditLines)
    if (!line.sourceLineId || !byId.has(line.sourceLineId))
      return "[CREDIT_LINE_NOT_FOUND] Кредит мөр эх нэхэмжлэхийн мөртэй холбогдоогүй байна";
  for (const [lineId, own] of mine) {
    const source = byId.get(lineId)!;
    const others = creditedByOthers.get(lineId) ?? { amount: 0, quantity: 0 };
    if (own.amount + others.amount > source.amount + EPS_MONEY)
      return `[CREDIT_AMOUNT_EXCEEDS] «${source.description}»: буцаах дүн эх мөрийн үлдэгдлээс (${round2(source.amount - others.amount)}) их — өөр кредит баримт батлагдсан байж болно`;
    if (
      source.quantity != null &&
      own.quantity + others.quantity > source.quantity + EPS_QTY
    )
      return `[CREDIT_QTY_EXCEEDS] «${source.description}»: буцаах тоо эх мөрийн үлдэгдлээс (${round4(source.quantity - others.quantity)}) их`;
  }
  return null;
}
