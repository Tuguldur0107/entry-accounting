// Данс КОД эсвэл НЭРЭЭР хайх (SIM2-029) — ЦЭВЭР (tests/sim2-account-search.test.ts).
// Эрэмбэ: код угтвар > нэрийн эхлэл > нэрийн үгийн эхлэл > нэрийн дотор > кодын дотор.

export type AccountOption = { code: string; name: string };

export function suggestAccounts(
  options: readonly AccountOption[],
  query: string,
  limit = 8
): AccountOption[] {
  const q = query.trim().toLowerCase();
  // Бүтэн сегментчилсэн код бичиж байгаа бол санал болгохгүй (гар оролт).
  if (!q || q.includes(".")) return [];
  const rank = (option: AccountOption): number => {
    const code = option.code.toLowerCase();
    const name = option.name.toLowerCase();
    if (code.startsWith(q)) return 0;
    if (name.startsWith(q)) return 1;
    if (name.split(/[\s,()/-]+/).some((word) => word.startsWith(q))) return 2;
    if (name.includes(q)) return 3;
    if (code.includes(q)) return 4;
    return -1;
  };
  return options
    .map((option) => ({ option, score: rank(option) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.option.code.localeCompare(b.option.code))
    .slice(0, limit)
    .map((entry) => entry.option);
}
