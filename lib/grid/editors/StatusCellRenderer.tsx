"use client";

// Баримтын төлөвийн нүд — жагсаалтын grid-үүдэд `col({ eaType: "status" })`
// (lib/grid/columnTypes.ts). Зөвхөн дүрс + tooltip/aria-label (UI гайдын
// карт 1): бүртгэл нь lib/status.ts.

import type { ICellRendererParams } from "ag-grid-community";

import { DocumentStatusBadge } from "@/components/ui/status-badge";

export function StatusCellRenderer(params: ICellRendererParams) {
  if (params.node?.rowPinned || params.value == null || params.value === "") return null;
  return (
    <div className="flex h-full items-center justify-center">
      <DocumentStatusBadge status={String(params.value)} variant="icon" />
    </div>
  );
}
