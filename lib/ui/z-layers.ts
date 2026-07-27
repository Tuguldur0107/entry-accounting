/**
 * Апп даяарх давхаргын НЭГДСЭН жагсаалт. Шинэ overlay нэмэхдээ энд бүртгэж,
 * тоог нь энэ файлаас авна — эс бөгөөс z-index-үүд санамсаргүй мөргөлдөнө.
 *
 * Дараалал (доороос дээш):
 *   header/sidebar → панель (олон зэрэг) → modal → anchored popover → toast
 *
 * Anchored popover (данс/сегмент сонгогч) нь modal-аас ДЭЭР байх ёстой —
 * dialog доторх талбараас нээгддэг тул. Панель нь modal-аас ДООР: modal
 * (баталгаажуулалт) нь панелийг түр блоклоно.
 */
export const Z = {
  header: 10,
  sidebarOverlay: 20,
  sidebar: 30,
  /** Хөвөгч ажлын панель — олон зэрэг. zOrder тус бүрд +1 нэмэгдэнэ. */
  panelBase: 40,
  /** Панелийн док (доод taskbar) — панелиудаас дээр. */
  panelDock: 60,
  /** Modal dialog (Base UI) — overlay ба content. */
  modal: 70,
  /** Модулийн сэлгэгч цэс. */
  moduleMenu: 80,
  /** Anchored popover: данс/сегмент/select — бүх modal-аас дээр. */
  popover: 90,
  /** AG Grid-ийн cell editor доторх popup (grid өөрөө өндөр давхаргатай). */
  gridPopup: 10000,
} as const;

/** Панелийн zIndex — стек дэх байрлалаар. */
export function panelZ(index: number): number {
  return Z.panelBase + index;
}
