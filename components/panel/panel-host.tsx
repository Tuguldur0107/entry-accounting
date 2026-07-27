"use client";

// Нээлттэй бүх панелийг render хийх нэг цэг + доод талын док (taskbar).
// Dashboard layout-д нэг удаа суулгана. Хураасан панель UNMOUNT ХИЙГДЭХГҮЙ
// (зөвхөн нуугдана) тул бөглөж байсан форм хэвээр үлдэнэ.

import { useMemo } from "react";
import { FileText, Minus, X } from "lucide-react";

import { FloatingPanel } from "./floating-panel";
import { VoucherPanel } from "./voucher-panel";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePanelStore, type PanelInstance } from "@/lib/store/panel-store";
import { Z } from "@/lib/ui/z-layers";
import { cn } from "@/lib/utils";

export function PanelHost() {
  const panels = usePanelStore((state) => state.panels);
  const activeId = usePanelStore((state) => state.activeId);
  const closePanel = usePanelStore((state) => state.closePanel);
  const restore = usePanelStore((state) => state.restore);
  const minimize = usePanelStore((state) => state.minimize);
  const focus = usePanelStore((state) => state.focus);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Нээгдсэн дарааллаар — сүүлд фокуслагдсан нь хамгийн дээр.
  const stacked = useMemo(
    () => [...panels].sort((a, b) => a.order - b.order),
    [panels]
  );
  const visible = stacked.filter((panel) => !panel.minimized);

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

  if (panels.length === 0) return <>{confirmDialog}</>;

  return (
    <>
      {stacked.map((panel) => (
        <FloatingPanel
          key={panel.id}
          panel={panel}
          index={visible.findIndex((entry) => entry.id === panel.id)}
          active={panel.id === activeId}
          onRequestClose={() => requestClose(panel)}
        >
          <PanelBody panel={panel} requestClose={() => requestClose(panel)} />
        </FloatingPanel>
      ))}

      {/* Док — нээлттэй бүх ажил, хураасныг сэргээнэ */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center px-3 pb-3"
        style={{ zIndex: Z.panelDock }}
      >
        <div
          className="pointer-events-auto flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full border px-2 py-1.5"
          style={{
            borderColor: "var(--ea-border-strong)",
            background: "var(--ea-surface-glass, var(--ea-surface))",
            backdropFilter: "blur(12px) saturate(160%)",
            WebkitBackdropFilter: "blur(12px) saturate(160%)",
            boxShadow: "var(--ea-shadow-3)",
          }}
        >
          {stacked.map((panel) => {
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
