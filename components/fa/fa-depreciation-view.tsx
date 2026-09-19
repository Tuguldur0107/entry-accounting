"use client";

// Элэгдлийн хуудас — ТАЙЛАНТ ҮЕИЙН (topbar-ийн периодын сонголт) элэгдэл.
//
// Урсгал: «Элэгдэл бодох» → мөрүүд ноорогоор гарна → «GL-д батлах» НЭГ
// товчоор БҮХ мөр НЭГ журнал болж бичигдэнэ. Дахин бодоход өмнөх журнал
// автоматаар буцаагдаад шинээр бодогддог тул ДАВХАРДАХГҮЙ.
//
// Татварын элэгдэл (cit.md-ийн хуулийн хувь) нь МЭМО — GL-д бичигдэхгүй,
// зөвхөн ААНОАТ-ын тайлан ба IAS 12 хойшлогдсон татварын зөрүүд хэрэгтэй.

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColDef } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  postDepreciationMonth,
  runDepreciation,
  setFaDepreciationBasis,
} from "@/lib/actions/fa";
import { col } from "@/lib/grid/columnTypes";
import { fmtMnt } from "@/lib/reports/balances";
import { fmtPeriodCode } from "@/lib/periods/period";
import type { DepreciationBasis } from "@/lib/fa/depreciation";

export type DepreciationEntryView = {
  id: string;
  assetCode: string;
  assetName: string;
  periodMonth: string;
  /** Dr — элэгдлийн зардлын данс. */
  debitAccount: string;
  /** Cr — хуримтлагдсан элэгдлийн данс. */
  creditAccount: string;
  /** Анхны үнэлгээ (өртөг). */
  cost: number;
  /** Хуримтлагдсан элэгдэл (энэ сарыг оролцуулж). */
  accumulated: number;
  /** Үлдэх өртөг = анхны үнэлгээ − хуримтлагдсан. */
  netBookValue: number;
  /** Тухайн сарын САНХҮҮГИЙН элэгдэл (GL-д бичигдэнэ). */
  amount: number;
  /** Тухайн сарын ТАТВАРЫН элэгдэл (мэмо). */
  taxAmount: number;
  taxAccumulated: number;
  depreciatedDays: number;
  status: string;
  /** Элэгдэл бодуулсан хэрэглэгч. */
  runBy: string;
};

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "muted"> = {
  draft: "muted",
  posted: "success",
  reversed: "danger",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  reversed: "Буцаагдсан",
};

interface Props {
  entries: DepreciationEntryView[];
  month: string;
  basis: DepreciationBasis;
  /** Идэвхтэй хөрөнгийн карт байхгүй бол бодолт хийх боломжгүй. */
  activeAssetCount: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Алдаа гарлаа";
}

export function FaDepreciationView({
  entries,
  month,
  basis,
  activeAssetCount,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const active = useMemo(
    () => entries.filter((entry) => entry.status !== "reversed"),
    [entries]
  );
  const draftCount = active.filter((entry) => entry.status === "draft").length;
  const postedCount = active.filter((entry) => entry.status === "posted").length;

  const totals = useMemo(
    () =>
      active.reduce(
        (sum, entry) => ({
          cost: sum.cost + entry.cost,
          accumulated: sum.accumulated + entry.accumulated,
          netBookValue: sum.netBookValue + entry.netBookValue,
          amount: sum.amount + entry.amount,
          taxAmount: sum.taxAmount + entry.taxAmount,
        }),
        { cost: 0, accumulated: 0, netBookValue: 0, amount: 0, taxAmount: 0 }
      ),
    [active]
  );

  const pinnedBottomRowData = useMemo<DepreciationEntryView[]>(
    () => [
      {
        id: "__totals__",
        assetCode: "",
        assetName: "Нийт",
        periodMonth: month,
        debitAccount: "",
        creditAccount: "",
        taxAccumulated: 0,
        depreciatedDays: 0,
        status: "",
        runBy: "",
        ...totals,
      },
    ],
    [totals, month]
  );

  function changeBasis(next: DepreciationBasis) {
    startTransition(async () => {
      try {
        const result = await setFaDepreciationBasis(next);
        if (result.error !== undefined) {
          toast.error(result.error);
          return;
        }
        toast.success(
          next === "daily"
            ? "Элэгдлийн суурь ӨДРӨӨР боллоо — дахин бодолт хийнэ үү"
            : "Элэгдлийн суурь САРААР боллоо — дахин бодолт хийнэ үү"
        );
        router.refresh();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  function calculate() {
    startTransition(async () => {
      try {
        const result = await runDepreciation({ month });
        if (result.error !== undefined) {
          toast.error(result.error);
          return;
        }
        if (result.reversed > 0) {
          toast.success(
            `${fmtPeriodCode(month)} дахин бодогдлоо — өмнөх ${result.reversed} журнал буцаагдаж, ${result.created} мөр шинээр бодогдов`
          );
        } else if (result.created === 0) {
          toast.info(
            "Энэ сард элэгдүүлэх хөрөнгө алга — бүрэн элэгдсэн эсвэл элэгдэл эхлэх сар нь хожим байна"
          );
        } else {
          toast.success(`${result.created} хөрөнгийн элэгдэл бодогдлоо`);
        }
        router.refresh();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  async function postToGl() {
    const ok = await confirm({
      title: "GL-д батлах",
      description: `${fmtPeriodCode(month)} сарын ${draftCount} мөрийн элэгдлийг НЭГ журналаар GL-д бичих үү? Нийт ${fmtMnt(totals.amount)}`,
      confirmText: "Батлах",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const result = await postDepreciationMonth(month);
        if (result.error !== undefined) {
          toast.error(result.error);
          return;
        }
        toast.success(
          `${result.posted} хөрөнгийн элэгдэл нэг журналаар батлагдлаа — ${fmtMnt(result.amount)}`
        );
        router.refresh();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  const columns = useMemo<ColDef<DepreciationEntryView>[]>(
    () => [
      col<DepreciationEntryView>({
        eaType: "readonly-text",
        headerName: "Код",
        field: "assetCode",
        width: 150,
        cellClass: "font-mono text-xs",
      }),
      col<DepreciationEntryView>({
        eaType: "readonly-text",
        headerName: "Хөрөнгө",
        field: "assetName",
        minWidth: 180,
        flex: 1,
        cellClassRules: {
          "font-semibold": (params) => !!params.node.rowPinned,
        },
      }),
      col<DepreciationEntryView>({
        eaType: "readonly-text",
        headerName: "Dr — Элэгдлийн зардал",
        field: "debitAccount",
        width: 180,
        cellClass: "font-mono text-xs",
      }),
      col<DepreciationEntryView>({
        eaType: "readonly-text",
        headerName: "Cr — Хуримт. элэгдэл",
        field: "creditAccount",
        width: 180,
        cellClass: "font-mono text-xs",
      }),
      col<DepreciationEntryView>({
        eaType: "readonly-money",
        headerName: "Анхны үнэлгээ",
        field: "cost",
        width: 150,
      }),
      col<DepreciationEntryView>({
        eaType: "readonly-money",
        headerName: "Хуримтлагдсан элэгдэл",
        field: "accumulated",
        width: 190,
      }),
      col<DepreciationEntryView>({
        eaType: "readonly-money",
        headerName: "Үлдэх өртөг",
        field: "netBookValue",
        width: 150,
      }),
      ...(basis === "daily"
        ? [
            col<DepreciationEntryView>({
              eaType: "number-hours",
              headerName: "Элэгдсэн хоног",
              field: "depreciatedDays",
              width: 150,
              editable: false,
            }),
          ]
        : []),
      col<DepreciationEntryView>({
        eaType: "readonly-money",
        headerName: "Сарын элэгдэл",
        field: "amount",
        width: 160,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
      }),
      col<DepreciationEntryView>({
        eaType: "readonly-money",
        headerName: "Татварын элэгдэл",
        field: "taxAmount",
        width: 170,
        cellClass: "ag-right-aligned-cell font-mono text-[var(--ea-text-3)]",
        headerTooltip:
          "ААНОАТ-ын зорилгоор — GL-д БИЧИГДЭХГҮЙ (IAS 12 хойшлогдсон татварын суурь)",
      }),
      col<DepreciationEntryView>({
        eaType: "readonly-text",
        headerName: "Бодуулсан",
        field: "runBy",
        width: 150,
        cellClass: "text-xs text-[var(--ea-text-3)]",
      }),
      {
        headerName: "Төлөв",
        field: "status",
        width: 130,
        cellRenderer: (params: { value?: string; node: { rowPinned?: string | null } }) =>
          params.node.rowPinned || !params.value ? null : (
            <StatusBadge tone={STATUS_TONE[params.value] ?? "neutral"}>
              {STATUS_LABELS[params.value] ?? params.value}
            </StatusBadge>
          ),
      },
    ],
    [basis]
  );

  const taxGap = Math.round((totals.amount - totals.taxAmount) * 100) / 100;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Үндсэн хөрөнгийн элэгдэл — {fmtPeriodCode(month)}
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Элэгдлийн суурь:{" "}
            <span className="font-medium text-[var(--ea-text-1)]">
              {basis === "daily" ? "өдрөөр" : "сараар"}
            </span>{" "}
            · Сарыг дээд талын{" "}
            <span className="font-medium text-[var(--ea-text-1)]">
              тайлант үеийн шүүлтүүрээр
            </span>{" "}
            солино · Татварын элэгдэл нь мэмо (GL-д бичигдэхгүй)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Элэгдлийн суурь нь БҮХ хөрөнгөд үйлчилдэг байгууллагын бодлого. */}
          <label className="flex items-center gap-1.5 text-xs text-[var(--ea-text-2)]">
            Суурь
            <select
              value={basis}
              onChange={(event) =>
                changeBasis(event.target.value as DepreciationBasis)
              }
              disabled={isPending || postedCount > 0}
              title={
                postedCount > 0
                  ? "Энэ сард батлагдсан элэгдэл байна — суурийг солихын тулд эхлээд дахин бодолт хийж буцаана"
                  : "Бүх хөрөнгөд үйлчилнэ"
              }
              className="h-7 rounded border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 text-xs text-[var(--ea-text-1)] disabled:opacity-50"
            >
              <option value="monthly">Сараар</option>
              <option value="daily">Өдрөөр</option>
            </select>
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={calculate}
            disabled={isPending || activeAssetCount === 0}
            title={
              activeAssetCount === 0
                ? "Идэвхтэй хөрөнгийн карт алга"
                : undefined
            }
          >
            <Icon name="costing" size="sm" />
            Элэгдэл бодох
          </Button>
          <Button size="sm" onClick={postToGl} disabled={isPending || draftCount === 0}>
            <Icon name="journal" size="sm" />
            GL-д батлах ({draftCount})
          </Button>
        </div>
      </div>

      {postedCount > 0 && draftCount === 0 && (
        <p className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-3 py-2 text-xs text-[var(--ea-text-3)]">
          Энэ сарын элэгдэл GL-д батлагдсан. Дахин «Элэгдэл бодох» дарвал өмнөх
          журнал АВТОМАТААР буцаагдаж, шинэ ноорог үүснэ — давхар бичилт
          үүсэхгүй.{" "}
          <Link
            href="/gl/journal"
            className="font-medium text-[var(--ea-primary)] underline"
          >
            GL журналаас харах
          </Link>
        </p>
      )}

      {entries.length === 0 ? (
        <div className="flex min-h-56 flex-1 flex-col items-center justify-center gap-2 rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          {activeAssetCount === 0 ? (
            <>
              <p className="text-[var(--ea-text-3)]">
                Идэвхтэй үндсэн хөрөнгө алга — элэгдэл бодох зүйл байхгүй.
              </p>
              <p className="text-xs">
                <Link
                  href="/fa/assets"
                  className="font-medium text-[var(--ea-primary)] underline"
                >
                  Хөрөнгийн карт
                </Link>{" "}
                хэсэгт карт үүсгээд идэвхжүүлнэ үү.
              </p>
            </>
          ) : (
            <p>
              {fmtPeriodCode(month)} сард элэгдэл бодогдоогүй байна — «Элэгдэл
              бодох» товчоор эхэлнэ.
            </p>
          )}
        </div>
      ) : (
        <DataGridDynamic<DepreciationEntryView>
          rowData={entries}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          pinnedBottomRowData={pinnedBottomRowData}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
        />
      )}

      {active.length > 0 && (
        <p className="text-xs text-[var(--ea-text-3)]">
          {active.length} хөрөнгө · Сарын элэгдэл{" "}
          <span className="font-mono font-medium text-[var(--ea-text-1)]">
            {fmtMnt(totals.amount)}
          </span>{" "}
          · Татварын элэгдэл{" "}
          <span className="font-mono font-medium text-[var(--ea-text-1)]">
            {fmtMnt(totals.taxAmount)}
          </span>
          {taxGap !== 0 && (
            <>
              {" "}
              · Зөрүү{" "}
              <span className="font-mono font-medium text-[var(--ea-warning-fg)]">
                {fmtMnt(taxGap)}
              </span>{" "}
              (IAS 12 хойшлогдсон татварын суурь)
            </>
          )}
        </p>
      )}

      {confirmDialog}
    </section>
  );
}
