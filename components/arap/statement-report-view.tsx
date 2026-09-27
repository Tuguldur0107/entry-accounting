"use client";

// Тооцоо нийлсэн акт (docs/dev/arap.md §5i) — харилцагч сонгоход (URL
// `?counterparty=`) топбарын периодоор авлага + өглөгийн нэгдсэн хуулга:
// эхний үлдэгдэл → баримт / төлбөр → эцсийн үлдэгдэл, дүгнэлт. PDF нь хоёр
// талын гарын үсэгтэй, харилцагчийн бүртгэлийн хоосон баганатай.

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { ReportEmpty, ReportHeader, ReportPage, ReportToolbar, reportRangeLabel } from "@/components/reports/report-layout";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { CounterpartyStatement, StatementRow } from "@/lib/arap/statement";
import { fmtMnt } from "@/lib/reports/balances";

type GridRow = StatementRow & { kind?: "opening" | "total" | "closing" };

const money = {
  cellClass: "ag-right-aligned-cell font-mono",
  headerClass: "ag-right-aligned-header",
  valueFormatter: (p: { value: unknown }) => (Number(p.value) ? fmtMnt(Number(p.value)) : ""),
};

const COLUMNS: ColDef<GridRow>[] = [
  { headerName: "Огноо", field: "date", width: 120 },
  { headerName: "Баримт", field: "reference", width: 170 },
  { headerName: "Утга", field: "description", flex: 1, minWidth: 220 },
  { headerName: "Дебит (₮)", field: "debit", width: 150, ...money },
  { headerName: "Кредит (₮)", field: "credit", width: 150, ...money },
  {
    headerName: "Үлдэгдэл (₮)",
    field: "balance",
    width: 160,
    cellClass: "ag-right-aligned-cell font-mono",
    headerClass: "ag-right-aligned-header",
    valueFormatter: (p) => (p.data?.kind === "total" ? "" : fmtMnt(Number(p.value ?? 0))),
  },
];

const side = (balance: number) => ({ debit: balance > 0 ? balance : 0, credit: balance < 0 ? -balance : 0 });

export function StatementReportView({
  counterparties,
  counterpartyId,
  from,
  to,
  statement,
  error,
}: {
  counterparties: { id: string; name: string; type: string }[];
  counterpartyId: string | null;
  from: string;
  to: string;
  statement: CounterpartyStatement | null;
  error: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const select = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("counterparty", id);
    else params.delete("counterparty");
    router.replace(params.size ? `${pathname}?${params}` : pathname);
  };

  const options = useMemo(
    () =>
      counterparties.map((row) => ({
        value: row.id,
        label: row.name,
        hint: row.type === "supplier" ? "Нийлүүлэгч" : row.type === "customer" ? "Худалдан авагч" : "Хоёулаа",
      })),
    [counterparties]
  );

  const opening: GridRow | null = statement
    ? { date: statement.from, reference: "", description: "Эхний үлдэгдэл", ...side(statement.opening), balance: statement.opening, kind: "opening" }
    : null;
  const pinned: GridRow[] = statement
    ? [
        { date: "", reference: "", description: "Гүйлгээний дүн", debit: statement.totalDebit, credit: statement.totalCredit, balance: 0, kind: "total" },
        { date: statement.to, reference: "", description: "Эцсийн үлдэгдэл", ...side(statement.closing), balance: statement.closing, kind: "closing" },
      ]
    : [];

  const pdfHref = statement
    ? `/api/arap/statement?counterpartyId=${statement.counterparty.id}&from=${statement.from}&to=${statement.to}`
    : null;

  return (
    <ReportPage>
      <ReportHeader
        title="Тооцоо нийлсэн акт"
        meta={`${reportRangeLabel(from, to)} · авлага + өглөг нэг харилцагчаар, ₮ · дебит = харилцагч өртэй болох, кредит = буурах / манай өглөг`}
        actions={
          pdfHref ? (
            <Button size="sm" variant="outline" nativeButton={false} render={<a href={pdfHref} target="_blank" rel="noreferrer" />}>
              <Icon name="download" size="sm" />
              PDF (гарын үсэгтэй)
            </Button>
          ) : null
        }
      />
      <ReportToolbar
        filters={
          <FormField label="Харилцагч" className="w-full sm:w-80">
            <SearchableSelect
              value={counterpartyId ?? ""}
              onChange={select}
              options={options}
              placeholder="— Харилцагч сонгох —"
              hideValue
              emptyLabel="Харилцагч алга"
            />
          </FormField>
        }
      />
      {error ? (
        <ReportEmpty icon="warning" title="Акт уншигдсангүй" description={error} />
      ) : !statement || !opening ? (
        <ReportEmpty
          icon="document"
          title="Харилцагчаа сонгоно уу"
          description="Сонгосон харилцагчийн топбарын периодын авлага, өглөг, төлбөрүүд нэг хуулгад гарна. Хугацааг топбараас сольно."
        />
      ) : (
        <>
          <DataGridDynamic<GridRow>
            rowData={[opening, ...statement.rows]}
            columnDefs={COLUMNS}
            getRowId={(params) => `${params.data.kind ?? "row"}-${params.data.reference}-${params.data.date}-${params.data.balance}`}
            pinnedBottomRowData={pinned}
            height="flex"
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
          <p className="text-sm font-medium text-[var(--ea-text-1)]">{statement.conclusion}</p>
        </>
      )}
    </ReportPage>
  );
}
