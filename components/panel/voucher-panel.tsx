"use client";

// Панель доторх журналын засварлагч/харагч. Standalone цонхтой ЯГ ижил
// component-ийг (JournalEntryForm) embedded горимоор ашиглана — өгөгдлөө
// server action-аар өөрөө татна.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { JournalEntryForm } from "@/components/gl/journal-entry-form";
import {
  getJournalEditorData,
  type JournalEditorData,
} from "@/lib/actions/journal-editor";
import {
  openVoucherPanel,
  usePanelStore,
  type PanelInstance,
} from "@/lib/store/panel-store";

const STATUS_TITLES: Record<string, string> = {
  draft: "Ноорог",
  posted: "Бичигдсэн",
  reversed: "Буцаагдсан",
};

export function VoucherPanel({
  panel,
  requestClose,
}: {
  panel: PanelInstance;
  /** Панелийн хаалт — dirty бол баталгаажуулалттай (PanelHost эзэмшинэ). */
  requestClose: () => void;
}) {
  const router = useRouter();
  const closePanel = usePanelStore((state) => state.closePanel);
  const setTitle = usePanelStore((state) => state.setTitle);
  const setDirty = usePanelStore((state) => state.setDirty);
  const activeId = usePanelStore((state) => state.activeId);

  const voucherId = panel.payload.voucherId as string | undefined;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: JournalEditorData }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getJournalEditorData(voucherId)
      .then((data) => {
        if (cancelled) return;
        setState({ status: "ready", data });
        if (data.voucher) {
          const label = STATUS_TITLES[data.voucher.status] ?? data.voucher.status;
          setTitle(
            panel.id,
            `${data.voucher.description || "Журнал"} · ${label}`
          );
        }
      })
      .catch((caught) => {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            caught instanceof Error ? caught.message : "Ачаалж чадсангүй",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [voucherId, panel.id, setTitle]);

  if (state.status === "loading")
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center gap-2 text-sm text-[var(--ea-text-3)]">
        <Loader2 size={16} className="animate-spin" />
        Ачаалж байна…
      </div>
    );

  if (state.status === "error")
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center px-6 text-center text-sm text-[var(--ea-danger)]">
        {state.message}
      </div>
    );

  const { data } = state;

  return (
    <JournalEntryForm
      embedded
      accounts={data.accounts}
      activeSegIds={data.activeSegIds}
      segmentValues={data.segmentValues}
      defaultSegments={data.defaultSegments}
      voucherId={data.voucher?.id}
      voucherStatus={data.voucher?.status}
      voucherCreatedAt={data.voucher?.createdAt}
      readOnly={data.readOnly}
      initialVoucher={
        data.voucher
          ? {
              date: data.voucher.date,
              description: data.voucher.description,
              lines: data.voucher.lines,
            }
          : undefined
      }
      // Ctrl+Enter — зөвхөн фокустай, хураагдаагүй панельд. Эс бөгөөс
      // нээлттэй бүх панель зэрэг хадгалчихна.
      shortcutsEnabled={activeId === panel.id && !panel.minimized}
      onDirtyChange={(dirty) => setDirty(panel.id, dirty)}
      onOpenVoucher={(id) => openVoucherPanel(id)}
      onDone={() => {
        // Бүтэн reload биш — зөвхөн серверийн өгөгдлийг сэргээнэ.
        closePanel(panel.id);
        router.refresh();
      }}
      // Болих/Хаах — юу ч хадгалаагүй тул dirty-баталгаажуулалтаар дайрна.
      onCancel={requestClose}
    />
  );
}
