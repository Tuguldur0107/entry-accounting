"use client";

// АР/АП баримтын МӨРИЙН хүснэгт — дахин ашиглагдах component.
//
// Урьд нь components/panel/arap-doc-panel.tsx дотор private байсан; хангамжийн
// модуль (PO-той нэхэмжлэх, хүлээн авалтын баримт) мөн ижил grid хэрэглэдэг тул
// ЭНД зөөгдөв (давхардсан grid бичихийг хориглоно — CLAUDE.md хүснэгтийн
// стандарт). Зан төлөв нь зөөлтийн дараа ИЖИЛ: `mode="arap"` үед хуучин АР/АП
// формын харагдац, шинэ багана/товчнууд зөвхөн шинэ mode-уудад нэмэгдэнэ.

import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { ExcelImportDialog } from "@/components/excel/excel-import-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import { getVatLineDefaults } from "@/lib/actions/vat";
import { roundMoney } from "@/lib/arap/accounting";
import type {
  InventoryItemOption,
  WarehouseOption,
} from "@/lib/arap/load-data";
import type { ArApDocumentType, ArApLineInput } from "@/lib/arap/types";
import { arapLinesSpec, type ArapLineImport } from "@/lib/excel/specs";
import { AccountSegmentEditor } from "@/lib/grid/editors/AccountSegmentEditor";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { parseMntInput } from "@/lib/grid/formatters";
import {
  buildSegCode,
  fmtAccountDisplay,
  normalizePastedAccount,
} from "@/lib/grid/segments";
import { fmtMnt } from "@/lib/reports/balances";

/** Grid-ийн мөр — сервер рүү явах input + client талын түлхүүр. */
export type LineRow = ArApLineInput & { id: string };

/**
 * Хүснэгтийн горим:
 *   "arap"          — хуучин АР/АП баримт (зан төлөв өөрчлөгдөөгүй)
 *   "po_invoice"    — PO-той нэхэмжлэх (өглөгийн түр данс, бүрэлдэхүүн)
 *   "goods_receipt" — хүлээн авалт (зөвхөн бараа/тоо/агуулах; данс, дүн үгүй)
 */
export type ArApLinesGridMode = "arap" | "po_invoice" | "goods_receipt";

/** Хоосон мөр — дансны сегментүүд default-аар бөглөгдсөн. */
export function emptyLine(
  activeSegIds: number[],
  defaultSegments: Record<number, string>
): LineRow {
  return {
    id: nanoid(),
    account: buildSegCode({}, activeSegIds, defaultSegments),
    description: "",
    amount: 0,
  };
}

export function ArApLinesGrid({
  lines,
  onChange,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  inventoryItems,
  warehouses,
  documentType,
  clearingAccountNumber,
  mode = "arap",
  apClearingAccountNumber,
  costComponents,
  lockedItemLines = false,
}: {
  lines: LineRow[];
  onChange: (updater: (prev: LineRow[]) => LineRow[]) => void;
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  inventoryItems: InventoryItemOption[];
  warehouses: WarehouseOption[];
  documentType: ArApDocumentType;
  /** Бараа материалын түр (клиринг) данс — тохиргооноос ирнэ (JPR-006). */
  clearingAccountNumber: string;
  mode?: ArApLinesGridMode;
  /** Өглөгийн түр данс — PO-той баримтын бараа/бүрэлдэхүүн мөр энд суана. */
  apClearingAccountNumber?: string;
  /** Өртгийн бүрэлдэхүүний лавлах (гааль, тээвэр …). */
  costComponents?: { id: string; code: string; name: string }[];
  /** PO-гоос бөглөгдсөн мөрийн бараа/холбоос засагдахгүй болно. */
  lockedItemLines?: boolean;
}) {
  const total = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const [importOpen, setImportOpen] = useState(false);
  const [vatBusy, setVatBusy] = useState(false);

  const isReceipt = mode === "goods_receipt";
  const poLinked = mode === "po_invoice" && !!apClearingAccountNumber;
  // Бараатай мөрийн клирингийн данс: PO-той бол ӨГЛӨГИЙН түр данс
  // (орлогын капитализаци хүлээн авалтын баримтаас бичигдэнэ).
  const itemClearingMain =
    poLinked && apClearingAccountNumber
      ? apClearingAccountNumber
      : clearingAccountNumber;
  const showItemColumns = inventoryItems.length > 0;
  const showUnitPrice = showItemColumns && !isReceipt;
  const showComponents = !isReceipt && (costComponents?.length ?? 0) > 0;

  // "НӨАТ 10% нэмэх" — НӨАТ-гүй мөрүүдийн нийлбэрээс exclusive тооцож
  // тохиргооны НӨАТ дансанд нэг мөр нэмнэ (байвал дүнг нь шинэчилнэ).
  // АР → гаралтын НӨАТ (өглөг), АП → оролтын НӨАТ (авлага).
  async function addVatLine() {
    setVatBusy(true);
    try {
      const defaults = await getVatLineDefaults();
      const account =
        documentType === "ap_bill" ? defaults.inputCode : defaults.outputCode;
      const label = `НӨАТ ${defaults.ratePercent}%`;
      onChange((prev) => {
        const isVatLine = (line: LineRow) =>
          line.description.trim().startsWith("НӨАТ");
        const base = prev
          .filter((line) => !isVatLine(line))
          .reduce((sum, line) => sum + Number(line.amount || 0), 0);
        const vatAmount =
          Math.round(base * defaults.ratePercent) / 100;
        if (!(vatAmount > 0)) return prev;
        const existing = prev.find(isVatLine);
        if (existing)
          return prev.map((line) =>
            line === existing
              ? { ...line, account, description: label, amount: vatAmount }
              : line
          );
        return [
          ...prev.filter(
            (line) =>
              Number(line.amount || 0) > 0 || line.description.trim() !== ""
          ),
          {
            id: nanoid(),
            account,
            description: label,
            amount: vatAmount,
            itemId: undefined,
            quantity: undefined,
            warehouseId: undefined,
          },
        ];
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "НӨАТ-ийн тохиргоо уншигдсангүй"
      );
    } finally {
      setVatBusy(false);
    }
  }

  // Excel импорт — олон бараатай нэхэмжлэхийг нэг файлаас (стандарт:
  // зөвхөн зөв мөрүүд орж ирнэ; бараа/агуулах КОДООР танигдана).
  const importSpec = useMemo(
    () =>
      arapLinesSpec({
        accountsByMain: new Map(
          (segmentOptions[3] ?? []).map((option) => [option.code, option.name])
        ),
        activeSegIds,
        defaultSegments,
        itemsByCode: new Map(
          inventoryItems.map((item) => [
            item.code,
            { id: item.id, name: item.name },
          ])
        ),
        warehousesByCode: new Map(
          warehouses.map((warehouse) => [
            warehouse.code,
            { id: warehouse.id, name: warehouse.name },
          ])
        ),
      }),
    [segmentOptions, activeSegIds, defaultSegments, inventoryItems, warehouses]
  );

  function handleImportLines(values: ArapLineImport[]) {
    onChange((prev) => {
      // Хүрээгүй хоосон мөрүүдийг импорт орлоно.
      const kept = prev.filter(
        (line) => Number(line.amount || 0) > 0 || line.description.trim() !== ""
      );
      return [
        ...kept,
        ...values.map((value) => ({
          id: nanoid(),
          account: value.account,
          description: value.description,
          amount: value.amount,
          itemId: value.itemId ?? undefined,
          quantity: value.quantity ?? undefined,
          warehouseId: value.warehouseId ?? undefined,
        })),
      ];
    });
  }

  // Бараатай мөр: АП батлагдахад орлогын, АР батлагдахад зарлагын тоо
  // хэмжээний draft inventory-д үүснэ (бараа бүртгэлтэй үед л харагдана).
  const itemLabelById = useMemo(
    () =>
      new Map(
        inventoryItems.map((item) => [item.id, `${item.code} · ${item.name}`])
      ),
    [inventoryItems]
  );
  const warehouseLabelById = useMemo(
    () =>
      new Map(
        warehouses.map((warehouse) => [
          warehouse.id,
          `${warehouse.code} · ${warehouse.name}`,
        ])
      ),
    [warehouses]
  );
  const componentLabelById = useMemo(
    () =>
      new Map(
        (costComponents ?? []).map((component) => [
          component.id,
          `${component.code} · ${component.name}`,
        ])
      ),
    [costComponents]
  );
  const columns = useMemo<ColDef<LineRow>[]>(
    () => [
      { headerName: "#", width: 48, valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1 },
      ...(isReceipt
        ? []
        : ([
            {
              headerName: "Данс",
              field: "account",
              minWidth: 240,
              flex: 1,
              editable: true,
              cellEditor: AccountSegmentEditor,
              cellEditorParams: {
                activeSegIds,
                segOptions: segmentOptions,
                extraDefaults: defaultSegments,
              },
              valueFormatter: (params) =>
                fmtAccountDisplay(String(params.value ?? ""), activeSegIds),
            },
          ] as ColDef<LineRow>[])),
      {
        headerName: "Тайлбар",
        field: "description",
        minWidth: 180,
        flex: 1,
        editable: true,
      },
      ...(isReceipt
        ? []
        : ([
            {
              headerName: "Дүн",
              field: "amount",
              width: 150,
              editable: true,
              cellClass: "ag-right-aligned-cell font-mono",
              headerClass: "ag-right-aligned-header",
              valueParser: (params) => {
                const value = parseMntInput(params.newValue);
                return Number.isFinite(value) && value > 0 ? value : 0;
              },
              valueFormatter: (params) =>
                params.value ? fmtMnt(Number(params.value)) : "",
            },
          ] as ColDef<LineRow>[])),
      ...(showItemColumns
        ? ([
            {
              headerName: "Бараа",
              field: "itemId",
              minWidth: 170,
              editable: (params) =>
                !(lockedItemLines && params.data?.purchaseOrderLineId),
              cellEditor: "agSelectCellEditor",
              cellEditorParams: {
                values: ["", ...inventoryItems.map((item) => item.id)],
              },
              valueFormatter: (params) =>
                params.value ? itemLabelById.get(String(params.value)) ?? "" : "—",
            },
            {
              headerName: "Тоо",
              field: "quantity",
              width: 96,
              editable: true,
              cellClass: "ag-right-aligned-cell font-mono",
              headerClass: "ag-right-aligned-header",
              valueParser: (params) => {
                const value = Number(String(params.newValue).replaceAll(",", ""));
                return Number.isFinite(value) && value > 0 ? value : undefined;
              },
              valueFormatter: (params) =>
                params.value ? String(params.value) : "",
            },
            ...(showUnitPrice
              ? ([
                  {
                    headerName: "Нэгж үнэ",
                    field: "unitPrice",
                    width: 120,
                    editable: true,
                    cellClass: "ag-right-aligned-cell font-mono",
                    headerClass: "ag-right-aligned-header",
                    valueParser: (params) => {
                      const value = parseMntInput(params.newValue);
                      return Number.isFinite(value) && value > 0
                        ? value
                        : undefined;
                    },
                    valueFormatter: (params) =>
                      params.value ? fmtMnt(Number(params.value)) : "",
                  },
                ] as ColDef<LineRow>[])
              : []),
            {
              headerName: "Агуулах",
              field: "warehouseId",
              minWidth: 140,
              editable: true,
              cellEditor: "agSelectCellEditor",
              cellEditorParams: {
                values: ["", ...warehouses.map((warehouse) => warehouse.id)],
              },
              valueFormatter: (params) =>
                params.value
                  ? warehouseLabelById.get(String(params.value)) ?? ""
                  : "—",
            },
          ] as ColDef<LineRow>[])
        : []),
      ...(showComponents
        ? ([
            {
              headerName: "Бүрэлдэхүүн",
              field: "costComponentId",
              minWidth: 160,
              editable: true,
              cellEditor: "agSelectCellEditor",
              cellEditorParams: {
                values: [
                  "",
                  ...(costComponents ?? []).map((component) => component.id),
                ],
              },
              valueFormatter: (params) =>
                params.value
                  ? componentLabelById.get(String(params.value)) ?? ""
                  : "—",
            },
          ] as ColDef<LineRow>[])
        : []),
      {
        headerName: "",
        colId: "action",
        width: 44,
        sortable: false,
        filter: false,
        cellRenderer: ({ data }: { data?: LineRow }) => (
          <IconAction
            name="delete"
            label="Мөр устгах"
            size="sm"
            variant="danger"
            onClick={() =>
              onChange((prev) =>
                prev.length <= 1 ? prev : prev.filter((line) => line.id !== data?.id)
              )
            }
          />
        ),
      },
    ],
    [
      activeSegIds,
      defaultSegments,
      onChange,
      segmentOptions,
      inventoryItems,
      warehouses,
      itemLabelById,
      warehouseLabelById,
      componentLabelById,
      costComponents,
      isReceipt,
      showItemColumns,
      showUnitPrice,
      showComponents,
      lockedItemLines,
    ]
  );

  return (
    <div className="space-y-2">
      <DataGridDynamic<LineRow>
        rowData={lines}
        columnDefs={columns}
        getRowId={(params) => params.data.id}
        onCellValueChanged={(event: CellValueChangedEvent<LineRow>) => {
          const field = event.colDef.field as keyof LineRow | undefined;
          if (!field) return;
          onChange((prev) =>
            prev.map((line) => {
              if (line.id !== event.data.id) return line;
              const next = { ...line, [field]: event.newValue };
              // АП-ийн бараатай мөр клирингийн дансанд суух ёстой (server
              // талд мөн шалгадаг) — бараа сонгонгуут дансыг автоматаар
              // 14000099 (PO-той бол өглөгийн түр данс) болгоно.
              if (
                field === "itemId" &&
                event.newValue &&
                documentType === "ap_bill"
              ) {
                next.account = buildSegCode(
                  { 3: itemClearingMain },
                  activeSegIds,
                  defaultSegments
                );
                next.costComponentId = undefined;
              }
              // Бүрэлдэхүүнтэй мөр = капиталжих нэмэлт зардал: бараатай
              // ЗЭРЭГ байж болохгүй, данс нь өглөгийн түр данс.
              if (field === "costComponentId" && event.newValue) {
                next.itemId = undefined;
                next.quantity = undefined;
                next.warehouseId = undefined;
                next.purchaseOrderLineId = undefined;
                if (apClearingAccountNumber)
                  next.account = buildSegCode(
                    { 3: apClearingAccountNumber },
                    activeSegIds,
                    defaultSegments
                  );
              }
              // Тоо × нэгж үнэ = мөрийн дүн (хоёул бөглөгдсөн үед).
              if (field === "quantity" || field === "unitPrice") {
                const quantity = Number(next.quantity ?? 0);
                const unitPrice = Number(next.unitPrice ?? 0);
                if (quantity > 0 && unitPrice > 0)
                  next.amount = roundMoney(quantity * unitPrice);
              }
              return next;
            })
          );
        }}
        processDataFromClipboard={(params) =>
          (params.data ?? []).map((row) =>
            row.map((cell, index) =>
              index === 1 && !isReceipt
                ? normalizePastedAccount(cell, activeSegIds, defaultSegments)
                : cell
            )
          )
        }
        height={Math.min(360, 86 + lines.length * 38)}
        wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
        singleClickEdit
      />
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange((prev) => [...prev, emptyLine(activeSegIds, defaultSegments)])
            }
          >
            + Мөр нэмэх
          </Button>
          {mode === "arap" && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
              >
                <Icon name="spreadsheet" size="sm" />
                Excel импорт
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={vatBusy}
                onClick={addVatLine}
              >
                НӨАТ 10% нэмэх
              </Button>
            </>
          )}
          {mode === "po_invoice" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={vatBusy}
              onClick={addVatLine}
            >
              НӨАТ 10% нэмэх
            </Button>
          )}
        </div>
        {!isReceipt && (
          <span className="font-mono font-semibold text-[var(--ea-text-1)]">
            Нийт: {fmtMnt(total)}
          </span>
        )}
      </div>
      {mode === "arap" && (
        <ExcelImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          spec={importSpec}
          title="Баримтын мөр импортлох"
          onImport={handleImportLines}
        />
      )}
    </div>
  );
}
