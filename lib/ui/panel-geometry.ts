// Хөвөгч панелийн ГЕОМЕТРИЙН цэвэр логик (DOM-гүй, тесттэй).
//
// Панель нь анхнаасаа `slot`-оор шатлан байрлана (баруун дээд булангаас).
// Хэрэглэгч гарчигнаас нь ЧИРЭХ эсвэл ирмэгээс нь ТАТАХ мөчид тухайн
// панелийн БОДИТ тэгш өнцөгт (x/y/өргөн/өндөр) бүртгэгдэж, цаашид тэрээр
// байрлалыг тогтооно.
//
// ХАТУУ ДҮРЭМ: панель дэлгэцээс БҮРЭН гарахгүй — гарчгийн `PANEL_KEEP_VISIBLE`
// хэсэг үргэлж харагдаж байх ёстой (эс бөгөөс хэрэглэгч дахин барьж чадахгүй
// болно). Дээд талд topbar-ын доогуур орохгүй.

export interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Хамгийн бага хэмжээ — доор нь агуулга уншигдахаа болино. */
export const PANEL_MIN_WIDTH = 420;
export const PANEL_MIN_HEIGHT = 220;
/** Дэлгэцэн дээр ЗААВАЛ үлдэх хэсэг (чирж буцаах боломжтой байхын тулд). */
export const PANEL_KEEP_VISIBLE = 160;
/** Topbar-ын өндөр — панель үүнээс дээш гарахгүй. */
export const PANEL_TOP_MIN = 56;
/** Доод док (taskbar) — панелийн анхны доод зай. */
export const PANEL_BOTTOM_GAP = 72;

/** Шатласан офсет — panel-store-ийн slot-той ИЖИЛ дүрэм. */
export const slotOffset = (slot: number) => Math.min(Math.max(slot, 0), 4) * 22;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Панелийн АНХНЫ байрлал — хуучин CSS (top: 72+offset, right: 24+offset,
 * width: min(1180, 100vw−48), bottom: 72)-тай ЯГ ИЖИЛ. Чирээгүй панель
 * хэвээрээ харагдана.
 */
export function defaultPanelRect(slot: number, viewport: Viewport): PanelRect {
  const offset = slotOffset(slot);
  const width = Math.min(1180, Math.max(320, viewport.width - 48));
  const y = 72 + offset;
  const height = Math.max(160, viewport.height - y - PANEL_BOTTOM_GAP);
  return { x: viewport.width - 24 - offset - width, y, width, height };
}

/** Дэлгэцийн хил рүү оруулна — хэмжээ ба байрлал хоёуланг. */
export function clampPanelRect(rect: PanelRect, viewport: Viewport): PanelRect {
  const width = clamp(
    rect.width,
    Math.min(PANEL_MIN_WIDTH, viewport.width),
    Math.max(PANEL_MIN_WIDTH, viewport.width)
  );
  const height = clamp(
    rect.height,
    Math.min(PANEL_MIN_HEIGHT, viewport.height),
    Math.max(PANEL_MIN_HEIGHT, viewport.height - PANEL_TOP_MIN)
  );
  return {
    width,
    height,
    x: clamp(
      rect.x,
      PANEL_KEEP_VISIBLE - width,
      viewport.width - PANEL_KEEP_VISIBLE
    ),
    y: clamp(rect.y, PANEL_TOP_MIN, Math.max(PANEL_TOP_MIN, viewport.height - 40)),
  };
}

/** Чирэлт — хэмжээ хөндөгдөхгүй, зөвхөн байрлал. */
export function movePanelRect(
  rect: PanelRect,
  dx: number,
  dy: number,
  viewport: Viewport
): PanelRect {
  return clampPanelRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, viewport);
}

/** Хэмжээ солих ирмэг/булан. */
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Ирмэгээс татах. Баруун/доод ирмэг нь зөвхөн хэмжээг, зүүн/дээд ирмэг нь
 * хэмжээ БА байрлалыг хамт өөрчилнө (эсрэг тал нь байрандаа үлдэнэ).
 */
export function resizePanelRect(
  rect: PanelRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  viewport: Viewport
): PanelRect {
  let { x, y, width, height } = rect;
  const minWidth = Math.min(PANEL_MIN_WIDTH, viewport.width);
  const minHeight = Math.min(PANEL_MIN_HEIGHT, viewport.height);

  if (edge.includes("e")) width = Math.max(minWidth, width + dx);
  if (edge.includes("w")) {
    const right = x + width;
    x = Math.min(x + dx, right - minWidth);
    width = right - x;
  }
  if (edge.includes("s")) height = Math.max(minHeight, height + dy);
  if (edge.includes("n")) {
    const bottom = y + height;
    y = Math.min(y + dy, bottom - minHeight);
    height = bottom - y;
  }
  return clampPanelRect({ x, y, width, height }, viewport);
}
