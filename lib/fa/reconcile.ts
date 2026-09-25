// ҮХ-ийн бүртгэл ↔ GL тулгалт (SIM2-037) — ЦЭВЭР (tests/sim2-fa-reconcile.test.ts).
//
// Хүлээгдэх GL = данс бүрээр: Σ картын өртөг (Дт) ба −Σ хуримтлагдсан элэгдэл
// (нээлтийн + батлагдсан бичилт, Кт). Карт тоологдох нөхцөл: asOf-оос өмнө
// авсан бөгөөд идэвхтэй, ЭСВЭЛ asOf-оос хойш данснаас хасагдсан, ЭСВЭЛ ноорог
// ч өртөг нь GL-д батлагдсан эх журналаар орсон (АП sync / капиталжуулалт).

export type FaReconcileCard = {
  id: string;
  status: string;
  acquisitionDate: string;
  disposalDate: string | null;
  assetAccountNumber: string;
  accumDepAccountNumber: string;
  cost: number;
  openingAccumulated: number;
  /** Картын эх журнал (sourceVoucherId) батлагдсан эсэх. */
  sourceVoucherPosted: boolean;
};

export type FaReconcileEntry = {
  assetId: string;
  periodMonth: string;
  amount: number;
  status: string;
};

export function faExpectedGl(
  cards: readonly FaReconcileCard[],
  entries: readonly FaReconcileEntry[],
  asOf: string
): Map<string, number> {
  const month = asOf.slice(0, 7);
  const posted = new Map<string, number>();
  for (const entry of entries) {
    if (entry.status !== "posted" || entry.periodMonth > month) continue;
    posted.set(entry.assetId, (posted.get(entry.assetId) ?? 0) + entry.amount);
  }
  const expected = new Map<string, number>();
  const add = (account: string, amount: number) =>
    expected.set(account, Math.round(((expected.get(account) ?? 0) + amount) * 100) / 100);
  for (const card of cards) {
    if (card.acquisitionDate > asOf) continue;
    const counted =
      card.status === "active" ||
      (card.status === "disposed" && !!card.disposalDate && card.disposalDate > asOf) ||
      (card.status === "draft" && card.sourceVoucherPosted);
    if (!counted) continue;
    add(card.assetAccountNumber, card.cost);
    const accumulated = card.openingAccumulated + (posted.get(card.id) ?? 0);
    add(card.accumDepAccountNumber, -accumulated);
  }
  return expected;
}
