"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CellClickedEvent, ColDef, ICellRendererParams } from "ag-grid-community";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AccountInput } from "@/components/account/account-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { buildSegCode } from "@/lib/grid/segments";
import { extractMainAccount } from "@/lib/reports/balances";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  activateFixedAsset,
  createFixedAsset,
  deleteFixedAsset,
} from "@/lib/actions/fa";
import {
  DEPRECIATION_METHODS,
  depreciationMethodLabel,
  monthlyDepreciation,
} from "@/lib/fa/depreciation";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

export type FaDepreciationEntryRow = {
  id: string;
  periodMonth: string;
  amount: number;
  status: string;
};

export type FixedAssetView = {
  id: string;
  code: string;
  name: string;
  acquisitionDate: string;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  depreciationMethod: string;
  custodian: string | null;
  depreciationStartMonth: string | null;
  assetAccountNumber: string;
  accumDepAccountNumber: string;
  depExpenseAccountNumber: string;
  status: string;
  accumulated: number;
  netBookValue: number;
  entries: FaDepreciationEntryRow[];
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  active: "Идэвхтэй",
  disposed: "Хасагдсан",
};

const ENTRY_STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  reversed: "Сторно",
};

const emptyForm = () => ({
  code: "",
  name: "",
  acquisitionDate: new Date().toISOString().slice(0, 10),
  cost: "",
  salvageValue: "0",
  usefulLifeMonths: "36",
  depreciationMethod: "straight_line",
  custodian: "",
  depreciationStartMonth: new Date().toISOString().slice(0, 7),
  assetAccountNumber: "21010000",
  accumDepAccountNumber: "21000099",
  depExpenseAccountNumber: "70000001",
});

interface Props {
  assets: FixedAssetView[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
}

// Хөрөнгийн карт: гараар үүсгэх эсвэл АП/касс/GL-ээс автоматаар ирсэн
// НООРОГ картыг бөглөж идэвхжүүлнэ. Идэвхжүүлэлт GL бичихгүй — өртөг эх
// сувагтаа данслагдсан; элэгдэл нь Элэгдэл хуудаснаас run-аар бичигдэнэ.
export function FaAssetsView({
  assets,
  activeSegIds,
  segmentOptions,
  defaultSegments,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  // Дэлгэрэнгүйг id-аар нь хайж авдаг тул refresh-ийн дараа ч шинэ утгууд
  // (хуримтлагдсан, бичилтүүд) dialog-т шууд тусна.
  const detail = useMemo(
    () => assets.find((asset) => asset.id === detailId) ?? null,
    [assets, detailId]
  );

  function openActivateDialog(asset: FixedAssetView) {
    setForm({
      code: asset.code,
      name: asset.name,
      acquisitionDate: asset.acquisitionDate,
      cost: String(asset.cost),
      salvageValue: String(asset.salvageValue),
      usefulLifeMonths: String(asset.usefulLifeMonths || 36),
      depreciationMethod: asset.depreciationMethod || "straight_line",
      custodian: asset.custodian ?? "",
      depreciationStartMonth:
        asset.depreciationStartMonth ?? asset.acquisitionDate.slice(0, 7),
      assetAccountNumber: buildSegCode(
        { ...defaultSegments, 3: asset.assetAccountNumber },
        activeSegIds,
        defaultSegments
      ),
      accumDepAccountNumber: buildSegCode(
        { ...defaultSegments, 3: asset.accumDepAccountNumber },
        activeSegIds,
        defaultSegments
      ),
      depExpenseAccountNumber: buildSegCode(
        { ...defaultSegments, 3: asset.depExpenseAccountNumber },
        activeSegIds,
        defaultSegments
      ),
    });
    setError("");
    setActivatingId(asset.id);
    setDetailId(null);
    setOpen(true);
  }

  const columns = useMemo<ColDef<FixedAssetView>[]>(
    () => [
      { headerName: "Код", field: "code", width: 170, cellClass: "font-mono text-xs" },
      { headerName: "Нэр", field: "name", minWidth: 180, flex: 1 },
      {
        headerName: "Эзэмшигч",
        field: "custodian",
        width: 130,
        cellClass: "text-xs",
        valueFormatter: (params) => String(params.value ?? "—"),
      },
      {
        headerName: "Арга",
        field: "depreciationMethod",
        width: 150,
        valueGetter: (params) =>
          depreciationMethodLabel(params.data?.depreciationMethod ?? ""),
        cellClass: "text-xs",
      },
      {
        headerName: "Өртөг",
        field: "cost",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Хуримт. элэгдэл",
        field: "accumulated",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Үлдэгдэл өртөг",
        field: "netBookValue",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Хугацаа",
        field: "usefulLifeMonths",
        width: 96,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          Number(params.value) > 0 ? `${params.value} сар` : "—",
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 108,
        valueGetter: (params) => STATUS_LABELS[params.data?.status ?? ""] ?? "",
        cellRenderer: (params: ICellRendererParams<FixedAssetView>) => {
          const status = params.data?.status ?? "";
          return (
            <div className="flex h-full items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    status === "active"
                      ? "var(--ea-success)"
                      : status === "draft"
                        ? "var(--ea-warning)"
                        : "var(--ea-text-4)",
                }}
              />
              <span className="text-xs">{STATUS_LABELS[status] ?? status}</span>
            </div>
          );
        },
      },
      {
        headerName: "Үйлдэл",
        colId: "actions",
        width: 100,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-end",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (params: ICellRendererParams<FixedAssetView>) => {
          const asset = params.data;
          if (!asset || asset.status !== "draft") return null;
          return (
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                className="ea-btn ea-btn--icon ea-btn--success"
                title="Бөглөж идэвхжүүлэх"
                aria-label="Бөглөж идэвхжүүлэх"
                onClick={() => openActivateDialog(asset)}
              >
                <Pencil />
              </button>
              <button
                type="button"
                className="ea-btn ea-btn--icon ea-btn--danger"
                title="Ноорог устгах"
                aria-label="Ноорог устгах"
                onClick={async () => {
                  const ok = await confirm({
                    title: "Ноорог карт устгах",
                    description: `${asset.code} — ${asset.name} картыг устгах уу?`,
                    confirmText: "Устгах",
                    danger: true,
                  });
                  if (!ok) return;
                  startTransition(async () => {
                    try {
                      await deleteFixedAsset(asset.id);
                      router.refresh();
                      toast.success("Ноорог карт устгагдлаа");
                    } catch (caught) {
                      toast.error(
                        caught instanceof Error ? caught.message : "Устгаж чадсангүй"
                      );
                    }
                  });
                }}
              >
                <Trash2 />
              </button>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirm, router, activeSegIds, defaultSegments]
  );

  const entryColumns = useMemo<ColDef<FaDepreciationEntryRow>[]>(
    () => [
      {
        headerName: "Сар",
        field: "periodMonth",
        width: 110,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Дүн",
        field: "amount",
        flex: 1,
        minWidth: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 120,
        valueGetter: (params) =>
          ENTRY_STATUS_LABELS[params.data?.status ?? ""] ?? "",
        cellClass: "text-xs",
      },
    ],
    []
  );

  // Мөр дээр дарахад дэлгэрэнгүй нээнэ — үйлдлийн баганад дарсныг алгасна.
  function handleCellClicked(event: CellClickedEvent<FixedAssetView>) {
    if (event.colDef.colId === "actions") return;
    if (event.data) setDetailId(event.data.id);
  }

  function save() {
    setError("");
    startTransition(async () => {
      try {
        const payload = {
          code: form.code || undefined,
          name: form.name,
          acquisitionDate: form.acquisitionDate,
          cost: Number(form.cost.replaceAll(",", "")),
          salvageValue: Number(form.salvageValue.replaceAll(",", "")) || 0,
          usefulLifeMonths: Number(form.usefulLifeMonths),
          depreciationMethod: form.depreciationMethod,
          custodian: form.custodian,
          depreciationStartMonth: form.depreciationStartMonth,
          // AccountInput бүтэн код буцаана — картад main дансыг хадгална.
          assetAccountNumber: extractMainAccount(form.assetAccountNumber),
          accumDepAccountNumber: extractMainAccount(form.accumDepAccountNumber),
          depExpenseAccountNumber: extractMainAccount(form.depExpenseAccountNumber),
        };
        if (activatingId) await activateFixedAsset(activatingId, payload);
        else await createFixedAsset(payload);
        setOpen(false);
        setActivatingId(null);
        router.refresh();
        toast.success(
          activatingId ? "Карт идэвхжлээ — элэгдэлд хамрагдана" : "Хөрөнгө бүртгэгдлээ"
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Хадгалж чадсангүй");
      }
    });
  }

  const draftCount = assets.filter((asset) => asset.status === "draft").length;

  const depreciableBase = detail
    ? Math.round((detail.cost - detail.salvageValue) * 100) / 100
    : 0;
  const progressPercent =
    detail && depreciableBase > 0
      ? Math.min(100, Math.round((detail.accumulated / depreciableBase) * 100))
      : 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Хөрөнгийн карт
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Мөр дээр дарж дэлгэрэнгүй харна · АП/касс/GL-ээс 2Х-дансанд
            бичигдмэгц ноорог карт автоматаар үүснэ
            {draftCount > 0 && (
              <span className="ml-1 font-medium text-[var(--ea-warning-fg)]">
                · {draftCount} ноорог идэвхжүүлэхийг хүлээж байна
              </span>
            )}
          </p>
        </div>
        <Button
          onClick={() => {
            const base = emptyForm();
            setForm({
              ...base,
              assetAccountNumber: buildSegCode(
        { ...defaultSegments, 3: base.assetAccountNumber },
                activeSegIds,
                defaultSegments
              ),
              accumDepAccountNumber: buildSegCode(
        { ...defaultSegments, 3: base.accumDepAccountNumber },
                activeSegIds,
                defaultSegments
              ),
              depExpenseAccountNumber: buildSegCode(
        { ...defaultSegments, 3: base.depExpenseAccountNumber },
                activeSegIds,
                defaultSegments
              ),
            });
            setError("");
            setActivatingId(null);
            setOpen(true);
          }}
        >
          <Plus />
          Шинэ хөрөнгө
        </Button>
      </div>

      {assets.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Хөрөнгө бүртгэгдээгүй байна
        </div>
      ) : (
        <DataGridDynamic<FixedAssetView>
          rowData={assets}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height="flex"
          pagination={assets.length > 25}
          paginationPageSize={25}
          paginationPageSizeSelector={false}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onCellClicked={handleCellClicked}
        />
      )}

      {/* Дэлгэрэнгүй */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-sm text-[var(--ea-text-3)]">
                    {detail.code}
                  </span>
                  {detail.name}
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      background:
                        detail.status === "active"
                          ? "var(--ea-success-bg, rgba(16,185,129,.12))"
                          : "var(--ea-warning-bg, rgba(245,158,11,.12))",
                      color:
                        detail.status === "active"
                          ? "var(--ea-success)"
                          : "var(--ea-warning-fg, var(--ea-warning))",
                    }}
                  >
                    {STATUS_LABELS[detail.status] ?? detail.status}
                  </span>
                </DialogTitle>
              </DialogHeader>

              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <DetailItem label="Авсан огноо" value={detail.acquisitionDate} mono />
                  <DetailItem label="Эзэмшигч" value={detail.custodian || "—"} />
                  <DetailItem
                    label="Элэгдлийн арга"
                    value={depreciationMethodLabel(detail.depreciationMethod)}
                  />
                  <DetailItem
                    label="Эхлэх сар"
                    value={detail.depreciationStartMonth ?? "—"}
                    mono
                  />
                  <DetailItem
                    label="Ашиглалтын хугацаа"
                    value={
                      detail.usefulLifeMonths > 0
                        ? `${detail.usefulLifeMonths} сар`
                        : "—"
                    }
                  />
                  <DetailItem
                    label="Сарын элэгдэл (шулуун)"
                    value={
                      detail.usefulLifeMonths > 0
                        ? fmtMnt(monthlyDepreciation(detail))
                        : "—"
                    }
                    mono
                  />
                  <DetailItem
                    label="Үлдэх өртөг"
                    value={fmtMnt(detail.salvageValue)}
                    mono
                  />
                </div>

                {/* Санхүүгийн дүнгүүд */}
                <div className="grid grid-cols-3 gap-2">
                  <SummaryCard label="Өртөг" value={fmtMnt(detail.cost)} />
                  <SummaryCard
                    label="Хуримт. элэгдэл"
                    value={fmtMnt(detail.accumulated)}
                  />
                  <SummaryCard
                    label="Үлдэгдэл өртөг"
                    value={fmtMnt(detail.netBookValue)}
                    highlight
                  />
                </div>

                {depreciableBase > 0 && (
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--ea-text-3)]">
                      <span>Элэгдлийн явц</span>
                      <span>{progressPercent}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ea-border)]">
                      <div
                        className="h-full rounded-full bg-[var(--ea-primary)]"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-3 sm:gap-x-6">
                  <DetailItem
                    label="Өртгийн данс"
                    value={detail.assetAccountNumber}
                    mono
                  />
                  <DetailItem
                    label="Хуримт. элэгдлийн данс"
                    value={detail.accumDepAccountNumber}
                    mono
                  />
                  <DetailItem
                    label="Элэгдлийн зардлын данс"
                    value={detail.depExpenseAccountNumber}
                    mono
                  />
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-[var(--ea-text-2)]">
                    Элэгдлийн бичилтүүд ({detail.entries.length})
                  </p>
                  {detail.entries.length === 0 ? (
                    <p className="rounded-md border border-[var(--ea-border)] px-3 py-4 text-center text-xs text-[var(--ea-text-4)]">
                      Элэгдлийн бичилт үүсээгүй — Элэгдэл хуудаснаас тооцоолуулна
                    </p>
                  ) : (
                    <DataGridDynamic<FaDepreciationEntryRow>
                      rowData={detail.entries}
                      columnDefs={entryColumns}
                      getRowId={(params) => params.data.id}
                      height={Math.min(320, 86 + detail.entries.length * 34)}
                      wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
                      suppressCellFocus
                    />
                  )}
                </div>
              </div>

              <DialogFooter>
                {detail.status === "draft" && (
                  <Button
                    variant="secondary"
                    onClick={() => openActivateDialog(detail)}
                    disabled={isPending}
                  >
                    <Pencil size={14} />
                    Бөглөж идэвхжүүлэх
                  </Button>
                )}
                <Button variant="outline" onClick={() => setDetailId(null)}>
                  Хаах
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Бүртгэх / идэвхжүүлэх */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {activatingId ? "Карт бөглөж идэвхжүүлэх" : "Шинэ үндсэн хөрөнгө"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Код">
                <Input
                  value={form.code}
                  disabled={!!activatingId}
                  placeholder="Хоосон бол автоматаар үүснэ"
                  maxLength={40}
                  onChange={(e) => setForm((c) => ({ ...c, code: e.target.value }))}
                />
              </Field>
              <Field label="Нэр">
                <Input
                  value={form.name}
                  placeholder="Хөрөнгийн нэр"
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                />
              </Field>
              <Field label="Эзэмшигч (хариуцагч)">
                <Input
                  value={form.custodian}
                  placeholder="Ажилтан, хэлтэс..."
                  maxLength={120}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, custodian: e.target.value }))
                  }
                />
              </Field>
              <Field label="Авсан огноо">
                <Input
                  type="date"
                  value={form.acquisitionDate}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, acquisitionDate: e.target.value }))
                  }
                />
              </Field>
              <Field label="Өртөг (MNT)">
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.cost}
                  disabled={!!activatingId}
                  placeholder="0.00"
                  onChange={(e) => setForm((c) => ({ ...c, cost: e.target.value }))}
                />
              </Field>
              <Field label="Үлдэх өртөг (MNT)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.salvageValue}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, salvageValue: e.target.value }))
                  }
                />
              </Field>
              <Field label="Ашиглалтын хугацаа (сар)">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={form.usefulLifeMonths}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, usefulLifeMonths: e.target.value }))
                  }
                />
              </Field>
              <Field label="Элэгдлийн арга">
                <SearchableSelect
                  value={form.depreciationMethod}
                  onChange={(value) =>
                    value &&
                    setForm((c) => ({ ...c, depreciationMethod: value }))
                  }
                  options={DEPRECIATION_METHODS.map((method) => ({
                    value: method.id,
                    label: method.label,
                  }))}
                  placeholder="Арга сонгох..."
                  hideValue
                />
              </Field>
              <Field label="Элэгдэл эхлэх сар">
                <Input
                  type="month"
                  value={form.depreciationStartMonth}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, depreciationStartMonth: e.target.value }))
                  }
                />
              </Field>
            </div>
            <Field label="Өртгийн данс (2Х)">
              <AccountInput
                value={form.assetAccountNumber}
                onChange={(value) =>
                  setForm((c) => ({ ...c, assetAccountNumber: value }))
                }
                activeSegIds={activeSegIds}
                segmentOptions={segmentOptions}
                defaultSegments={defaultSegments}
                placeholder="Өртгийн данс..."
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Хуримтлагдсан элэгдлийн данс">
                <AccountInput
                  value={form.accumDepAccountNumber}
                  onChange={(value) =>
                    setForm((c) => ({ ...c, accumDepAccountNumber: value }))
                  }
                  activeSegIds={activeSegIds}
                  segmentOptions={segmentOptions}
                  defaultSegments={defaultSegments}
                  placeholder="Хуримт. элэгдлийн данс..."
                />
              </Field>
              <Field label="Элэгдлийн зардлын данс">
                <AccountInput
                  value={form.depExpenseAccountNumber}
                  onChange={(value) =>
                    setForm((c) => ({ ...c, depExpenseAccountNumber: value }))
                  }
                  activeSegIds={activeSegIds}
                  segmentOptions={segmentOptions}
                  defaultSegments={defaultSegments}
                  placeholder="Зардлын данс..."
                />
              </Field>
            </div>
            {error && (
              <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Болих
            </Button>
            <Button onClick={save} disabled={isPending}>
              <Check />
              {activatingId ? "Идэвхжүүлэх" : "Бүртгэх"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid gap-1.5")}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] text-[var(--ea-text-4)]">{label}</p>
      <p className={cn("text-sm text-[var(--ea-text-1)]", mono && "font-mono text-xs")}>
        {value}
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-[var(--ea-border)] px-3 py-2",
        highlight && "border-[var(--ea-primary)]/40 bg-[var(--ea-primary)]/5"
      )}
    >
      <p className="text-[11px] text-[var(--ea-text-4)]">{label}</p>
      <p
        className={cn(
          "font-mono text-sm font-medium",
          highlight ? "text-[var(--ea-primary)]" : "text-[var(--ea-text-1)]"
        )}
      >
        {value}
      </p>
    </div>
  );
}
