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

import { useCallback, useEffect, useRef } from "react";
import { Icon } from "@/components/ui/icon";

import { usePanelStore, type PanelInstance } from "@/lib/store/panel-store";
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
}

export function FloatingPanel({
  panel,
  zRank,
  active,
  children,
  onRequestClose,
}: Props) {
  const minimize = usePanelStore((state) => state.minimize);
  const toggleMaximize = usePanelStore((state) => state.toggleMaximize);
  const focus = usePanelStore((state) => state.focus);
  const closePanel = usePanelStore((state) => state.closePanel);

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
          : {
              top: 72 + offset,
              right: 24 + offset,
              width: "min(1180px, calc(100vw - 48px))",
              bottom: 72,
            }),
      }}
    >
      <header
        onDoubleClick={() => toggleMaximize(panel.id)}
        className="flex h-10 shrink-0 items-center gap-2 px-3"
        style={{
          borderBottom: "1px solid var(--ea-border)",
          background: active ? "var(--ea-bg-2)" : "var(--ea-surface)",
        }}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ea-text-1)]">
          {panel.title}
        </span>
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
    </div>
  );
}

function PanelIconButton({
  label,
  icon,
  onClick,
  danger = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded transition-colors",
        danger
          ? "text-[var(--ea-text-3)] hover:bg-[var(--ea-danger)]/12 hover:text-[var(--ea-danger)]"
          : "text-[var(--ea-text-3)] hover:bg-[var(--ea-border)] hover:text-[var(--ea-text-1)]"
      )}
    >
      {icon}
    </button>
  );
}
