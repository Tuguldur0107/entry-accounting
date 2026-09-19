// Журналын жагсаалтын мөрийн ТӨРӨЛ + цэвэр туслах — DB хамааралгүй.
//
// ЗААВАЛ ЭНЭ ФАЙЛ: client component (components/gl/journal-list.tsx) энэ
// төрөл/функцийг уншдаг. Ачаалагч (journal-list-data.ts) `@/lib/db`-г import
// хийдэг тул client талаас ТҮҮНИЙГ import хийвэл postgres драйвер browser
// bundle-д орж `next build` унана (fs/net/tls олдохгүй) — CLAUDE.md §5b-ийн
// exchange-rates.ts-тэй ижил дүрэм.

import type { JournalVoucherWithLines } from "@/lib/db/schema";

export type JournalListRow = JournalVoucherWithLines & {
  /** Эх баримтын харилцагч (касс: чөлөөт текст, АР/АП: харилцагчийн нэр). */
  counterpartyName: string | null;
  /** Эх баримтын валют; эхгүй журнал → "MNT". */
  currency: string;
  /** Баримтын ханш (1 валют = N MNT); MNT эсвэл эхгүй → null. */
  exchangeRate: number | null;
  /** Үүсгэсэн хэрэглэгчийн нэр (journal_vouchers.userId = createdBy). */
  createdByName: string;
};

/**
 * MNT дүнг баримтын валют руу лавлагааны зорилгоор хөрвүүлнэ (2 орон).
 * Ханшгүй (MNT) бол null — "валютын дүн" багана хоосон харагдана.
 */
export function toSourceCurrency(
  mntAmount: number,
  exchangeRate: number | null
): number | null {
  if (exchangeRate == null || !(exchangeRate > 0)) return null;
  return Math.round((mntAmount / exchangeRate) * 100) / 100;
}
