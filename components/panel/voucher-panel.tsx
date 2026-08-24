"use client";

// Панель доторх журналын засварлагч/харагч. Standalone цонхтой ЯГ ижил
// component-ийг (JournalEntryForm) embedded горимоор ашиглана — өгөгдлөө
// server action-аар өөрөө татна.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { JournalEntryForm } from "@/components/gl/journal-entry-form";
import { buildSegCode } from "@/lib/grid/segments";
import type { NewVoucherPrefill } from "@/lib/store/panel-store";
import {
  getJournalEditorData,
  type JournalEditorData,
} from "@/lib/actions/journal-editor";
import {
  openVoucherPanel,
  refreshOpenPanels,
  usePanelStore,
  type PanelInstance,
} from "@/lib/store/panel-store";
import { PanelError, PanelLoading } from "@/components/panel/panel-states";

const STATUS_TITLES: Record<string, string> = {
  draft: "Ноорог",
  posted: "Бичигдсэн",
  reversed: "Буцаагдсан",
};

const ERROR_MESSAGES = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  "not-found": "Журнал олдсонгүй. Устгагдсан байж болзошгүй.",
  failed: "Ачаалж чадсангүй. Дахин оролдоно уу.",
} as const;

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
  const refreshToken = panel.refreshToken;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: JournalEditorData; loadedToken: number }
  >({ status: "loading" });

  // Эхний ачаалалт + СЭРГЭЭХ/ДАХИН НЭЭХ бүрд дахин татна (store refreshToken-ийг
  // өсгөдөг) — панель хураастай байх зуур журнал өөр газраас өөрчлөгдсөн байж
  // болно. Хадгалаагүй өөрчлөлттэй үед хэрэглэгчийн бичсэнийг дарж болохгүй
  // тул алгасна.
  useEffect(() => {
    const current = usePanelStore
      .getState()
      .panels.find((entry) => entry.id === panel.id);
    if (current?.dirty) return;

    let cancelled = false;
    getJournalEditorData(voucherId)
      .then((result) => {
        if (cancelled) return;
        // Fetch явж байх зуур хэрэглэгч засаж эхэлсэн бол хариуг хаяна —
        // key remount бичсэнийг нь арчих байсан.
        const now = usePanelStore
          .getState()
          .panels.find((entry) => entry.id === panel.id);
        if (now?.dirty) return;
        if (!result.ok) {
          setState({ status: "error", message: ERROR_MESSAGES[result.code] });
          return;
        }
        setState({
          status: "ready",
          data: result.data,
          loadedToken: refreshToken,
        });
        if (result.data.voucher) {
          const label =
            STATUS_TITLES[result.data.voucher.status] ??
            result.data.voucher.status;
          setTitle(
            panel.id,
            `${result.data.voucher.description || "Журнал"} · ${label}`
          );
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error", message: ERROR_MESSAGES.failed });
      });
    return () => {
      cancelled = true;
    };
  }, [voucherId, refreshToken, panel.id, setTitle]);

  if (state.status === "loading")
    return (
      <PanelLoading />
    );

  if (state.status === "error")
    return (
      <PanelError message={state.message} />
    );

  const { data } = state;

  // Шинэ журналын урьдчилан бөглөлт (татварын суутган тооцоо г.м.) —
  // 8 оронтой үндсэн дансыг идэвхтэй сегментүүдтэй бүтэн код болгоно.
  const prefill = panel.payload.prefill as NewVoucherPrefill | undefined;
  const toFullCode = (account: string) => {
    const trimmed = account.trim();
    if (!/^\d{8}$/.test(trimmed)) return trimmed;
    return buildSegCode(
      { ...data.defaultSegments, 3: trimmed },
      data.activeSegIds,
      data.defaultSegments
    );
  };
  const prefillVoucher =
    !data.voucher && prefill
      ? {
          date: prefill.date,
          description: prefill.description ?? "",
          lines: (prefill.lines ?? []).map((line) => ({
            account: line.account ? toFullCode(line.account) : "",
            debit: line.debit,
            credit: line.credit,
            description: line.description ?? prefill.description ?? "",
          })),
        }
      : undefined;

  return (
    <JournalEntryForm
      // Шинэ өгөгдөл татагдмагц формыг цэвэрхэн remount хийнэ — доторх
      // draft state найдвартай шинэчлэгдэнэ.
      key={state.loadedToken}
      embedded
      accounts={data.accounts}
      activeSegIds={data.activeSegIds}
      segmentValues={data.segmentValues}
      defaultSegments={data.defaultSegments}
      voucherId={data.voucher?.id}
      voucherStatus={data.voucher?.status}
      voucherCreatedAt={data.voucher?.createdAt}
      reversalOfVoucherId={data.voucher?.reversalOfVoucherId}
      reversedByVoucherId={data.voucher?.reversedByVoucherId}
      readOnly={data.readOnly}
      initialVoucher={
        data.voucher
          ? {
              date: data.voucher.date,
              description: data.voucher.description,
              lines: data.voucher.lines,
            }
          : prefillVoucher
      }
      // Ctrl+Enter — зөвхөн фокустай, хураагдаагүй панельд. Эс бөгөөс
      // нээлттэй бүх панель зэрэг хадгалчихна.
      shortcutsEnabled={activeId === panel.id && !panel.minimized}
      onDirtyChange={(dirty) => setDirty(panel.id, dirty)}
      onOpenVoucher={(id) => openVoucherPanel(id)}
      onDone={() => {
        // Бүтэн reload биш — зөвхөн серверийн өгөгдлийг сэргээнэ. Журналд
        // тулгуурласан бусад нээлттэй панель (касс/өртгийн дэлгэрэнгүй,
        // задаргаа) мөн шинэ өгөгдлөө татна.
        closePanel(panel.id);
        refreshOpenPanels();
        router.refresh();
      }}
      // Болих/Хаах — юу ч хадгалаагүй тул dirty-баталгаажуулалтаар дайрна.
      onCancel={requestClose}
    />
  );
}
