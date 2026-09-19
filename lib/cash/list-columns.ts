// Мөнгөн гүйлгээний жагсаалтын ЦЭВЭР туслахууд (тесттэй) — Дт/Кт задаргаа
// ба харилцагчийн бүртгэлтэй автомат холбох дүрэм. DB, React хамаарахгүй.
//
// Жагсаалт нь Veritech-ийн "Харилцахын баримт"-тай ижил хэлбэрээр
// Дебит дүн / Кредит дүн (MNT) ба Дебит/Кредит (валют) баганаар харуулна:
//   орлого (receipt)   → мөнгөн данс ДЕБЕТЛЭГДЭНЭ  → дебит багана
//   зарлага (payment)  → мөнгөн данс КРЕДИТЛЭГДЭНЭ → кредит багана
//   шилжүүлэг          → хүлээн авах данс Дт, гаргах данс Кт → хоёулаа

export interface CashDebitCreditInput {
  documentType: string;
  /** Валютын дүн (MNT баримтад MNT). */
  amount: number;
  /** MNT суурь дүн. */
  baseAmount: number;
  currency: string;
  /** 0 = ханш тодорхойгүй (GL-ээс үүссэн валютын ноорог). */
  exchangeRate: number;
}

export interface CashDebitCredit {
  debitBase: number;
  creditBase: number;
  /** Валютын дүн — MNT баримт эсвэл ханш тодорхойгүй бол null. */
  debitFx: number | null;
  creditFx: number | null;
}

export function cashDebitCredit(doc: CashDebitCreditInput): CashDebitCredit {
  const isDebit = doc.documentType === "receipt" || doc.documentType === "transfer";
  const isCredit = doc.documentType === "payment" || doc.documentType === "transfer";
  const fxKnown =
    doc.currency !== "MNT" && doc.exchangeRate > 0 && doc.amount > 0;
  return {
    debitBase: isDebit ? doc.baseAmount : 0,
    creditBase: isCredit ? doc.baseAmount : 0,
    debitFx: isDebit && fxKnown ? doc.amount : null,
    creditFx: isCredit && fxKnown ? doc.amount : null,
  };
}

/** Мөнгөн хөрөнгийн дансны GL код (Дансны код багана) — шилжүүлэгт "эх → хүлээн авах". */
export function cashAccountGlLabel(doc: {
  documentType: string;
  fromGlNumber: string | null;
  toGlNumber: string | null;
}): string {
  if (doc.documentType === "transfer")
    return `${doc.fromGlNumber ?? ""} → ${doc.toGlNumber ?? ""}`;
  if (doc.documentType === "receipt") return doc.toGlNumber ?? "";
  return doc.fromGlNumber ?? "";
}

/** Харилцагчийн нэрийг нормчилно — хоосон зай, том/жижиг үсэг ялгахгүй. */
export function normalizeCounterpartyName(name: string | null | undefined) {
  return (name ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Чөлөөт нэрээр бүртгэлтэй харилцагчийг олно — ЯГ таарсан (нормчилсон)
 * нэр л холбогдоно; олон таарвал (том/жижиг үсгээр л ялгаатай хоёр
 * бүртгэл) null — таамаглаж холбохгүй. Идэвхгүй харилцагч ч холбогдоно
 * (түүхэн баримт нэрээрээ таарч болно).
 */
export function matchCounterpartyByName<T extends { id: string; name: string }>(
  name: string | null | undefined,
  counterparties: readonly T[]
): T | null {
  const key = normalizeCounterpartyName(name);
  if (!key) return null;
  const hits = counterparties.filter(
    (item) => normalizeCounterpartyName(item.name) === key
  );
  return hits.length === 1 ? hits[0] : null;
}
