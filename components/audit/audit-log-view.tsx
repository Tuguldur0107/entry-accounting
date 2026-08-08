"use client";

// Аудитын мөрийн жагсаалт — зөвхөн унших AG Grid (DataGridDynamic стандарт).
// Батлах/буцаах/устгах/хаах зэрэг статус шилжилтийн тэмдэглэлүүд шинээс нь
// хуучин руу эрэмбэлэгдэж харагдана.

import { useMemo } from "react";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";

export interface AuditLogRow {
  id: string;
  /** ISO timestamp — серверээс string болж ирнэ. */
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
}

// Үйлдлийн код → монгол шошго. Танихгүй кодыг түүхий чигээр нь үзүүлнэ.
const ACTION_LABELS: Record<string, string> = {
  post: "Батлагдсан",
  unpost: "Буцаагдсан",
  reverse: "Буцаагдсан",
  delete: "Устгагдсан",
  close: "Хаагдсан",
  reopen: "Дахин нээгдсэн",
  confirm: "Батлагдсан",
  cancel: "Цуцлагдсан",
  create_posted: "Шууд бичигдсэн",
  create_voucher: "Журнал үүсгэсэн",
  fx_post: "FX тэгшитгэл",
  fx_reverse: "FX буцаалт",
};

// Объектын төрөл → монгол шошго.
const ENTITY_LABELS: Record<string, string> = {
  journal: "Журнал",
  cash: "Касс",
  arap: "АР/АП",
  fa: "Элэгдэл",
  cost: "Өртөг",
  inventory: "Бараа",
  period: "Период",
  payroll: "Цалин",
};

// "YYYY-MM-DD HH:mm" — Улаанбаатарын цагаар. sv-SE locale яг энэ форматыг өгдөг.
const TS_FORMAT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ulaanbaatar",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function fmtTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return TS_FORMAT.format(date);
}

export function AuditLogView({ rows }: { rows: AuditLogRow[] }) {
  const columns = useMemo<ColDef<AuditLogRow>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "createdAt",
        width: 150,
        cellClass: "font-mono text-xs",
        valueFormatter: (params) => fmtTimestamp(params.value ?? ""),
      },
      {
        headerName: "Үйлдэл",
        field: "action",
        width: 150,
        valueFormatter: (params) =>
          ACTION_LABELS[params.value ?? ""] ?? params.value ?? "",
      },
      {
        headerName: "Төрөл",
        field: "entityType",
        width: 110,
        valueFormatter: (params) =>
          ENTITY_LABELS[params.value ?? ""] ?? params.value ?? "",
      },
      {
        headerName: "Тайлбар",
        field: "summary",
        minWidth: 320,
        flex: 1,
        cellClass: "text-xs",
      },
    ],
    []
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          Аудитын мөр
        </h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Батлах, буцаах, устгах, период хаах зэрэг статус шилжилт бүрийн
          тэмдэглэл — сүүлийн 500 үйлдэл, шинэ нь эхэндээ.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Аудитын тэмдэглэл алга
        </div>
      ) : (
        <DataGridDynamic<AuditLogRow>
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}
    </section>
  );
}
