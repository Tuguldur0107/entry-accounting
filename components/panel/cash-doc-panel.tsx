"use client";

// Мөнгөн гүйлгээний баримтын дэлгэрэнгүй панель (урьд нь read-only Dialog
// байсан). Payload: { documentId: string } — өгөгдлөө server action-аар
// өөрөө татна, panel.refreshToken өөрчлөгдөх бүрд дахин татна. Баримтын
// толгой + холбоотой GL журналын Dr/Cr мөрүүд + буцаалтын журнал. "Журнал
// нээх" нь журналыг ЗЭРЭГЦЭЭ панельд нээнэ — баримт, журнал хоёр хамт харагдана.

import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { VoucherLinesTable } from "@/components/gl/voucher-lines-table";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  getCashDocPanelData,
  type CashDocPanelData,
} from "@/lib/actions/cash";
import { fmtMnt } from "@/lib/reports/balances";
import {
  openVoucherPanel,
  usePanelStore,
  type PanelInstance,
} from "@/lib/store/panel-store";

const TYPE_LABELS: Record<string, string> = {
  receipt: "Орлого",
  payment: "Зарлага",
  transfer: "Шилжүүлэг",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  reversed: "Буцаагдсан",
};
const STATUS_TONES: Record<string, StatusTone> = {
  draft: "warning",
  posted: "success",
  reversed: "muted",
};

const ERROR_MESSAGES = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  "not-found": "Баримт олдсонгүй. Устгагдсан байж болзошгүй.",
  failed: "Ачаалж чадсангүй. Дахин оролдоно уу.",
} as const;

export function CashDocPanel({ panel }: { panel: PanelInstance }) {
  const setTitle = usePanelStore((state) => state.setTitle);

  const documentId = panel.payload.documentId as string | undefined;
  const refreshToken = panel.refreshToken;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: CashDocPanelData }
  >({ status: "loading" });

  // Эхний ачаалалт + СЭРГЭЭХ/ДАХИН НЭЭХ бүрд дахин татна (store refreshToken-ийг
  // өсгөдөг) — панель хураастай байх зуур баримт батлагдсан/буцаагдсан байж
  // болно. Read-only панель тул dirty ерөөсөө үүсэхгүй ч хамгаалалтыг
  // voucher-panel-тай ижил байлгана.
  useEffect(() => {
    if (!documentId) return;
    const current = usePanelStore
      .getState()
      .panels.find((entry) => entry.id === panel.id);
    if (current?.dirty) return;

    let cancelled = false;
    getCashDocPanelData(documentId)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setState({ status: "error", message: ERROR_MESSAGES[result.code] });
          return;
        }
        setState({ status: "ready", data: result.data });
        const { document } = result.data;
        setTitle(
          panel.id,
          `${document.documentNo} · ${
            TYPE_LABELS[document.documentType] ?? document.documentType
          }`
        );
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error", message: ERROR_MESSAGES.failed });
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, refreshToken, panel.id, setTitle]);

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

  const { document, detail, activeSegIds, glNames } = state.data;
  const glName = (code: string | null) => (code ? glNames[code] ?? "" : "");

  const cashAccountLabel =
    document.documentType === "transfer"
      ? `${document.fromAccountName ?? ""} → ${document.toAccountName ?? ""}`
      : document.documentType === "receipt"
        ? document.toAccountName ?? ""
        : document.fromAccountName ?? "";

  // Валюттай баримт валютын дүн + MNT сууриа хамт үзүүлнэ; GL-ээс үүссэн
  // ханшгүй ноорогт зөвхөн MNT дүн нь бодит.
  const amountLabel =
    document.currency === "MNT"
      ? fmtMnt(document.amount)
      : document.exchangeRate > 0 && document.amount > 0
        ? `${document.amount.toLocaleString("en-US")} ${document.currency} · ${fmtMnt(document.baseAmount)}`
        : `${fmtMnt(document.baseAmount)} · ${document.currency} ханш тодорхойгүй`;

  // Үзүүлэх журнал: батлагдсан/холбогдсон воучер, үгүй бол ноорог үүссэн
  // эх воучер (тэр бичилт GL-д аль хэдийн бий — нягтланч батлахын өмнө
  // яг үүнийг шалгана).
  const journalId = detail.voucherId ?? detail.sourceVoucherId;
  const showsSourceVoucher = !detail.voucherId && !!detail.sourceVoucherId;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
            <span className="mr-2 font-mono text-xs font-normal text-[var(--ea-text-3)]">
              {document.documentNo}
            </span>
            {TYPE_LABELS[document.documentType] ?? document.documentType}
          </h2>
          <StatusBadge tone={STATUS_TONES[document.status] ?? "muted"}>
            {STATUS_LABELS[document.status] ?? document.status}
          </StatusBadge>
        </div>

        {/* Толгойн талбарууд */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
          <Row label="Огноо" value={document.date} mono />
          <Row label="Мөнгөн хөрөнгийн данс" value={cashAccountLabel} />
          <Row label="Дүн" value={amountLabel} mono strong />
          {document.documentType !== "transfer" && (
            <Row
              label="Харилцагч / GL данс"
              value={[
                document.counterparty,
                document.counterAccountNumber
                  ? `${document.counterAccountNumber} ${glName(document.counterAccountNumber)}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          )}
          {document.cashFlowCode && (
            <Row label="Мөнгөн урсгал (S8)" value={document.cashFlowCode} mono />
          )}
          <Row label="Утга" value={document.description || "—"} span2 />
        </dl>

        {/* Холбоотой GL журнал — GL-ээс үүссэн ноорогт энэ нь эх воучер. */}
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--ea-text-2)]">
              {showsSourceVoucher ? "Эх GL журнал" : "GL журнал"}
              {detail.voucherDate && (
                <span className="ml-2 font-mono font-normal text-[var(--ea-text-4)]">
                  {detail.voucherDate}
                </span>
              )}
            </span>
            {journalId && (
              <button
                type="button"
                onClick={() =>
                  openVoucherPanel(
                    journalId,
                    detail.voucherDescription || "Журнал"
                  )
                }
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ea-primary)] hover:underline"
              >
                Журнал нээх
                <ExternalLink size={12} />
              </button>
            )}
          </div>
          {detail.lines.length > 0 ? (
            <>
              <VoucherLinesTable
                lines={detail.lines}
                activeSegIds={activeSegIds}
                glName={(code) => glName(code)}
              />
              {showsSourceVoucher && (
                <p className="mt-1.5 text-[11px] text-[var(--ea-text-4)]">
                  Энэ бичилт GL-д аль хэдийн батлагдсан. Баримтыг батлахад
                  шинэ журнал үүсэхгүй — энэ журналыг холбоно.
                </p>
              )}
            </>
          ) : (
            <div className="rounded-md border border-[var(--ea-border)] py-6 text-center text-xs text-[var(--ea-text-4)]">
              {document.status === "draft"
                ? "Ноорог — батлагдаагүй тул GL журнал үүсээгүй"
                : "GL журнал олдсонгүй"}
            </div>
          )}
        </div>

        {/* Буцаалтын журнал */}
        {detail.reversalLines.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-semibold text-[var(--ea-warning-fg)]">
              Буцаалтын журнал
            </div>
            <VoucherLinesTable
              lines={detail.reversalLines}
              activeSegIds={activeSegIds}
              glName={(code) => glName(code)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  strong,
  span2,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "col-span-2" : undefined}>
      <dt className="text-[var(--ea-text-4)]">{label}</dt>
      <dd
        className={[
          "mt-0.5 text-[var(--ea-text-1)]",
          mono ? "font-mono" : "",
          strong ? "font-semibold" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}
