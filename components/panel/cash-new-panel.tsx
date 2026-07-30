"use client";

// Шинэ мөнгөн гүйлгээ / АР-АП төлөлт бичих панель. Payload:
// { arApDocumentId?: string } — өгвөл тухайн АР/АП баримтын төлөлт болгож
// урьдчилан бөглөнө. Сонголтын өгөгдлөө (данс, GL данс, урсгал, нээлттэй
// АР/АП баримт, сегмент) server action-аар татна; dirty төлвөө store-д
// мэдэгдэж, амжилттай хадгалахад панелаа хааж серверийн өгөгдлийг сэргээнэ.

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";

import { CashNewForm } from "@/components/cash/cash-new-form";
import {
  getCashNewPanelData,
} from "@/lib/actions/cash";
import type { CashTransactionOptions } from "@/lib/cash/load-options";
import {
  refreshOpenPanels,
  usePanelStore,
  type PanelInstance,
} from "@/lib/store/panel-store";

const ERROR_MESSAGES = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  failed: "Ачаалж чадсангүй. Дахин оролдоно уу.",
} as const;

export function CashNewPanel({
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

  const arApDocumentId = panel.payload.arApDocumentId as string | undefined;
  const refreshToken = panel.refreshToken;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: CashTransactionOptions; loadedToken: number }
  >({ status: "loading" });

  // Эхний ачаалалт + СЭРГЭЭХ/ДАХИН НЭЭХ бүрд дахин татна (store refreshToken-ийг
  // өсгөдөг) — данс, нээлттэй нэхэмжлэл хураастай байх зуур өөрчлөгдсөн байж
  // болно. Хадгалаагүй өөрчлөлттэй үед бөглөсөн формыг дарж болохгүй тул алгасна.
  useEffect(() => {
    const current = usePanelStore
      .getState()
      .panels.find((entry) => entry.id === panel.id);
    if (current?.dirty) return;

    let cancelled = false;
    getCashNewPanelData()
      .then((result) => {
        if (cancelled) return;
        // Fetch явж байх зуур хэрэглэгч бөглөж эхэлсэн бол хариуг хаяна —
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
        if (arApDocumentId) {
          const target = result.data.arApOpenDocuments.find(
            (doc) => doc.id === arApDocumentId
          );
          if (target)
            setTitle(panel.id, `${target.documentNo} · Төлөлт`);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error", message: ERROR_MESSAGES.failed });
      });
    return () => {
      cancelled = true;
    };
  }, [arApDocumentId, refreshToken, panel.id, setTitle]);

  if (state.status === "loading")
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center gap-2 text-sm text-[var(--ea-text-3)]">
        <Icon name="loading" className="animate-spin" />
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
  const settlementTarget = arApDocumentId
    ? data.arApOpenDocuments.find((doc) => doc.id === arApDocumentId) ?? null
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {arApDocumentId && !settlementTarget && (
        <p className="mx-4 mt-3 rounded-md border border-[var(--ea-warning)] bg-[var(--ea-bg-2)] px-3 py-2 text-xs text-[var(--ea-warning-fg)]">
          Холбогдох нэхэмжлэх төлөгдсөн эсвэл олдсонгүй — энгийн гүйлгээ
          бичих боломжтой.
        </p>
      )}
      <CashNewForm
        // Шинэ өгөгдөл татагдмагц формыг цэвэрхэн remount хийнэ — доторх
        // draft state найдвартай шинэчлэгдэнэ.
        key={state.loadedToken}
        accounts={data.accounts}
        glAccounts={data.glAccounts}
        cashFlowOptions={data.cashFlowOptions}
        activeSegIds={data.activeSegIds}
        segmentOptions={data.segmentOptions}
        defaultSegments={data.defaultSegments}
        arApOpenDocuments={data.arApOpenDocuments}
        initialSettlement={settlementTarget}
        onDirtyChange={(dirty) => setDirty(panel.id, dirty)}
        onSaved={() => {
          // Бүтэн reload биш — зөвхөн серверийн өгөгдлийг сэргээнэ.
          // Нээлттэй бусад панель (жишээ нь төлсөн нэхэмжлэлийн панель)
          // мөн шинэ үлдэгдлээ татна.
          closePanel(panel.id);
          refreshOpenPanels();
          router.refresh();
        }}
        // Болих/Хаах — юу ч хадгалаагүй тул dirty-баталгаажуулалтаар дайрна.
        onCancel={requestClose}
      />
    </div>
  );
}
