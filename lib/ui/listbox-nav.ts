// Хайлттай жагсаалтын (SearchableSelect) гарын удирдлага — ЦЭВЭР.
// Идэвхтэй мөр нь харагдаж буй (шүүгдсэн) мөрийн индекс; -1 = мөр алга.

/** Нээх / хайлт өөрчлөгдөх үеийн идэвхтэй мөр: хайлтгүй бол сонгосон утга, эс бөгөөс эхний мөр. */
export function initialActiveIndex(
  values: readonly string[],
  selected: string,
  hasQuery: boolean
): number {
  if (values.length === 0) return -1;
  if (!hasQuery && selected) {
    const index = values.indexOf(selected);
    if (index >= 0) return index;
  }
  return 0;
}

/** ↑/↓ — хил дээр зогсоно (эргэлдэхгүй). */
export function moveActiveIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, current + delta));
}

/** Enter-ээр сонгох утга — тохирох мөр алга бол null (юу ч сонгохгүй, «Хоосон» БИШ). */
export function enterPickValue(values: readonly string[], active: number): string | null {
  if (values.length === 0) return null;
  const index = Math.max(0, Math.min(values.length - 1, active));
  return values[index] ?? null;
}
