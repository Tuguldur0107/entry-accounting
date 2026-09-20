// AI саналын ҮР ДҮНГИЙН төлвийн машин + СУРГАЛТЫН шүүлтүүр — ЦЭВЭР логик.
//
// `@/lib/db` импорт ХИЙХГҮЙ. Хэв маяг нь lib/qpay/intent.ts-тэй ИЖИЛ:
// шилжилтийн дүрэм нэг цэгт, тесттэй.

import type { AiResolution } from "./constants";

/**
 * Зөвшөөрөгдсөн шилжилтүүд.
 *
 *   no_action ──▶ accepted | modified | rejected
 *   accepted  ──▶ modified | rejected     (нябо дараа нь засварлав / буцаав)
 *   modified  ──▶ accepted | rejected
 *   rejected  ──▶ ТЭРЭГТЭЙ (эцсийн)
 *
 * `rejected` нь ЭЦСИЙН: татгалзсан саналыг хожим «хүлээн авсан» болговол
 * шошго хуурамч болно — татгалзсаны дараа хүн ШИНЭ бичилт хийсэн бол тэр
 * нь ӨӨР санал (эсвэл саналгүй) тул шинэ мөр байх ёстой.
 * Ижил төлөв рүү шилжих (idempotent дахин бичилт) үргэлж зөвшөөрөгдөнө.
 */
const ALLOWED: Record<AiResolution, readonly AiResolution[]> = {
  no_action: ["accepted", "modified", "rejected"],
  accepted: ["modified", "rejected"],
  modified: ["accepted", "rejected"],
  rejected: [],
};

export function canTransition(from: AiResolution, to: AiResolution): boolean {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

/** Эцсийн төлөв үү (цаашид өөрчлөгдөхгүй). */
export function isTerminalResolution(value: AiResolution): boolean {
  return ALLOWED[value].length === 0;
}

/**
 * Саналын үр дүнгээс БОДИТ баримт үүссэн үү — `accepted`/`modified` хоёрт
 * л linked_document утгатай байх ёстой.
 */
export function producesDocument(value: AiResolution): boolean {
  return value === "accepted" || value === "modified";
}

/**
 * Сургалтын шошго болох эсэхэд шаардлагатай талбарууд.
 *
 * `resolution` ЗОРИУД ОРООГҮЙ: шийдвэрийг баримтын БОДИТ төлөв гаргадаг
 * (ноорог хэвээр бол is_posted false, устгагдсан бол has_reversal true) —
 * resolution-ийг давхар шалгавал нэг үнэнийг хоёр газар тодорхойлно.
 */
export type TrainingEligibilityInput = {
  isPosted: boolean;
  isPeriodClosed: boolean;
  hasReversal: boolean;
};

/**
 * СУРГАЛТЫН ШҮҮЛТҮҮР — ЦОРЫН ГАНЦ тодорхойлолт.
 *
 *   is_posted && is_period_closed && !has_reversal
 *
 * Гурван нөхцөл тус бүрийн шалтгаан:
 *  • is_posted        — ноорог нь хүний шийдвэр БИШ, зүгээр л санал
 *  • is_period_closed — хаагдсан үеийн бичилт immutable → шошго тогтвортой
 *  • !has_reversal    — хаагдсаны ДАРАА буцаагдсан бичилт нь «AI зөв
 *                       санал болгосон» гэсэн ХУДАЛ эерэг шошго үүсгэнэ.
 *                       Эдгээр нь яг AI алдсан тохиолдлууд тул эерэг
 *                       шошгоор сургахыг ХОРИГЛОНО (docs/ai-logging.md §6)
 *
 * `rejected` мөр нь шошго болж БОЛНО (сөрөг шошго) — гэхдээ баримт
 * үүсээгүй тул is_posted хэзээ ч true болохгүй; өөрөөр хэлбэл энэ
 * шүүлтүүр нь ЭЕРЭГ шошгын түүврийг тодорхойлно.
 */
export function isTrainingEligible(row: TrainingEligibilityInput): boolean {
  return row.isPosted && row.isPeriodClosed && !row.hasReversal;
}

/** Яагаад сургалтад ороогүйг хүнд уншигдахаар (UI / дебаг). */
export function trainingExclusionReason(
  row: TrainingEligibilityInput
): string | null {
  if (!row.isPosted) return "Бичилт батлагдаагүй";
  if (!row.isPeriodClosed) return "Тайлант үе хаагдаагүй";
  if (row.hasReversal) return "Баримт хожим буцаагдсан / хүчингүй болсон";
  return null;
}
