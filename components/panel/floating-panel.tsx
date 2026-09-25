"use client";

// Хөвөгч ажлын панелийн НЭГДСЭН жааз. Гарчиг + [─ хураах] [▢ дэлгэц дүүрэх]
// [✕ хаах]. Modal БИШ: ард нь байгаа хуудас ажиллаж, хэд хэдэн панель зэрэг
// нээгдэнэ. Хураахад агуулга нь unmount хийгдэхгүй (нуугдана) тул бөглөж
// байсан форм хэвээр үлдэнэ.
//
// Байрлал panel.slot-оос (тогтмол), давхарга zRank-аас (фокусаар өөрчлөгддөг)
// тооцогдоно — фокус солиход панель ХӨДЛӨХГҮЙ, зөвхөн дээшилнэ. Эс бөгөөс
// идэвхгүй панелийн товчин дээр дарахад mousedown дээр байрлал нь сольчихоод
// click нь өөр элемент дээр буудаг байсан.
//
// ЗӨӨХ / ХЭМЖЭЭ СОЛИХ: гарчгаас чирнэ, ирмэг/булангаас татна. Чирсэн мөчид
// панелийн БОДИТ тэгш өнцөгт store-д бүртгэгдэж (panel.rect), цаашид байрлал
// ЗӨВХӨН түүнээс тооцогдоно — нэг байрлалд хоёр эзэн байхгүй. Геометрийн
// бүх тооцоо (хил, хамгийн бага хэмжээ) цэвэр `lib/ui/panel-geometry.ts`-д,
// тесттэй. Гарчиг дээр 2 удаа дархад дэлгэц дүүрэх нь ХЭВЭЭР — чирэлт нь 3px
// хөдөлсний ДАРАА эхэлдэг тул давхар даралттай мөргөлдөхгүй.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";

import { usePanelStore, type PanelInstance } from "@/lib/store/panel-store";
import {
  clampPanelRect,
  defaultPanelRect,
  movePanelRect,
  resizePanelRect,
  type PanelRect,
  type ResizeEdge,
} from "@/lib/ui/panel-geometry";
import { panelZ } from "@/lib/ui/z-layers";
import { cn } from "@/lib/utils";

interface Props {
  panel: PanelInstance;
  /** Давхаргын зэрэг (0 = хамгийн доор) — фокусын дарааллаар. */
  zRank: number;
  active: boolean;
  children: React.ReactNode;
  /** Хаахын өмнөх шалгалт (жишээ нь хадгалаагүй өөрчлөлт). */
  onRequestClose?: () => void;
  /** Агуулгадаа тохирох анхны хэмжээ (богино форм — SIM2-031). */
  compact?: { width: number; maxHeight: number };
}

export function FloatingPanel({
  panel,
  zRank,
  active,
  children,
  onRequestClose,
  compact,
}: Props) {
  const minimize = usePanelStore((state) => state.minimize);
  const toggleMaximize = usePanelStore((state) => state.toggleMaximize);
  const focus = usePanelStore((state) => state.focus);
  const closePanel = usePanelStore((state) => state.closePanel);
  const navigatePanel = usePanelStore((state) => state.navigatePanel);
  const setRect = usePanelStore((state) => state.setRect);
  const resetRect = usePanelStore((state) => state.resetRect);

  // Жагсаалтаас нээгдсэн панель — өмнөх/дараагийн баримт руу шилжих нав.
  const navIds = panel.payload.navIds as string[] | undefined;
  const navField = panel.payload.navField as string | undefined;
  const navCurrent = navField
    ? (panel.payload[navField] as string | undefined)
    : undefined;
  const navIndex =
    navIds && navCurrent ? navIds.indexOf(navCurrent) : -1;
  const hasNav = !!navIds && navIds.length > 1 && navIndex >= 0;

  const rootRef = useRef<HTMLDivElement>(null);

  const requestClose = useCallback(() => {
    if (onRequestClose) onRequestClose();
    else closePanel(panel.id);
  }, [onRequestClose, closePanel, panel.id]);

  // Идэвхжихэд фокусыг панель руу оруулна — Esc/Ctrl+Enter зэрэг товчлуур
  // зөв панельд очно. Хэрэглэгч панель доторх талбар дээр дарсан бол фокусыг
  // нь булаахгүй.
  useEffect(() => {
    if (!active || panel.minimized) return;
    const root = rootRef.current;
    if (!root) return;
    if (!root.contains(document.activeElement)) root.focus();
  }, [active, panel.minimized]);

  // Esc — зөвхөн ФОКУСТАЙ панелийг хаана (доод давхаргууд хөндөгдөхгүй).
  useEffect(() => {
    if (!active || panel.minimized) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target) {
        // Popover/dialog нээлттэй бол тэр нь эхэлж хаагдана. Панель ӨӨРӨӨ
        // role="dialog" тул зөвхөн ӨӨРӨӨС нь ЯЛГААТАЙ overlay-г тоолно.
        const overlay = target.closest(
          "[data-account-segment-panel],[data-searchable-portal],[data-seg-portal],[role='dialog']"
        );
        if (overlay && overlay !== rootRef.current) return;
        // ЭНЭ панель доторх талбар/грид засварт Esc нь editor-ийнх.
        // Гаднах (ард буй хуудасны) input-ууд панелийн Esc-ийг хаахгүй.
        if (
          rootRef.current?.contains(target) &&
          target.closest("input,textarea,select,[contenteditable],.ag-root")
        )
          return;
      }
      event.stopPropagation();
      requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, panel.minimized, requestClose]);

  // Чирэлт/татлагын үеийн төлөв — зөвхөн cursor-т нөлөөлнө (байрлал store-д).
  const [dragging, setDragging] = useState<"move" | ResizeEdge | null>(null);

  const viewport = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  /** Одоогийн бодит тэгш өнцөгт — rect тавигдаагүй бол DOM-оос хэмжинэ. */
  const currentRect = useCallback((): PanelRect => {
    if (panel.rect) return panel.rect;
    const box = rootRef.current?.getBoundingClientRect();
    if (box)
      return { x: box.left, y: box.top, width: box.width, height: box.height };
    return defaultPanelRect(panel.slot, viewport());
  }, [panel.rect, panel.slot]);

  /**
   * Заагчийн чирэлтийг нэг газраас удирдана (хулгана, хуруу, цөм хоёуланд
   * pointer event). Босго 3px — товч дарах, давхар даралт зэрэг ЖИЖИГ
   * хөдөлгөөнийг чирэлт гэж андуурахгүй.
   */
  const beginDrag = useCallback(
    (event: React.PointerEvent, mode: "move" | ResizeEdge) => {
      if (event.button !== 0 || panel.maximized) return;
      event.preventDefault();
      focus(panel.id);
      const start = currentRect();
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;

      const onMove = (move: PointerEvent) => {
        const dx = move.clientX - startX;
        const dy = move.clientY - startY;
        if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        if (!moved) {
          moved = true;
          setDragging(mode);
        }
        setRect(
          panel.id,
          mode === "move"
            ? movePanelRect(start, dx, dy, viewport())
            : resizePanelRect(start, mode, dx, dy, viewport())
        );
      };
      const onUp = () => {
        setDragging(null);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [panel.id, panel.maximized, currentRect, focus, setRect]
  );

  // Цонх жижгэрэхэд чирсэн панель гадуур үлдэж болзошгүй — дотогш эргүүлнэ.
  useEffect(() => {
    if (!panel.rect) return;
    const onResize = () => {
      const next = clampPanelRect(panel.rect!, viewport());
      if (
        next.x !== panel.rect!.x ||
        next.y !== panel.rect!.y ||
        next.width !== panel.rect!.width ||
        next.height !== panel.rect!.height
      )
        setRect(panel.id, next);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [panel.rect, panel.id, setRect]);

  // Шатласан офсет — ТОГТМОЛ суудлаас (фокусаар өөрчлөгдөхгүй).
  const offset = Math.min(panel.slot, 4) * 22;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={panel.title}
      tabIndex={-1}
      // Хураастай панель руу Tab-аар орох боломжгүй (агуулга нь mounted
      // хэвээр ч гэсэн) — inert нь focus + hit-testing хоёуланг хаана.
      inert={panel.minimized}
      onMouseDown={() => !active && focus(panel.id)}
      // Tab-аар панелийн талбарт орсон ч идэвхжинэ (зөвхөн хулгана биш).
      onFocus={() => !active && focus(panel.id)}
      className={cn(
        "pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border outline-none transition-[opacity] duration-150 print:hidden",
        panel.minimized && "pointer-events-none invisible opacity-0"
      )}
      style={{
        zIndex: panelZ(zRank),
        borderColor: active ? "var(--ea-primary)" : "var(--ea-border-strong)",
        background: "var(--ea-surface)",
        boxShadow: active ? "var(--ea-shadow-3)" : "var(--ea-shadow-2)",
        ...(panel.maximized
          ? { inset: "12px 12px 60px 12px" }
          : panel.rect
            ? {
                // Хэрэглэгчийн ЧИРСЭН байрлал — цорын ганц эзэн.
                left: panel.rect.x,
                top: panel.rect.y,
                width: panel.rect.width,
                height: panel.rect.height,
              }
            : compact
              ? {
                  // Богино форм: өндөр агуулгаараа, товчнууд формын доор.
                  top: 72 + offset,
                  right: 24 + offset,
                  width: `min(${compact.width}px, calc(100vw - 48px))`,
                  maxHeight: `min(${compact.maxHeight}px, calc(100vh - ${144 + offset}px))`,
                }
              : {
                  top: 72 + offset,
                  right: 24 + offset,
                  width: "min(1180px, calc(100vw - 48px))",
                  bottom: 72,
                }),
        // Чирч байхад доторх текст сонгогдож, iframe-үүд заагчийг булаахгүй.
        userSelect: dragging ? "none" : undefined,
      }}
    >
      <header
        onDoubleClick={() => toggleMaximize(panel.id)}
        onPointerDown={(event) => {
          // Товч/линк дээрх даралт чирэлт БИШ.
          if ((event.target as HTMLElement).closest("button,a,input")) return;
          beginDrag(event, "move");
        }}
        className={cn(
          "flex h-10 shrink-0 items-center gap-2 px-3",
          panel.maximized
            ? "cursor-default"
            : dragging === "move"
              ? "cursor-grabbing"
              : "cursor-grab"
        )}
        title={panel.maximized ? undefined : "Чирж зөөнө · 2 дарвал дэлгэц дүүрэн"}
        style={{
          borderBottom: "1px solid var(--ea-border)",
          background: active ? "var(--ea-bg-2)" : "var(--ea-surface)",
          // Хуруугаар чирэхэд хуудас гүйлгэхгүй (зөвхөн панель хөдөлнө).
          touchAction: panel.maximized ? undefined : "none",
        }}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ea-text-1)]">
          {panel.title}
        </span>
        {hasNav && (
          <div className="flex shrink-0 items-center gap-0.5">
            <PanelIconButton
              label="Өмнөх баримт"
              disabled={panel.dirty || navIndex <= 0}
              onClick={() => navigatePanel(panel.id, -1)}
              icon={<Icon name="chevronUp" size="sm" />}
            />
            <span
              className="font-mono text-[11px] tabular-nums"
              style={{ color: "var(--ea-text-4)" }}
            >
              {navIndex + 1}/{navIds!.length}
            </span>
            <PanelIconButton
              label="Дараагийн баримт"
              disabled={panel.dirty || navIndex >= navIds!.length - 1}
              onClick={() => navigatePanel(panel.id, 1)}
              icon={<Icon name="chevronDown" size="sm" />}
            />
          </div>
        )}
        {panel.dirty && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{
              background: "var(--ea-warning-bg)",
              color: "var(--ea-warning-fg, var(--ea-warning))",
            }}
          >
            Хадгалаагүй
          </span>
        )}
        {panel.rect && !panel.maximized && (
          <PanelIconButton
            label="Байрлалыг сэргээх"
            onClick={() => resetRect(panel.id)}
            icon={<Icon name="reset" size="sm" />}
          />
        )}
        <PanelIconButton
          label="Хураах"
          onClick={() => minimize(panel.id)}
          icon={<Icon name="minus" size="sm" />}
        />
        <PanelIconButton
          label={panel.maximized ? "Багасгах" : "Дэлгэц дүүрэн"}
          onClick={() => toggleMaximize(panel.id)}
          icon={
            panel.maximized ? <Icon name="minimize" size="sm" /> : <Icon name="maximize" size="sm" />
          }
        />
        <PanelIconButton
          label="Хаах"
          danger
          onClick={requestClose}
          icon={<Icon name="close" size="sm" />}
        />
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>

      {!panel.maximized &&
        RESIZE_HANDLES.map((handle) => (
          <div
            key={handle.edge}
            onPointerDown={(event) => beginDrag(event, handle.edge)}
            className={cn("absolute", handle.className)}
            style={{ cursor: handle.cursor, touchAction: "none" }}
            aria-hidden
          />
        ))}
    </div>
  );
}

/**
 * Хэмжээ солих бариулууд — 4 ирмэг + 4 булан. Ирмэг 6px, булан 12px (булан
 * нь ирмэгээс ДЭЭР байрлана: DOM-д сүүлд ирснээр давуу эрхтэй).
 */
const RESIZE_HANDLES: {
  edge: ResizeEdge;
  className: string;
  cursor: string;
}[] = [
  { edge: "n", className: "left-0 right-0 top-0 h-1.5", cursor: "ns-resize" },
  { edge: "s", className: "bottom-0 left-0 right-0 h-1.5", cursor: "ns-resize" },
  { edge: "w", className: "bottom-0 left-0 top-0 w-1.5", cursor: "ew-resize" },
  { edge: "e", className: "bottom-0 right-0 top-0 w-1.5", cursor: "ew-resize" },
  { edge: "nw", className: "left-0 top-0 size-3", cursor: "nwse-resize" },
  { edge: "ne", className: "right-0 top-0 size-3", cursor: "nesw-resize" },
  { edge: "sw", className: "bottom-0 left-0 size-3", cursor: "nesw-resize" },
  { edge: "se", className: "bottom-0 right-0 size-3", cursor: "nwse-resize" },
];

function PanelIconButton({
  label,
  icon,
  onClick,
  danger = false,
  disabled = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded transition-colors",
        danger
          ? "text-[var(--ea-text-3)] hover:bg-[var(--ea-danger)]/12 hover:text-[var(--ea-danger)]"
          : "text-[var(--ea-text-3)] hover:bg-[var(--ea-border)] hover:text-[var(--ea-text-1)]",
        disabled && "pointer-events-none opacity-35"
      )}
    >
      {icon}
    </button>
  );
}
