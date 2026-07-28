"use client";

import { useMemo } from "react";
import type {
  ColDef,
  ColGroupDef,
  ICellRendererParams,
  ValueFormatterParams,
} from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { IconAction } from "@/components/ui/icon-action";

type CostControlRow = {
  id: string;
  itemCode: string;
  itemName: string;
  c1Qty: number;
  c1UnitCost: number;
  c1Amount: number;
  inboundQty: number;
  inboundUnitCost: number;
  inboundAmount: number;
  outboundQty: number;
  outboundUnitCost: number;
  outboundAmount: number;
  c2Qty: number;
  c2UnitCost: number;
  c2Amount: number;
};

type MasterRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  active: boolean;
};

const number = new Intl.NumberFormat("mn-MN", {
  maximumFractionDigits: 2,
});

function formatNumber(params: ValueFormatterParams<CostControlRow, number>) {
  if (params.node?.rowPinned && params.colDef.field?.includes("UnitCost")) {
    return "";
  }
  if (params.value === null || params.value === undefined) return "";
  return number.format(Number(params.value));
}

const COST_ROWS: CostControlRow[] = [
  {
    id: "1",
    itemCode: "RM-001",
    itemName: "Ган төмөр",
    c1Qty: 100,
    c1UnitCost: 10_000,
    c1Amount: 1_000_000,
    inboundQty: 50,
    inboundUnitCost: 12_000,
    inboundAmount: 600_000,
    outboundQty: 30,
    outboundUnitCost: 10_666.67,
    outboundAmount: 320_000.1,
    c2Qty: 120,
    c2UnitCost: 10_666.67,
    c2Amount: 1_280_000.4,
  },
  {
    id: "2",
    itemCode: "RM-002",
    itemName: "Үйлдвэрийн будаг",
    c1Qty: 40,
    c1UnitCost: 25_000,
    c1Amount: 1_000_000,
    inboundQty: 20,
    inboundUnitCost: 28_000,
    inboundAmount: 560_000,
    outboundQty: 18,
    outboundUnitCost: 26_000,
    outboundAmount: 468_000,
    c2Qty: 42,
    c2UnitCost: 26_000,
    c2Amount: 1_092_000,
  },
  {
    id: "3",
    itemCode: "FG-001",
    itemName: "Бэлэн бүтээгдэхүүн A",
    c1Qty: 25,
    c1UnitCost: 82_000,
    c1Amount: 2_050_000,
    inboundQty: 15,
    inboundUnitCost: 90_000,
    inboundAmount: 1_350_000,
    outboundQty: 22,
    outboundUnitCost: 85_000,
    outboundAmount: 1_870_000,
    c2Qty: 18,
    c2UnitCost: 85_000,
    c2Amount: 1_530_000,
  },
];

const MASTER_ROWS: MasterRow[] = [
  {
    id: "1",
    code: "FRT",
    name: "Тээврийн зардал",
    type: "Landed cost",
    active: true,
  },
  {
    id: "2",
    code: "CUS",
    name: "Гаалийн татвар",
    type: "Landed cost",
    active: true,
  },
  {
    id: "3",
    code: "DEP",
    name: "Үйлдвэрийн элэгдэл",
    type: "Overhead",
    active: false,
  },
];

function numericColumn(
  field: keyof CostControlRow,
  headerName: string,
  width = 112
): ColDef<CostControlRow> {
  return {
    field,
    headerName,
    width,
    minWidth: width,
    cellClass: "ag-right-aligned-cell font-mono",
    headerClass: "ag-right-aligned-header",
    valueFormatter: formatNumber,
  };
}

function sum(field: keyof CostControlRow) {
  return COST_ROWS.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

const PINNED_TOTAL: CostControlRow = {
  id: "total",
  itemCode: "",
  itemName: "НИЙТ",
  c1Qty: sum("c1Qty"),
  c1UnitCost: 0,
  c1Amount: sum("c1Amount"),
  inboundQty: sum("inboundQty"),
  inboundUnitCost: 0,
  inboundAmount: sum("inboundAmount"),
  outboundQty: sum("outboundQty"),
  outboundUnitCost: 0,
  outboundAmount: sum("outboundAmount"),
  c2Qty: sum("c2Qty"),
  c2UnitCost: 0,
  c2Amount: sum("c2Amount"),
};

export function TableKitView() {
  const controlColumns = useMemo<
    Array<ColDef<CostControlRow> | ColGroupDef<CostControlRow>>
  >(
    () => [
      {
        headerName: "#",
        width: 54,
        minWidth: 54,
        sortable: false,
        filter: false,
        pinned: "left",
        valueGetter: (params) =>
          params.node?.rowPinned ? "" : (params.node?.rowIndex ?? 0) + 1,
      },
      {
        field: "itemCode",
        headerName: "Item code",
        width: 110,
        pinned: "left",
        cellClass: "font-mono",
      },
      {
        field: "itemName",
        headerName: "Item description",
        minWidth: 180,
        flex: 1,
        pinned: "left",
      },
      {
        headerName: "C1",
        marryChildren: true,
        children: [
          numericColumn("c1Qty", "Qty", 90),
          numericColumn("c1UnitCost", "Unit cost"),
          numericColumn("c1Amount", "Amount", 125),
        ],
      },
      {
        headerName: "Inbound",
        marryChildren: true,
        children: [
          numericColumn("inboundQty", "Qty", 90),
          numericColumn("inboundUnitCost", "Unit cost"),
          numericColumn("inboundAmount", "Amount", 125),
        ],
      },
      {
        headerName: "Outbound",
        marryChildren: true,
        children: [
          numericColumn("outboundQty", "Qty", 90),
          numericColumn("outboundUnitCost", "Unit cost"),
          numericColumn("outboundAmount", "Amount", 125),
        ],
      },
      {
        headerName: "C2",
        marryChildren: true,
        children: [
          numericColumn("c2Qty", "Qty", 90),
          numericColumn("c2UnitCost", "Unit cost"),
          numericColumn("c2Amount", "Amount", 125),
        ],
      },
    ],
    []
  );

  const masterColumns = useMemo<ColDef<MasterRow>[]>(
    () => [
      { field: "code", headerName: "Код", width: 100, cellClass: "font-mono" },
      { field: "name", headerName: "Нэр", minWidth: 180, flex: 1 },
      { field: "type", headerName: "Төрөл", width: 140 },
      {
        field: "active",
        headerName: "Төлөв",
        width: 110,
        cellRenderer: ({ value }: ICellRendererParams<MasterRow, boolean>) => (
          <span
            className="rounded-full px-2 py-1 text-[10px] font-semibold"
            style={{
              color: value ? "var(--ea-success-fg)" : "var(--ea-text-4)",
              background: value
                ? "var(--ea-success-bg)"
                : "var(--ea-bg-2)",
            }}
          >
            {value ? "Идэвхтэй" : "Идэвхгүй"}
          </span>
        ),
      },
      {
        headerName: "",
        colId: "actions",
        width: 82,
        sortable: false,
        filter: false,
        cellClass: "ea-row-actions",
        cellRenderer: ({ data }: ICellRendererParams<MasterRow>) => (
          <div className="flex h-full items-center justify-end gap-1">
            <IconAction
              name="edit"
              label={`${data?.name ?? "Мөр"} засах`}
              size="xs"
            />
            <IconAction
              name="delete"
              label={`${data?.name ?? "Мөр"} устгах`}
              size="xs"
              variant="danger"
            />
          </div>
        ),
      },
    ],
    []
  );

  return (
    <section
      className="ea-glass space-y-5 p-5"
      style={{
        border: "1px solid var(--ea-border)",
        borderRadius: "var(--ea-r-lg)",
      }}
    >
      <div>
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
          Хүснэгтийн pattern kit
        </h2>
        <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
          Нэг primitive — DataGridDynamic. Доорх нь шинэ хүснэгтүүд биш,
          column/preset-ийн стандарт хэрэглээнүүд.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <PatternNote title="Transaction grid" value="Огноо · Баримт · Дт/Кт" />
        <PatternNote title="Master data grid" value="Selection · Status · Actions" />
        <PatternNote title="Control report" value="Multi-header · Total · Drill-down" />
        <PatternNote title="Editable lines" value="Editor · Validation · Clipboard" />
      </div>

      <div className="space-y-2">
        <div>
          <h3 className="text-xs font-semibold text-[var(--ea-text-2)]">
            Control report — хоёр түвшинт header
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--ea-text-4)]">
            C1 / Inbound / Outbound / C2 бүр Qty, Unit cost, Amount sub-header-тэй.
            Unit cost-ыг total мөрөнд нийлбэрлэхгүй.
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border border-[var(--ea-border)]">
          <DataGridDynamic<CostControlRow>
            rowData={COST_ROWS}
            columnDefs={controlColumns}
            pinnedBottomRowData={[PINNED_TOTAL]}
            getRowId={(params) => params.data.id}
            height={330}
            groupHeaderHeight={34}
            headerHeight={36}
            suppressRowClickSelection
          />
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <h3 className="text-xs font-semibold text-[var(--ea-text-2)]">
            Master data — selection, status, row actions
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--ea-text-4)]">
            Row action hover/focus/selected үед тодорно. Icon-only action бүр
            accessible label-тай.
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border border-[var(--ea-border)]">
          <DataGridDynamic<MasterRow>
            rowData={MASTER_ROWS}
            columnDefs={masterColumns}
            getRowId={(params) => params.data.id}
            showSelectionCheckboxes
            height={250}
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <RuleList
          title="Column contract"
          items={[
            "Текст зүүн, тоо баруун, код/дүн mono",
            "Unit cost total-ыг нийлбэрлэхгүй",
            "Action column богино, баруун талд",
            "Multi-header-д ColGroupDef + marryChildren",
          ]}
        />
        <RuleList
          title="State contract"
          items={[
            "Loading → DataGridDynamic fallback/overlay",
            "Empty → тайлбар + дараагийн action",
            "Selected → persistent tint, hover-оос ялгаатай",
            "Error → мөр/нүд + текстэн тайлбар, зөвхөн өнгө биш",
          ]}
        />
      </div>
    </section>
  );
}

function PatternNote({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--ea-border)] bg-[var(--ea-bg-2)] p-3">
      <div className="text-xs font-semibold text-[var(--ea-text-1)]">{title}</div>
      <div className="mt-1 text-[10px] leading-relaxed text-[var(--ea-text-4)]">
        {value}
      </div>
    </div>
  );
}

function RuleList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-[var(--ea-border)] p-3">
      <div className="text-xs font-semibold text-[var(--ea-text-2)]">{title}</div>
      <ul className="mt-2 space-y-1 text-[11px] text-[var(--ea-text-3)]">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden className="text-[var(--ea-interactive)]">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
