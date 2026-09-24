// Хуудас ӨӨРӨӨ эзэмшдэг товчлол — ЦЭВЭР бүртгэл (tests/hotkeys.test.ts).
//
// Глобал товчлол (топбарын «+ Шинэ» F2, палитр «/») нь энд бүртгэгдсэн хуудсан
// дээр АЖИЛЛАХГҮЙ — тэр хуудас товчлолоо өөрөөр хэрэглэдэг. Урьд нь кассын
// дэлгэц дээр F2 (бараа хайх) дарахад «Шинэ баримт» цэс, «/» дарахад палитр
// зэрэг нээгддэг байв: хоёр сонсогч хоёулаа `window`/`document` дээр байсан.
//
// Шинэ хуудас өөрийн товчлол нэмбэл энд бүртгэнэ; глобал сонсогчид
// `pageOwnsHotkey(pathname, key)`-ээр л шалгана — хуудасны нэрийг hardcode
// хийхгүй.

export type OwnedHotkeys = { path: string; keys: readonly string[] };

export const PAGE_OWNED_HOTKEYS: readonly OwnedHotkeys[] = [
  // Кассын дэлгэц (components/pos/pos-checkout-view.tsx): F2 / "/" хайлт,
  // F4 хөнгөлөлт, F6 харилцагч, F9 төлбөр.
  { path: "/inventory/pos", keys: ["F2", "/", "F4", "F6", "F9"] },
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
