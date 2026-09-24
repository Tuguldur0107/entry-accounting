// Хуудас ӨӨРӨӨ эзэмшдэг товчлол — ЦЭВЭР бүртгэл (tests/hotkeys.test.ts).
//
// Глобал товчлол (топбарын «+ Шинэ» F2, палитр «/») нь хуудас ЭЗЭМШДЭГ
// товчлол дээр АЖИЛЛАХГҮЙ. Урьд нь кассын дэлгэц F2-г бараа хайхад ашиглаж,
// F2 дарахад «Шинэ баримт» цэс, «/» дарахад палитр ЗЭРЭГ нээгддэг байв.
//
// Дүрэм: F2 = «+ Шинэ» аппын ХААНА Ч (кассын дэлгэц ч) — хуудас F2-г
// эзэмшихгүй; кассын бараа хайлт F3. Шинэ хуудас глобал товчлолыг өөрөөр
// хэрэглэвэл энд бүртгэнэ; глобал сонсогчид `pageOwnsHotkey(pathname, key)`-
// ээр л шалгана — хуудасны нэрийг hardcode хийхгүй.
//
// Focus-тай input дотор глобал товчлол ажилладаггүй (F2 = нүд засах г.м.);
// үргэлж focus-той input (кассын хайлт) `data-global-hotkeys="F2"`-оор
// тухайн глобал товчлолыг нэвтрүүлнэ (`allowsGlobalHotkey`).

export type OwnedHotkeys = { path: string; keys: readonly string[] };

export const PAGE_OWNED_HOTKEYS: readonly OwnedHotkeys[] = [
  // Кассын дэлгэц (components/pos/pos-checkout-view.tsx): F3 / "/" хайлт,
  // F4 хөнгөлөлт, F6 харилцагч, F9 төлбөр. F2 ЭНД БАЙХГҮЙ — глобал «+ Шинэ».
  { path: "/inventory/pos", keys: ["F3", "/", "F4", "F6", "F9"] },
];

/** `pathname` нь `path` өөрөө эсвэл түүний дэд зам мөн эсэх. */
function matchesPath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Энэ хуудас `key` товчлолыг өөрөө эзэмшдэг бол true — глобал товчлол алгасна. */
export function pageOwnsHotkey(pathname: string | null | undefined, key: string): boolean {
  if (!pathname) return false;
  return PAGE_OWNED_HOTKEYS.some(
    (entry) => matchesPath(pathname, entry.path) && entry.keys.includes(key)
  );
}

/**
 * Focus-тай элемент (эсвэл түүний эцэг) `data-global-hotkeys`-д `key`-г
 * жагсаасан бол глобал товчлол input дотор ч ажиллана.
 */
export function allowsGlobalHotkey(target: EventTarget | null, key: string): boolean {
  const element = target as { closest?: (selector: string) => Element | null } | null;
  const host = element?.closest?.("[data-global-hotkeys]");
  if (!host) return false;
  return (host.getAttribute("data-global-hotkeys") ?? "").split(/\s+/).includes(key);
}
