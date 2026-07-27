"use client";

// Нээлттэй бүх панелийг render хийх нэг цэг + доод талын док (taskbar).
// Dashboard layout-д нэг удаа суулгана.
//
// Санах ойн дүрэм: хураасан панель ХАДГАЛААГҮЙ ӨӨРЧЛӨЛТТЭЙ бол л mounted
// хэвээр үлдэнэ (бөглөж байсан форм алдагдахгүй). Цэвэр (dirty биш) хураасан
// панель unmount хийгдэнэ — сэргээхэд store refreshToken-ийг өсгөдөг тул
// серверээс шинээр татагдана. Ингэснээр олон арван журнал нээсэн ч зөвхөн
// харагдаж буй + бөглөгдөж буй нь л AG Grid-ээ барьж байна.
//
// Док: MAX_DOCK_CHIPS-ээс олон панель нээгдвэл хамгийн сүүлийнх нь чип
// хэлбэрээр, үлдсэн нь "+N" цэсэнд хураангуйлагдана. Док газар эзэлдэг тул
// layout-д зай нөөцөлнө (доор буй "Нийт дүн" зэрэг мөрийг дарахгүй).

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, FileText, Minus, X } from "lucide-react";

import { FloatingPanel } from "./floating-panel";
import { VoucherPanel } from "./voucher-panel";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePanelStore, type PanelInstance } from "@/lib/store/panel-store";
import { Z } from "@/lib/ui/z-layers";
import { cn } from "@/lib/utils";

/** Докт чип хэлбэрээр үзүүлэх дээд тоо — үлдсэн нь "+N" цэсэнд. */
const MAX_DOCK_CHIPS = 6;
/** Док доод хэсэгт эзлэх өндөр — layout-д энэ хэмжээгээр зай нөөцөлнө. */
const DOCK_CLEARANCE = 56;

export function PanelHost() {
  const panels = usePanelStore((state) => state.panels);
  const activeId = usePanelStore((state) => state.activeId);
  const closePanel = usePanelStore((state) => state.closePanel);
  const closeAll = usePanelStore((state) => state.closeAll);
  const restore = usePanelStore((state) => state.restore);
  const minimize = usePanelStore((state) => state.minimize);
  const focus = usePanelStore((state) => state.focus);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // zIndex-ийн зэрэглэл фокусын дарааллаас; харин RENDER болон док нь
  // НЭЭСЭН дарааллаараа тогтмол — фокус солиход панель байрлалаа алдахгүй,
  // док дахь товчнууд ээлжлэн үсэрч самуурахгүй.
  const zRankById = useMemo(() => {
    const byOrder = [...panels].sort((a, b) => a.order - b.order);
    return new Map(byOrder.map((panel, rank) => [panel.id, rank]));
  }, [panels]);

  // Багтахгүй бол ХУУЧИН панелиуд цэс рүү, сүүлд нээгдсэн нь чип хэвээр.
  const chipPanels =
    panels.length > MAX_DOCK_CHIPS ? panels.slice(-MAX_DOCK_CHIPS) : panels;
  const overflowPanels =
    panels.length > MAX_DOCK_CHIPS
      ? panels.slice(0, panels.length - MAX_DOCK_CHIPS)
      : [];

  // Цэс: гадна дарахад болон Esc-д хаагдана. Esc-ийг capture шатанд барьж
  // зогсооно — эс бөгөөс идэвхтэй панелийн Esc-хаалт зэрэг ажиллана.
  useEffect(() => {
    if (!overflowOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!overflowRef.current?.contains(event.target as Node))
        setOverflowOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOverflowOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [overflowOpen]);

  // Цэсэнд байсан панелиуд цөөрч чип болбол цэсийг хаана — render-үеийн
  // тохируулга (нөхцөлтэй тул нэг л удаа дахин render хийнэ, effect биш).
  if (overflowOpen && overflowPanels.length === 0) setOverflowOpen(false);

  async function requestClose(panel: PanelInstance) {
    if (panel.dirty) {
      const ok = await confirm({
        title: "Хадгалаагүй өөрчлөлт",
        description: `"${panel.title}" дээр хадгалаагүй өөрчлөлт байна. Хаавал алдагдана. Хураавал хэвээр хадгалагдана.`,
        confirmText: "Хаах",
        cancelText: "Болих",
        danger: true,
      });
      if (!ok) return;
    }
    closePanel(panel.id);
  }

  async function requestCloseAll() {
    const dirtyCount = panels.filter((panel) => panel.dirty).length;
    const ok = await confirm({
      title: "Бүх панелийг хаах",
      description:
        dirtyCount > 0
          ? `${panels.length} панель нээлттэй, үүнээс ${dirtyCount}-д нь хадгалаагүй өөрчлөлт байна. Хаавал алдагдана.`
          : `Нээлттэй ${panels.length} панелийг бүгдийг хаах уу?`,
      confirmText: "Бүгдийг хаах",
      cancelText: "Болих",
      danger: dirtyCount > 0,
    });
    if (!ok) return;
    setOverflowOpen(false);
    closeAll();
  }

  if (panels.length === 0) return <>{confirmDialog}</>;

  return (
    <>
      {/* Док fixed тул layout-ийн урсгалд зай нөөцөлнө — доор буй
          "Нийт дүн" зэрэг мөрийг далдлахгүй. */}
      <div
        aria-hidden
        className="shrink-0 print:hidden"
        style={{ height: DOCK_CLEARANCE }}
      />

      {panels.map((panel) => {
        // Цэвэр хураастай панель — unmount (сэргээхэд шинээр татна).
        if (panel.minimized && !panel.dirty) return null;
        return (
          <FloatingPanel
            key={panel.id}
            panel={panel}
            zRank={zRankById.get(panel.id) ?? 0}
            active={panel.id === activeId}
            onRequestClose={() => requestClose(panel)}
          >
            <PanelBody panel={panel} requestClose={() => requestClose(panel)} />
          </FloatingPanel>
        );
      })}

      {/* Док — нээлттэй бүх ажил, хураасныг сэргээнэ */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center px-3 pb-3 print:hidden"
        style={{ zIndex: Z.panelDock }}
      >
        <div
          className="pointer-events-auto relative flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1.5"
          style={{
            borderColor: "var(--ea-border-strong)",
            background: "var(--ea-surface-glass, var(--ea-surface))",
            backdropFilter: "blur(12px) saturate(160%)",
            WebkitBackdropFilter: "blur(12px) saturate(160%)",
            boxShadow: "var(--ea-shadow-3)",
          }}
        >
          {overflowPanels.length > 0 && (
            <div ref={overflowRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setOverflowOpen((open) => !open)}
                title={`Өөр ${overflowPanels.length} панель`}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  overflowOpen
                    ? "bg-[var(--ea-primary)] text-white"
                    : "bg-[var(--ea-bg-2)] text-[var(--ea-text-2)] hover:text-[var(--ea-text-1)]"
                )}
              >
                +{overflowPanels.length}
                <ChevronUp
                  size={12}
                  className={cn(
                    "transition-transform",
                    overflowOpen && "rotate-180"
                  )}
                />
                {overflowPanels.some((panel) => panel.dirty) && (
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: "var(--ea-warning, #f59e0b)" }}
                    title="Хадгалаагүй өөрчлөлттэй панель бий"
                  />
                )}
              </button>

              {overflowOpen && (
                <div
                  role="dialog"
                  aria-label="Бусад панелиуд"
                  className="absolute bottom-full left-0 mb-2 flex max-h-80 w-72 flex-col overflow-hidden rounded-xl border"
                  style={{
                    borderColor: "var(--ea-border-strong)",
                    background: "var(--ea-surface)",
                    boxShadow: "var(--ea-shadow-3)",
                  }}
                >
                  <div className="min-h-0 flex-1 overflow-y-auto p-1">
                    {overflowPanels.map((panel) => (
                      <div
                        key={panel.id}
                        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[var(--ea-text-1)] hover:bg-[var(--ea-bg-2)]"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (panel.minimized) restore(panel.id);
                            else focus(panel.id);
                            setOverflowOpen(false);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                          <FileText
                            size={12}
                            className="shrink-0 text-[var(--ea-text-3)]"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {panel.title}
                          </span>
                          {panel.dirty && (
                            <span
                              className="size-1.5 shrink-0 rounded-full"
                              style={{ background: "var(--ea-warning, #f59e0b)" }}
                              title="Хадгалаагүй өөрчлөлт"
                            />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => requestClose(panel)}
                          title="Хаах"
                          aria-label="Хаах"
                          className="flex size-5 shrink-0 items-center justify-center rounded-full text-[var(--ea-text-3)] hover:bg-[var(--ea-danger)]/12 hover:text-[var(--ea-danger)]"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={requestCloseAll}
                    className="shrink-0 px-3 py-2 text-left text-xs font-medium text-[var(--ea-danger)] transition-colors hover:bg-[var(--ea-danger)]/8"
                    style={{ borderTop: "1px solid var(--ea-border)" }}
                  >
                    Бүх панелийг хаах ({panels.length})
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
            {chipPanels.map((panel) => {
              const isActive = panel.id === activeId && !panel.minimized;
              return (
                <div
                  key={panel.id}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full py-1 pl-2.5 pr-1 text-xs transition-colors",
                    isActive
                      ? "bg-[var(--ea-primary)] text-white"
                      : panel.minimized
                        ? "text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)]"
                        : "bg-[var(--ea-bg-2)] text-[var(--ea-text-1)]"
                  )}
                >
                  <button
                    type="button"
                    onClick={() =>
                      panel.minimized
                        ? restore(panel.id)
                        : isActive
                          ? minimize(panel.id)
                          : focus(panel.id)
                    }
                    title={
                      panel.minimized
                        ? "Сэргээх"
                        : isActive
                          ? "Хураах"
                          : "Идэвхжүүлэх"
                    }
                    className="flex min-w-0 items-center gap-1.5"
                  >
                    <FileText size={12} className="shrink-0" />
                    <span className="max-w-40 truncate">{panel.title}</span>
                    {panel.dirty && (
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{
                          background: isActive
                            ? "white"
                            : "var(--ea-warning, #f59e0b)",
                        }}
                        title="Хадгалаагүй өөрчлөлт"
                      />
                    )}
                  </button>
                  {!panel.minimized && !isActive && (
                    <button
                      type="button"
                      onClick={() => minimize(panel.id)}
                      title="Хураах"
                      aria-label="Хураах"
                      className="flex size-4 items-center justify-center rounded-full opacity-60 hover:opacity-100"
                    >
                      <Minus size={11} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => requestClose(panel)}
                    title="Хаах"
                    aria-label="Хаах"
                    className="flex size-4 items-center justify-center rounded-full opacity-60 hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {confirmDialog}
    </>
  );
}

function PanelBody({
  panel,
  requestClose,
}: {
  panel: PanelInstance;
  requestClose: () => void;
}) {
  switch (panel.kind) {
    case "voucher":
    case "voucher-new":
      return <VoucherPanel panel={panel} requestClose={requestClose} />;
    default:
      return null;
  }
}
